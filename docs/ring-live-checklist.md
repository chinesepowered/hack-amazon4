# Running Describe My Door against the real Ring API

The hackathon rules ask to show the project working "through a simulator or an actual Ring device". This is how to run the app against Ring's **Developer Playground** and what it can and cannot do, measured on 16 Sep 2026 with a live Playground token.

## 1. What the Playground actually gives you

With a Developer Playground token (console → Playground → *Generate token*, valid ~30 minutes):

| Call | Result |
| --- | --- |
| `GET /v1/devices` | ✅ one device: **"Playground Device"**, a Doorbell Pro, `online: true` |
| `GET /v1/devices/{id}/capabilities` | ✅ snapshot, privacy zones, colour night vision, 1080p AVC 16:9 |
| `GET /v1/devices/{id}/status` | ✅ `online: true`, `reported_at` |
| `GET /v1/devices/{id}/configurations` | ✅ motion zones, volume — but `audio.customizable_slots: null` |
| `GET /v1/locations` | ✅ one location (US/CA) |
| `GET /v1/history/devices/{id}/events` | ✅ `{"data": []}` — always empty |
| `GET /v1/users/me` | ✅ synthetic "Playground User" |
| `GET /v1/accounts/me/subscriptions` | ❌ 422 |
| `POST /v1/devices/{id}/media/image/download` | ❌ 403 `TIME_RANGE_NOT_AUTHORIZED` with a timestamp (now or −120 s); 403 `REQUEST_FORBIDDEN … missing required timestamp fields` without one |
| `POST /v1/devices/{id}/media/audio/playback` | ❌ 400 validation error (no chime on the account; the token's only scope is `ava.v1:read`) |

So the Playground is a **read-only device sandbox**: no recorded footage, no chime, no webhook delivery to a partner app.

## 2. Hybrid mode (what we ship)

`RING_MODE=hybrid` makes every call the sandbox supports real and clearly labels the rest:

| Part of the demo | Source in hybrid |
| --- | --- |
| Device list, capabilities, status | **Ring Partner API** (badge: "Live Ring device", device name shown next to the simulator) |
| Doorbell / motion event | Simulated (signed v1.1 webhook through the same verification path) |
| Snapshot | Sample image, tagged `SAMPLE IMAGE`, with the Ring error as the tooltip |
| Chime tone | Simulated, tagged "· simulated" next to the chime status |

Without a token, or with an expired one, hybrid degrades to the full simulator and says so; nothing crashes.

## 3. Run it

```bash
# 1. Console → Playground → Generate token, then:
RING_MODE=hybrid
RING_ACCESS_TOKEN=<paste the 30-minute token>
RING_HMAC_KEY=<HMAC signature key from the app's credentials>   # signs simulated events too
# optional, otherwise discovered from GET /v1/devices:
RING_DOORBELL_ID=
RING_CHIME_ID=
```

```bash
pnpm build && pnpm start -p 3024
curl -s localhost:3024/api/ring/status | jq '{mode, sources, devices}'
```

Expect `"mode":"hybrid"`, `sources.devices: "ring"`, and the Playground device in `devices`. The header badge reads **"◐ Live Ring device · simulated events"**, and the simulator panel shows `● Ring API: Playground Device`.

## 4. Fully live (real Ring account with hardware)

`RING_MODE=live` sends everything to `api.amazonvision.com`. It needs a Ring account with a device and a Ring Protection plan, plus the app's webhook URL registered in the console's Configure step (`https://<deployment>/api/ring/webhook`, or a tunnel such as `cloudflared tunnel --url http://localhost:3024`). Ring requires a 200 within 5 s; the route acknowledges immediately and runs the agent in `after()`. Live webhook results reach the browser through an in-process bus, so run a single instance while recording.

## 5. Re-recording the demo video

1. Paste a fresh token, start the production build in hybrid mode, and confirm the badge.
2. Record with `scripts/record-4.mjs` (from `_hackathon/hackathon-amazonappdev2026`). The narration already says which half is live; if the wording changes, regenerate only the changed lines with `tts.py`.
3. Compose, check frames, upload, and update the Devpost video URL.
