import { after } from "next/server";
import { acceptWebhook, localTimeOf } from "@/lib/intake";
import { alreadyProcessed, HANDLED_EVENTS } from "@/lib/ring/webhook";
import { runDoorAgent } from "@/lib/agent/door-agent";
import { publish } from "@/lib/bus";
import { getExpected } from "@/lib/expected-store";
import { ringMode } from "@/lib/ring/client";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Live Ring webhook endpoint. Register this URL in the Ring developer console.
// Ring requires a 200 within 5 seconds, so verify + acknowledge immediately and run the agent after the response.
export async function POST(req: Request) {
  const key = process.env.RING_HMAC_KEY;
  if (!key) return Response.json({ error: "RING_HMAC_KEY not configured" }, { status: 500 });

  const raw = await req.text(); // raw bytes: verify first, parse second
  const signature = req.headers.get("x-signature");
  const intake = acceptWebhook(raw, signature, key);
  if (!intake.ok) return Response.json({ error: intake.error }, { status: intake.status });

  const w = intake.webhook;
  if (alreadyProcessed(w.meta.request_id)) return Response.json({ status: "already_processed" });
  if (!(HANDLED_EVENTS as readonly string[]).includes(w.data.type)) return Response.json({ status: "ignored", type: w.data.type });

  const localTime = localTimeOf(w.data.attributes.timestamp);
  publish({
    kind: "webhook",
    mode: ringMode(),
    verified: true,
    requestId: w.meta.request_id,
    eventType: w.data.type,
    subType: w.data.attributes.sub_type,
    deviceId: w.data.attributes.source,
    deviceName: "Front Door",
    localTime,
    signature: (signature ?? "").slice(0, 19) + "…",
  });

  after(async () => {
    try {
      await runDoorAgent({ webhook: w, localTime, expected: getExpected(), previousPackages: 0, emit: publish });
    } catch (err) {
      publish({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
  return Response.json({ status: "accepted", request_id: w.meta.request_id });
}
