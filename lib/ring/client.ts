import fs from "node:fs/promises";
import path from "node:path";
import { SCENARIOS } from "@/lib/sim/scenarios";

// One interface, two implementations: the real Ring Partner API (Amazon Vision API) and a local
// simulator that returns the same JSON:API shapes. Switch with RING_MODE=live|simulator.

export type RingMode = "live" | "simulator";
export const ringMode = (): RingMode => (process.env.RING_MODE === "live" ? "live" : "simulator");

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
}

export interface RingClient {
  mode: RingMode;
  listDevices(): Promise<RingDevice[]>;
  /** POST /v1/devices/{id}/media/image/download (type: at_timestamp), following the 303 redirect. */
  downloadSnapshot(deviceId: string, timestamp: number, hint?: string): Promise<Snapshot>;
  /** GET /v1/devices/{id}/configurations → data.attributes.audio.customizable_slots */
  chimeSlots(chimeId: string): Promise<ChimeSlot[]>;
  /** POST /v1/devices/{id}/media/audio/playback with the slot's audio_ref. */
  playChime(chimeId: string, audioRef: string): Promise<{ status: string; audio_ref: string }>;
}

const BASE = "https://api.amazonvision.com";
let cached: { token: string; exp: number } | null = null;

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

const live: RingClient = {
  mode: "live",
  async listDevices() {
    const res = await ringFetch("/v1/devices");
    if (!res.ok) throw new Error(`GET /v1/devices ${res.status}`);
    const j = (await res.json()) as { data: { id: string; attributes: { name: string; device_type: string } }[] };
    return j.data.map((d) => ({ id: d.id, name: d.attributes.name, device_type: d.attributes.device_type }));
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
    if (!img.ok) throw new Error(`image download ${img.status}`);
    return { bytes: Buffer.from(await img.arrayBuffer()), mime: img.headers.get("Content-Type") ?? "image/jpeg" };
  },
  async chimeSlots(chimeId) {
    const res = await ringFetch(`/v1/devices/${chimeId}/configurations`);
    if (!res.ok) throw new Error(`GET configurations ${res.status}`);
    const j = (await res.json()) as { data: { attributes: { audio?: { customizable_slots?: ChimeSlot[] } } } };
    return [...(j.data.attributes.audio?.customizable_slots ?? [])].sort((a, b) => a.event.localeCompare(b.event));
  },
  async playChime(chimeId, audioRef) {
    const res = await ringFetch(`/v1/devices/${chimeId}/media/audio/playback`, {
      method: "POST",
      body: JSON.stringify({ data: { type: "audio", attributes: { audio_ref: audioRef } } }),
    });
    if (!res.ok) throw new Error(`chime playback ${res.status}`);
    const j = (await res.json()) as { data: { id: string; attributes: { status: string } } };
    return { status: j.data.attributes.status, audio_ref: j.data.id };
  },
};

export const SIM_DEVICES: RingDevice[] = [
  { id: "sim-doorbell-front", name: "Front Door", device_type: "doorbell" },
  { id: "sim-chime-hall", name: "Hallway Chime", device_type: "chime" },
];
const SIM_SLOTS: ChimeSlot[] = [
  { event: "ring-appstore-event-1", disabled: false, audio_ref: "sim-audio-visitor", audio_name: "Visitor tone" },
  { event: "ring-appstore-event-2", disabled: false, audio_ref: "sim-audio-package", audio_name: "Package tone" },
];

const simulator: RingClient = {
  mode: "simulator",
  async listDevices() {
    return SIM_DEVICES;
  },
  async downloadSnapshot(_deviceId, _timestamp, hint) {
    const scenario = SCENARIOS.find((s) => s.id === hint) ?? SCENARIOS[0];
    const bytes = await fs.readFile(path.join(process.cwd(), "public", scenario.image));
    return { bytes, mime: "image/jpeg" };
  },
  async chimeSlots() {
    return SIM_SLOTS;
  },
  async playChime(_chimeId, audioRef) {
    return { status: "completed", audio_ref: audioRef };
  },
};

export const getRingClient = (): RingClient => (ringMode() === "live" ? live : simulator);
export const doorbellId = () => process.env.RING_DOORBELL_ID ?? SIM_DEVICES[0].id;
export const chimeId = () => process.env.RING_CHIME_ID ?? SIM_DEVICES[1].id;
