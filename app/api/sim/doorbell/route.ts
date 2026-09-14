import { z } from "zod";
import { buildWebhook, signBody } from "@/lib/ring/webhook";
import { acceptWebhook } from "@/lib/intake";
import { doorbellId, ringMode, SIM_DEVICES } from "@/lib/ring/client";
import { scenarioById } from "@/lib/sim/scenarios";
import { runDoorAgent } from "@/lib/agent/door-agent";
import { DEFAULT_EXPECTED } from "@/lib/expected";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import type { DoorEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const Body = z.object({
  scenario: z.string().max(40),
  expected: z
    .array(z.object({ id: z.string().max(40), label: z.string().max(60), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), clues: z.array(z.string().max(30)).max(8) }))
    .max(10)
    .optional(),
});

// Simulated Ring doorbell: builds the exact v1.1 webhook Ring would send, signs it with HMAC-SHA256,
// then runs it through the same verification and agent pipeline as the live /api/ring/webhook route.
export async function POST(req: Request) {
  if (ringMode() !== "simulator") return Response.json({ error: "simulator disabled (RING_MODE=live)" }, { status: 409 });
  const limit = rateLimit(`sim:${clientIp(req)}`, 12);
  if (!limit.ok) return Response.json({ error: `Too many runs. Try again in ${limit.retryAfter}s.` }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const scenario = scenarioById(parsed.data.scenario);
  if (!scenario) return Response.json({ error: "unknown scenario" }, { status: 404 });

  const key = process.env.RING_HMAC_KEY || "simulator-signing-key";
  const payload = buildWebhook({
    type: scenario.eventType,
    subType: scenario.subType,
    deviceId: doorbellId(),
    accountId: "ava1.ring.account.SIMULATED",
    timestamp: Date.now(),
  });
  const raw = JSON.stringify(payload);
  const signature = signBody(raw, key);
  const intake = acceptWebhook(raw, signature, key);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: DoorEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        if (!intake.ok) throw new Error(intake.error);
        const w = intake.webhook;
        emit({
          kind: "webhook",
          mode: "simulator",
          verified: true,
          requestId: w.meta.request_id,
          eventType: w.data.type,
          subType: w.data.attributes.sub_type,
          deviceId: w.data.attributes.source,
          deviceName: SIM_DEVICES[0].name,
          localTime: scenario.localTime,
          signature: signature.slice(0, 19) + "…",
        });
        await runDoorAgent({
          webhook: w,
          localTime: scenario.localTime,
          expected: parsed.data.expected ?? DEFAULT_EXPECTED,
          previousPackages: scenario.previousPackages,
          scenarioHint: scenario.id,
          emit,
        });
      } catch (err) {
        emit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
