import { RingWebhookSchema, verifySignature, type RingWebhook } from "@/lib/ring/webhook";

// Shared by the live webhook route and the simulator, so both exercise the same verification path:
// verify the HMAC over the raw bytes first, then parse and validate the v1.1 envelope.

export type IntakeResult =
  | { ok: true; webhook: RingWebhook }
  | { ok: false; status: 401 | 400 | 422; error: string };

export function acceptWebhook(rawBody: string, signatureHeader: string | null, key: string): IntakeResult {
  if (!verifySignature(rawBody, signatureHeader, key)) return { ok: false, status: 401, error: "invalid X-Signature" };
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "body is not JSON" };
  }
  const parsed = RingWebhookSchema.safeParse(json);
  if (!parsed.success) return { ok: false, status: 422, error: "not a Ring webhook v1.1 payload" };
  return { ok: true, webhook: parsed.data };
}

/** Local wall clock for the resident, from the event timestamp. */
export function localTimeOf(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: process.env.APP_TZ || "America/Los_Angeles" }).format(
    new Date(timestamp),
  );
}
