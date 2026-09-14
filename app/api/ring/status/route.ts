import { getRingClient, chimeId, doorbellId } from "@/lib/ring/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ring = getRingClient();
  try {
    const [devices, slots] = await Promise.all([ring.listDevices(), ring.chimeSlots(chimeId())]);
    return Response.json({
      ok: true,
      mode: ring.mode,
      agent: "Strands Agents SDK (TypeScript)",
      model: process.env.OPENAI_MODEL ?? null,
      visionModel: process.env.VISION_MODEL || "google/gemma-4-31B-it",
      doorbell: doorbellId(),
      chime: chimeId(),
      devices,
      chimeSlots: slots.map(({ event, audio_name, disabled }) => ({ event, audio_name, disabled })),
    });
  } catch (err) {
    return Response.json({ ok: false, mode: ring.mode, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
