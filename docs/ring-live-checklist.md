# Switching Describe My Door from the simulator to a real Ring account

The hackathon rules ask to show the project working "through a simulator or an actual Ring device". Everything below is needed once, before re-recording the final video.

## 1. Create the Ring developer account (the account owner does this)

1. Go to <https://developer.amazon.com/ring/console> and sign in with an Amazon developer account.
2. Complete identity verification (government photo ID; the company profile name must match the ID).
3. Create an app. Note the **client ID**, **client secret** and **HMAC signing key** shown with the partner credentials.
4. Set the **Webhook URL** to `https://<your-deployment>/api/ring/webhook`. For local testing use a tunnel, e.g. `cloudflared tunnel --url http://localhost:3024`, and register the tunnel URL. Ring requires public HTTPS and a 200 within 5 seconds (the route acknowledges immediately and runs the agent afterwards).
5. If you want chime tones: request **Chime Controls** access for the app. Chime audio slots (`ring-appstore-event-1/2`) are provisioned outside the device API.

## 2. Get a token

- Quickest: open the **Developer Playground** (`developer.amazon.com/ring/console/playground`) and copy the access token (valid about 30 minutes).
- Longer sessions: link a Ring account through the app's account-linking flow and store the refresh token.

## 3. Configure environment variables

Local (`.env.local`) or Vercel (`vercel env add ... production`):

```
RING_MODE=live
RING_HMAC_KEY=<HMAC signing key>
RING_ACCESS_TOKEN=<Playground token>        # or the next three
# RING_REFRESH_TOKEN=...
# RING_CLIENT_ID=...
# RING_CLIENT_SECRET=...
RING_DOORBELL_ID=<doorbell device id>        # from GET /v1/devices (shown at /api/ring/status)
RING_CHIME_ID=<chime device id>              # optional
APP_TZ=America/Los_Angeles
```

Do not set `RING_ACCESS_TOKEN` and `RING_REFRESH_TOKEN` together.

## 4. Verify

1. `curl https://<deployment>/api/ring/status` → `"mode":"live"`, your devices, and chime slots.
2. Open the app: the header badge must read **● Live Ring API** and the simulator panel disappears.
3. Trigger an event: press the doorbell, or use the Playground's simulated events. Watch the agent panel: `Ring webhook button_press ✓ HMAC-SHA256 verified`, then `fetch_snapshot` → `describe_scene` → `check_expected_visitors` → `announce`.
4. If no webhook arrives: check the webhook URL, the tunnel, and whether the app is linked to the account that owns the device. The Ring forum reports staging motion events needing a subscription or trial on some accounts.

Known limit: live webhook results reach the browser through an in-process event bus (`lib/bus.ts`). Run a single server (local + tunnel, or one long-running instance) while recording.

## 5. Re-record the demo video

1. `pnpm build && pnpm start -p 3024` with the live env vars.
2. Update `hackathon-amazonappdev2026/narr4/lines.json` so it no longer says "simulated", regenerate TTS, and adapt `scripts/record-4.mjs`: replace the simulator clicks with waiting for a real `[data-testid=row-webhook]` while someone presses the doorbell (or while a Playground event is sent).
3. Compose, check frames, upload publicly, and update the Devpost video URL.
