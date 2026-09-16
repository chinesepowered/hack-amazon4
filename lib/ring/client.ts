import fs from "node:fs/promises";
import path from "node:path";
import { SCENARIOS } from "@/lib/sim/scenarios";

// One interface, three implementations of the Ring Partner API (Amazon Vision API):
//
//   live      every call goes to api.amazonvision.com
//   hybrid    reads that the Ring Developer Playground actually serves (devices, capabilities,
//             status, configurations) are real; everything the sandbox cannot do is simulated
//             and labeled as such in the UI
//   simulator no network at all; the whole Ring surface is faked with the documented shapes
//
// Why hybrid exists: with a Playground token (scope `ava.v1:read`) the sandbox account holds a
// single Doorbell Pro, `POST /media/image/download` answers 403 TIME_RANGE_NOT_AUTHORIZED for any
// timestamp, `configurations.audio.customizable_slots` is null and audio playback is rejected.
// So snapshots, chime audio and the events themselves stay simulated, and every panel says which
// half it is looking at. See docs/ring-live-checklist.md.

export type RingMode = "live" | "hybrid" | "simulator";
export type Source = "ring" | "simulated";

export const ringMode = (): RingMode => {
  const m = process.env.RING_MODE;
  return m === "live" || m === "hybrid" ? m : "simulator";
};

export interface RingDevice {
  id: string;
  name: string;
  device_type: string;
}
export interface ChimeSlot {
  event: string;
  disabled: boolean;
  audio_ref: string;
  audio_url?: string;
  audio_name?: string;
}
export interface Snapshot {
  bytes: Buffer;
  mime: string;
  source: Source;
  /** Why this came from the simulator, when it did. Shown in the UI and the activity feed. */
  note?: string;
}
export interface ChimePlayback {
  status: string;
  audio_ref: string;
  source: Source;
  note?: string;
}
export interface DeviceReport {
  devices: RingDevice[];
  source: Source;
  /** Raw capabilities/status of the first device, when the API served them. */
  detail?: { capabilities?: unknown; status?: unknown };
  error?: string;
}

export interface RingClient {
  mode: RingMode;
  listDevices(): Promise<RingDevice[]>;
  /** Devices plus where they came from, for the status route and the UI badge. */
  report(): Promise<DeviceReport>;
  /** POST /v1/devices/{id}/media/image/download (type: at_timestamp), following the 303 redirect. */
  downloadSnapshot(deviceId: string, timestamp: number, hint?: string): Promise<Snapshot>;
  /** GET /v1/devices/{id}/configurations → data.attributes.audio.customizable_slots */
  chimeSlots(chimeId: string): Promise<ChimeSlot[]>;
  /** POST /v1/devices/{id}/media/audio/playback with the slot's audio_ref. */
  playChime(chimeId: string, audioRef: string): Promise<ChimePlayback>;
}

const BASE = "https://api.amazonvision.com";
let cached: { token: string; exp: number } | null = null;

export const hasToken = () => !!(process.env.RING_ACCESS_TOKEN || process.env.RING_REFRESH_TOKEN);

async function accessToken(): Promise<string> {
  if (process.env.RING_ACCESS_TOKEN) return process.env.RING_ACCESS_TOKEN;
  if (!process.env.RING_REFRESH_TOKEN) throw new Error("Set RING_ACCESS_TOKEN (Playground) or RING_REFRESH_TOKEN");
  if (cached && Date.now() < cached.exp) return cached.token;
  const res = await fetch("https://oauth.ring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.RING_REFRESH_TOKEN,
      client_id: process.env.RING_CLIENT_ID ?? "",
      client_secret: process.env.RING_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Ring token refresh failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return j.access_token;
}

async function ringFetch(p: string, init: RequestInit = {}) {
  const res = await fetch(BASE + p, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) throw new Error(`Ring rate limit; retry after ${res.headers.get("Retry-After")}s`);
  return res;
}

/** Ring returns JSON:API errors; surface the code so the UI can explain a 403 honestly. */
async function ringError(res: Response, what: string) {
  const body = (await res.json().catch(() => null)) as { errors?: { code?: string; detail?: string }[] } | null;
  const first = body?.errors?.[0];
  return new Error(`${what} ${res.status}${first?.code ? ` ${first.code}` : ""}${first?.detail ? `: ${first.detail}` : ""}`);
}

async function liveDevices(): Promise<RingDevice[]> {
  const res = await ringFetch("/v1/devices");
  if (!res.ok) throw await ringError(res, "GET /v1/devices");
  const j = (await res.json()) as { data: { id: string; attributes: { name: string; device_type?: string; image_url?: string } }[] };
  return j.data.map((d) => ({
    id: d.id,
    name: d.attributes.name,
    // The sandbox omits device_type; the product image path carries the model (…/DoorbellPro/…).
    device_type: d.attributes.device_type ?? d.attributes.image_url?.split("/").at(-2) ?? "device",
  }));
}

async function liveDetail(deviceId: string) {
  const [caps, status] = await Promise.all([
    ringFetch(`/v1/devices/${deviceId}/capabilities`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ringFetch(`/v1/devices/${deviceId}/status`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { capabilities: caps ?? undefined, status: status ?? undefined };
}

async function liveChimeSlots(chimeId: string): Promise<ChimeSlot[]> {
  const res = await ringFetch(`/v1/devices/${chimeId}/configurations`);
  if (!res.ok) throw await ringError(res, "GET configurations");
  const j = (await res.json()) as { data: { attributes: { audio?: { customizable_slots?: ChimeSlot[] | null } } } };
  return [...(j.data.attributes.audio?.customizable_slots ?? [])].sort((a, b) => a.event.localeCompare(b.event));
}

export const SIM_DEVICES: RingDevice[] = [
  { id: "sim-doorbell-front", name: "Front Door", device_type: "doorbell" },
  { id: "sim-chime-hall", name: "Hallway Chime", device_type: "chime" },
];
const SIM_SLOTS: ChimeSlot[] = [
  { event: "ring-appstore-event-1", disabled: false, audio_ref: "sim-audio-visitor", audio_name: "Visitor tone" },
  { event: "ring-appstore-event-2", disabled: false, audio_ref: "sim-audio-package", audio_name: "Package tone" },
];

async function fixtureSnapshot(hint: string | undefined, note: string): Promise<Snapshot> {
  const scenario = SCENARIOS.find((s) => s.id === hint) ?? SCENARIOS[0];
  const bytes = await fs.readFile(path.join(process.cwd(), "public", scenario.image));
  return { bytes, mime: "image/jpeg", source: "simulated", note };
}

const SANDBOX_SNAPSHOT_NOTE = "Playground has no recorded footage (403 TIME_RANGE_NOT_AUTHORIZED); sample image";
const SANDBOX_CHIME_NOTE = "Playground account has no chime (customizable_slots: null); tone simulated";

const live: RingClient = {
  mode: "live",
  listDevices: liveDevices,
  async report() {
    const devices = await liveDevices();
    return { devices, source: "ring", detail: devices[0] ? await liveDetail(devices[0].id) : undefined };
  },
  async downloadSnapshot(deviceId, timestamp) {
    const res = await ringFetch(`/v1/devices/${deviceId}/media/image/download`, {
      method: "POST",
      body: JSON.stringify({ type: "at_timestamp", timestamp, image_options: { format: "jpeg", resolution: { width: 1280, height: 720 } } }),
      redirect: "manual",
    });
    let img = res;
    if (res.status === 303 || res.status === 302) {
      const loc = res.headers.get("Location");
      if (!loc) throw new Error("image download: redirect without Location");
      img = await fetch(loc, { signal: AbortSignal.timeout(15_000) });
    }
    if (!img.ok) throw await ringError(img, "image download");
    return { bytes: Buffer.from(await img.arrayBuffer()), mime: img.headers.get("Content-Type") ?? "image/jpeg", source: "ring" };
  },
  chimeSlots: liveChimeSlots,
  async playChime(chimeId, audioRef) {
    const res = await ringFetch(`/v1/devices/${chimeId}/media/audio/playback`, {
      method: "POST",
      body: JSON.stringify({ data: { type: "audio", attributes: { audio_ref: audioRef } } }),
    });
    if (!res.ok) throw await ringError(res, "chime playback");
    const j = (await res.json()) as { data: { id: string; attributes: { status: string } } };
    return { status: j.data.attributes.status, audio_ref: j.data.id, source: "ring" };
  },
};

const simulator: RingClient = {
  mode: "simulator",
  async listDevices() {
    return SIM_DEVICES;
  },
  async report() {
    return { devices: SIM_DEVICES, source: "simulated" };
  },
  async downloadSnapshot(_deviceId, _timestamp, hint) {
    return fixtureSnapshot(hint, "simulator fixture");
  },
  async chimeSlots() {
    return SIM_SLOTS;
  },
  async playChime(_chimeId, audioRef) {
    return { status: "completed", audio_ref: audioRef, source: "simulated" };
  },
};

// Hybrid: real reads where the Playground serves them, simulated (and labeled) everywhere else.
// Any live read that fails degrades to the simulator rather than breaking the demo.
const hybrid: RingClient = {
  mode: "hybrid",
  async listDevices() {
    return (await hybrid.report()).devices;
  },
  async report() {
    if (!hasToken()) return { devices: SIM_DEVICES, source: "simulated", error: "no RING_ACCESS_TOKEN" };
    try {
      const devices = await liveDevices();
      if (!devices.length) return { devices: SIM_DEVICES, source: "simulated", error: "Ring account has no devices" };
      return { devices, source: "ring", detail: await liveDetail(devices[0].id) };
    } catch (err) {
      return { devices: SIM_DEVICES, source: "simulated", error: err instanceof Error ? err.message : String(err) };
    }
  },
  async downloadSnapshot(deviceId, timestamp, hint) {
    if (!hasToken()) return fixtureSnapshot(hint, "no Ring token; sample image");
    try {
      const snap = await live.downloadSnapshot(deviceId, timestamp);
      return snap;
    } catch (err) {
      const why = err instanceof Error && /TIME_RANGE_NOT_AUTHORIZED|REQUEST_FORBIDDEN/.test(err.message) ? SANDBOX_SNAPSHOT_NOTE : `Ring image download failed; sample image (${err instanceof Error ? err.message : err})`;
      return fixtureSnapshot(hint, why);
    }
  },
  async chimeSlots(chimeId) {
    if (!hasToken()) return SIM_SLOTS;
    try {
      const slots = await liveChimeSlots(chimeId);
      return slots.length ? slots : SIM_SLOTS;
    } catch {
      return SIM_SLOTS;
    }
  },
  async playChime(_chimeId, audioRef) {
    return { status: "completed", audio_ref: audioRef, source: "simulated", note: SANDBOX_CHIME_NOTE };
  },
};

export const getRingClient = (): RingClient => {
  const mode = ringMode();
  return mode === "live" ? live : mode === "hybrid" ? hybrid : simulator;
};

/** In hybrid mode the doorbell id is discovered at runtime (sandbox ids change per token). */
export const doorbellId = () => process.env.RING_DOORBELL_ID ?? SIM_DEVICES[0].id;
export const chimeId = () => process.env.RING_CHIME_ID ?? SIM_DEVICES[1].id;

/** The device the agent should ask for, preferring a real one discovered from the API. */
export async function resolveDoorbellId(): Promise<string> {
  if (process.env.RING_DOORBELL_ID) return process.env.RING_DOORBELL_ID;
  if (ringMode() === "simulator" || !hasToken()) return SIM_DEVICES[0].id;
  try {
    const devices = await getRingClient().listDevices();
    const cam = devices.find((d) => /doorbell|cam/i.test(d.device_type) || /doorbell|door|cam/i.test(d.name));
    return (cam ?? devices[0])?.id ?? SIM_DEVICES[0].id;
  } catch {
    return SIM_DEVICES[0].id;
  }
}
