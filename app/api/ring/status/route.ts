import { getRingClient, chimeId, doorbellId, hasToken, ringMode } from "@/lib/ring/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the UI badge and the judges' "is this real?" question need: the mode, which half of the
// Ring surface is live right now, and the devices the API actually returned.
export async function GET() {
  const ring = getRingClient();
  const mode = ringMode();
  try {
    const report = await ring.report();
    const slots = await ring.chimeSlots(chimeId()).catch(() => []);
    return Response.json({
      ok: true,
      mode,
      agent: "Strands Agents SDK (TypeScript)",
      model: process.env.OPENAI_MODEL ?? null,
      visionModel: process.env.VISION_MODEL || "google/gemma-4-31B-it",
      hasToken: hasToken(),
      // Per-capability truth, so nothing in the UI over-claims.
      sources: {
        devices: report.source,
        // Ring cannot deliver Playground events to a partner webhook, and the sandbox serves no
        // recorded footage or chime, so these stay simulated unless a real account is configured.
        events: mode === "live" ? "ring" : "simulated",
        snapshot: mode === "live" ? "ring" : "simulated",
        chime: mode === "live" ? "ring" : "simulated",
      },
      deviceSourceError: report.error ?? null,
      doorbell: doorbellId(),
      chime: chimeId(),
      devices: report.devices,
      capabilities: report.detail?.capabilities ?? null,
      deviceStatus: report.detail?.status ?? null,
      chimeSlots: slots.map(({ event, audio_name, disabled }) => ({ event, audio_name, disabled })),
    });
  } catch (err) {
    return Response.json({ ok: false, mode, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
