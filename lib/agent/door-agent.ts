import { Agent, tool, BeforeToolCallEvent, BeforeModelCallEvent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";
import { getRingClient, chimeId, resolveDoorbellId, type Snapshot } from "@/lib/ring/client";
import { observeImage, type Observation } from "@/lib/vision";
import { sanitizeObservation, checkText, wordCount, MAX_WORDS } from "@/lib/privacy";
import { matchExpected, type ExpectedVisitor, type MatchResult } from "@/lib/expected";
import type { Category, DoorEvent } from "@/lib/events";
import type { RingWebhook } from "@/lib/ring/webhook";

const MAX_MODEL_CALLS = 8;

const SYSTEM = `You are Describe My Door, a Ring doorbell assistant for a blind or low-vision resident.
A Ring event just happened. Work through your tools in this order:
1. fetch_snapshot
2. describe_scene
3. check_expected_visitors (always, it is cheap)
4. announce exactly once
Announcement rules:
- One or two short sentences, at most ${MAX_WORDS} words, most useful fact first.
- Say "a person" or "two people". Describe clothing, uniforms, carried items and actions only.
- Never guess gender, age, race, religion, health, names or identity.
- If check_expected_visitors matched, start with "This may be <label>:" using the label exactly as given.
- category: "expected_visitor" only if matched; "package" only if describe_scene reports new_packages > 0 and nobody rang; otherwise "visitor".
- If the event is motion with new packages, say how many packages were left.`;

export interface RunOptions {
  webhook: RingWebhook;
  localTime: string;
  expected: ExpectedVisitor[];
  previousPackages: number;
  scenarioHint?: string;
  emit: (e: DoorEvent) => void;
}

export async function runDoorAgent(opts: RunOptions) {
  const { webhook, localTime, expected, previousPackages, scenarioHint, emit } = opts;
  const ring = getRingClient();
  const started = Date.now();
  const eventType = webhook.data.type;
  // In hybrid mode ask the Ring API for the snapshot of the account's real camera; the webhook's
  // device id belongs to the simulated event. The client falls back to a sample image and says why.
  const snapshotDeviceId = ring.mode === "simulator" ? webhook.data.attributes.source : await resolveDoorbellId();

  // Per-invocation facts. Tools write them; hooks read them to enforce the rules.
  const facts: {
    snapshot?: Snapshot;
    observation?: Observation;
    newPackages?: number;
    match?: MatchResult;
    announced: boolean;
    modelCalls: number;
  } = { announced: false, modelCalls: 0 };

  const observationText = (o: Observation) =>
    [...o.people.flatMap((p) => [p.clothing, p.uniform_or_role_clues, p.carrying, p.action]), ...o.vehicles, o.other].join(" ");

  const fetchSnapshot = tool({
    name: "fetch_snapshot",
    description: "Download the doorbell camera image at the moment of the Ring event (Ring image download API).",
    inputSchema: z.object({}),
    callback: async () => {
      emit({ kind: "tool", id: "fetch_snapshot", name: "fetch_snapshot", status: "running", detail: `POST /v1/devices/${snapshotDeviceId}/media/image/download` });
      const snap = await ring.downloadSnapshot(snapshotDeviceId, webhook.data.attributes.timestamp, scenarioHint);
      facts.snapshot = snap;
      emit({ kind: "snapshot", dataUrl: `data:${snap.mime};base64,${snap.bytes.toString("base64")}`, source: snap.source, note: snap.note });
      emit({
        kind: "tool",
        id: "fetch_snapshot",
        name: "fetch_snapshot",
        status: "done",
        detail: `${Math.round(snap.bytes.length / 1024)} KB ${snap.mime}${snap.note ? ` · ${snap.note}` : ""}`,
        source: snap.source,
      });
      return { ok: true, size_kb: Math.round(snap.bytes.length / 1024) };
    },
  });

  const describeScene = tool({
    name: "describe_scene",
    description: "Run the vision model on the snapshot and return privacy-filtered observations: people (clothing, carried items, actions), packages, vehicles.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!facts.snapshot) return { error: "call fetch_snapshot first" };
      emit({ kind: "tool", id: "describe_scene", name: "describe_scene", status: "running", detail: process.env.VISION_MODEL || "google/gemma-4-31B-it" });
      const raw = await observeImage(facts.snapshot.bytes, facts.snapshot.mime);
      const { clean, removed } = sanitizeObservation(raw);
      if (removed.length) emit({ kind: "privacy", removed });
      facts.observation = clean;
      facts.newPackages = Math.max(0, clean.packages_left_unattended - previousPackages);
      const people = clean.people.length;
      emit({
        kind: "tool",
        id: "describe_scene",
        name: "describe_scene",
        status: "done",
        detail: `${people} ${people === 1 ? "person" : "people"} · ${facts.newPackages} new package${facts.newPackages === 1 ? "" : "s"}`,
      });
      return { ...clean, new_packages: facts.newPackages };
    },
  });

  const checkExpected = tool({
    name: "check_expected_visitors",
    description: "Compare what the camera sees and the current time with the visitors the caregiver said to expect. Deterministic; never uses faces.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!facts.observation) return { error: "call describe_scene first" };
      emit({ kind: "tool", id: "check_expected_visitors", name: "check_expected_visitors", status: "running", detail: `local time ${localTime}` });
      const match = matchExpected(observationText(facts.observation), localTime, expected);
      facts.match = match;
      emit({ kind: "tool", id: "check_expected_visitors", name: "check_expected_visitors", status: "done", detail: match.matched ? `match: ${match.visitor!.label}` : "no match" });
      return match;
    },
  });

  const announce = tool({
    name: "announce",
    description: "Speak the description on the resident's companion app and sound the matching tone on their Ring Chime.",
    inputSchema: z.object({
      message: z.string().describe(`At most ${MAX_WORDS} words.`),
      category: z.enum(["visitor", "expected_visitor", "package"]),
    }),
    callback: async ({ message, category }) => {
      emit({ kind: "tool", id: "announce", name: "announce", status: "running", detail: category });
      // Chime slot 1 = visitor tone, slot 2 = package tone (Chime Pro exposes two app slots).
      const slots = await ring.chimeSlots(chimeId());
      const slot = slots.find((s) => s.event === (category === "package" ? "ring-appstore-event-2" : "ring-appstore-event-1")) ?? slots[0];
      let chimeStatus = "no chime slot";
      let chimeSource: "ring" | "simulated" = "simulated";
      let chimeNote: string | undefined;
      if (slot && !slot.disabled) {
        const played = await ring.playChime(chimeId(), slot.audio_ref);
        chimeStatus = played.status;
        chimeSource = played.source;
        chimeNote = played.note;
      }
      facts.announced = true;
      emit({
        kind: "announcement",
        eventId: webhook.data.id,
        text: message.trim(),
        category: category as Category,
        localTime,
        chime: { slot: slot?.event ?? "none", audioName: slot?.audio_name ?? "", status: chimeStatus, source: chimeSource, note: chimeNote },
        match: facts.match?.matched ? { label: facts.match.visitor!.label, window: facts.match.visitor!.window, clues: facts.match.cluesFound } : undefined,
      });
      emit({ kind: "tool", id: "announce", name: "announce", status: "done", detail: `chime ${chimeStatus}`, source: chimeSource });
      return { spoken: true, chime: chimeStatus };
    },
  });

  const model = new OpenAIModel({
    api: "chat",
    apiKey: process.env.OPENAI_API_KEY,
    modelId: process.env.OPENAI_MODEL,
    clientConfig: { baseURL: process.env.OPENAI_BASE_URL, timeout: 60_000, maxRetries: 1 },
    params: { temperature: 0, chat_template_kwargs: { enable_thinking: false } },
  } as ConstructorParameters<typeof OpenAIModel>[0]);

  const agent = new Agent({ model, tools: [fetchSnapshot, describeScene, checkExpected, announce], systemPrompt: SYSTEM, printer: false });

  const hook = (rule: string, verdict: "allowed" | "blocked", detail: string) => emit({ kind: "hook", rule, verdict, detail });

  agent.addHook(BeforeModelCallEvent, (e) => {
    facts.modelCalls += 1;
    if (facts.modelCalls > MAX_MODEL_CALLS) {
      e.cancel = "Step limit reached.";
      hook("step cap", "blocked", `more than ${MAX_MODEL_CALLS} model calls`);
    }
  });

  agent.addHook(BeforeToolCallEvent, (e) => {
    const name = e.toolUse.name;
    const block = (rule: string, reason: string) => {
      e.cancel = `Blocked by rule "${rule}": ${reason}`;
      hook(rule, "blocked", reason);
    };
    if (name === "describe_scene" && !facts.snapshot) return block("order", "describe_scene needs a snapshot first");
    if (name === "check_expected_visitors" && !facts.observation) return block("order", "check_expected_visitors needs describe_scene first");
    if (name !== "announce") return;

    const input = e.toolUse.input as { message?: string; category?: Category };
    const message = input.message ?? "";
    if (facts.announced) return block("one announcement", "this event was already announced");
    if (!facts.observation || !facts.match) return block("order", "announce needs describe_scene and check_expected_visitors first");

    const words = wordCount(message);
    if (words > MAX_WORDS) return block("length", `${words} words; the limit is ${MAX_WORDS}`);
    hook("length", "allowed", `${words}/${MAX_WORDS} words`);

    const allowed = facts.match.matched ? [facts.match.visitor!.label] : [];
    const privacy = checkText(message, allowed);
    if (!privacy.ok) return block("privacy", `mentions ${privacy.violations.join(", ")}; describe clothing and objects only`);
    hook("privacy", "allowed", "no identity, gender, age, race, religion or health terms");

    if (input.category === "expected_visitor" && !facts.match.matched) return block("category", "no expected visitor matched");
    if (input.category !== "expected_visitor" && facts.match.matched) return block("category", `matched "${facts.match.visitor!.label}", use expected_visitor`);
    if (input.category === "package" && !(facts.newPackages && facts.newPackages > 0)) return block("category", "no new packages seen");
    if (facts.match.matched && !message.includes(facts.match.visitor!.label)) return block("label", `say the caregiver's label exactly: "${facts.match.visitor!.label}"`);
    hook("category", "allowed", `${input.category} is consistent with the observations`);
  });

  const what =
    eventType === "button_press"
      ? "Someone pressed the doorbell button"
      : `Motion detected (sub_type: ${webhook.data.attributes.sub_type ?? "motion"})`;
  const result = await agent.invoke(`Ring webhook ${eventType} from the front door doorbell at ${localTime}. ${what}. Describe it for the resident.`);
  emit({ kind: "done", ms: Date.now() - started, steps: facts.modelCalls });
  return { announced: facts.announced, stopReason: result.stopReason };
}
