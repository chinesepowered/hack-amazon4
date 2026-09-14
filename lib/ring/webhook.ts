import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";

// Ring webhook v1.1 envelope, as documented in the Ring Partner API
// (developer.amazon.com/docs/ring/api-documentation.html, "Webhook v1.1 Payload Structure").
export const RingWebhookSchema = z.object({
  meta: z.object({
    version: z.string(),
    time: z.string(),
    request_id: z.string(),
    account_id: z.string().optional(),
  }),
  data: z.object({
    id: z.string(),
    type: z.string(),
    attributes: z
      .object({
        source: z.string(),
        source_type: z.string(),
        timestamp: z.number(),
        timestamp_readable: z.string().optional(),
        // motion_detected only: motion | human | vehicle | other_motion
        sub_type: z.string().optional(),
        component_ids: z.array(z.string()).optional(),
      })
      .passthrough(),
    relationships: z
      .object({ devices: z.object({ links: z.object({ self: z.string() }).partial() }).partial() })
      .partial()
      .optional(),
  }),
});
export type RingWebhook = z.infer<typeof RingWebhookSchema>;

export const HANDLED_EVENTS = ["button_press", "motion_detected"] as const;

/** Ring signs the raw body bytes with HMAC-SHA256 and sends `X-Signature: sha256=<hex>`. */
export function signBody(rawBody: string, key: string): string {
  return "sha256=" + createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
}

/** Verify first, parse second: the digest must be computed over the body exactly as received. */
export function verifySignature(rawBody: string, header: string | null, key: string): boolean {
  if (!header || !key) return false;
  const expected = Buffer.from(signBody(rawBody, key));
  const received = Buffer.from(header.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Build a v1.1 payload with the same shape Ring sends (used by the simulator). */
export function buildWebhook(opts: {
  type: "button_press" | "motion_detected";
  deviceId: string;
  accountId: string;
  timestamp: number;
  subType?: string;
}): RingWebhook {
  const { type, deviceId, accountId, timestamp, subType } = opts;
  const idPart = type === "motion_detected" ? "motion" : type;
  return {
    meta: { version: "1.1", time: new Date().toISOString(), request_id: randomUUID(), account_id: accountId },
    data: {
      id: `${deviceId}_${idPart}_${timestamp}`,
      type,
      attributes: {
        source: deviceId,
        source_type: "devices",
        timestamp,
        timestamp_readable: new Date(timestamp).toISOString().replace("T", " ").slice(0, 19),
        ...(type === "motion_detected" ? { sub_type: subType ?? "human" } : {}),
      },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}

const seen = new Map<string, number>();
/** Idempotency on meta.request_id (Ring retries deliveries). */
export function alreadyProcessed(requestId: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 15 * 60_000) seen.delete(k);
  if (seen.has(requestId)) return true;
  seen.set(requestId, now);
  return false;
}
