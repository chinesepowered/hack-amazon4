# Devpost submission drafts: Describe My Door

## Basics

- **Name (≤60):** Describe My Door
- **Tagline (≤200):** A Ring app that tells blind and low-vision residents who is at the door: a Strands agent turns doorbell events into short, private spoken descriptions.
- **Primary track:** Ring
- **Mini challenge:** AWS Builder (Strands Agents SDK). Open Source: No.
- **New or existing:** New
- **Repo:** https://github.com/chinesepowered/hack-amazon4
- **Testing link:** https://describe-my-door.vercel.app
- **Built with:** ring-partner-api, strands-agents-sdk, typescript, next.js, react, vercel, zod, openai-compatible-api, qwen, gemma, weights-and-biases-inference, web-speech-api, playwright, elevenlabs

## Description (markdown)

**Describe My Door** tells blind and low-vision residents who is at their Ring doorbell, in plain spoken words.

When someone presses the doorbell or leaves a package, a **Strands agent** takes over:
1. It downloads the Ring snapshot at the event time.
2. A vision model describes what is visible: clothing, carried objects, packages.
3. It checks the caregiver's list of expected visitors, matching only by time window and visible clues, never faces.
4. It announces one short sentence on the resident's phone, and the Ring Chime plays a matching tone.

> "This may be Maria and Tom from next door: two people at the door, one in a grey shirt carrying yellow flowers."

### The problem
Approximately 7 million people in the United States have vision impairment, including 1 million with blindness (CDC). A video doorbell is a screen. For them, "who's there?" still means opening the door to a stranger or calling someone to look at the camera.

### How it works
- **Ring Partner API:**
  - Webhook v1.1 intake with HMAC-SHA256 `X-Signature` verification over the raw body, idempotency on `request_id`, and a 200 in under 5 s.
  - `GET /v1/devices`, `/capabilities`, `/status` for the devices on the account (live in hybrid mode).
  - `POST /v1/devices/{id}/media/image/download` (at_timestamp).
  - Chime `configurations` → `customizable_slots` → `POST /media/audio/playback` with the slot's `audio_ref`.
- **Strands Agents SDK (TypeScript):** four tools (`fetch_snapshot`, `describe_scene`, `check_expected_visitors`, `announce`). The deterministic guardrails are `BeforeToolCallEvent` hooks:
  - step order
  - privacy: no gender, age, race, religion, health or names
  - at most 28 words
  - category and label consistency
  - one announcement per event

  When a hook blocks, the agent sees the reason and rewrites. The demo shows a real block and retry. Every tool call and hook verdict streams to the UI.
- **Accessible companion app:** speech synthesis, ARIA live region, vibration, Atkinson Hyperlegible type, a "Repeat (R)" shortcut, and today's history. High-contrast, screen-reader-first layout.

### What is real Ring, and what is simulated
We hold a Ring developer account with a private app, and the demo runs in one of three modes (`RING_MODE`), with every element labeled in the UI:

- **Hybrid** (with a Developer Playground token): device list, capabilities and status are **live Ring Partner API** calls; the doorbell event, the snapshot and the chime tone are simulated.
- **Simulator** (the public demo, which carries no token): everything is simulated, using the documented Ring shapes and the same signature-verification path.
- **Live**: every call goes to Ring; needs an account with hardware.

Measured on the Playground with a live token (scope `ava.v1:read`): one Doorbell Pro on the account; `media/image/download` returns 403 `TIME_RANGE_NOT_AUTHORIZED` for every timestamp; `configurations.audio.customizable_slots` is `null` and audio playback returns 400; event history is always empty; and the Playground's simulate buttons only open a WHEP live-view session in the browser rather than delivering an event to the app. Details in FRICTION_LOG.md #6 and #7.

Privacy by design: no face recognition, no identity guesses, snapshots not stored. All people in the demo are fictional; the photos are Pexels-licensed stock.

## Existing project explanation
N/A (new project, built during the submission window).

## AWS Builder mini challenge: which AWS services and how

We used the **Strands Agents SDK** (TypeScript, `@strands-agents/sdk` 1.17) as the agent runtime, inside a Next.js route handler on Vercel.
- `Agent` with four Zod-typed `tool()`s that call the Ring Partner API and a vision model.
- `BeforeToolCallEvent` hooks enforce six deterministic rules (order, privacy, length, category, caregiver label, one announcement), cancelling unsafe tool calls with a reason the model can act on.
- A `BeforeModelCallEvent` hook caps model calls per event.
- Hook verdicts and tool progress stream to the UI so the decision trail is visible.

The model is plugged in through Strands' `OpenAIModel` (Qwen3.8-27B for the agent, Gemma 4 31B for vision, via an OpenAI-compatible endpoint). Because Strands is model-agnostic, the same tools and hooks run on Amazon Bedrock by swapping the model provider. We did not use Bedrock or AgentCore for this build.

## Feedback Q1: Which developer tools, APIs, and SDKs did you use and for what?

- **Ring Partner API (Amazon Vision API):**
  - webhooks v1.1 (`button_press`, `motion_detected` with `sub_type`) to trigger the agent
  - devices, capabilities and status reads (live against our developer account)
  - image download to get the doorbell snapshot
  - device configurations and chime audio playback to sound a visitor or package tone
- **Ring Developer Console and Playground:** created two private apps (Cameras and Doorbells + Chimes scopes) and used Playground tokens to test the API.
- **Ring API documentation and the `ring-api-helloworld` starter:** reference for payload shapes and auth modes.
- **Strands Agents SDK (TypeScript):** agent loop, typed tools, and `BeforeToolCallEvent` / `BeforeModelCallEvent` hooks as deterministic guardrails.
- **Vercel + Next.js:** hosting the webhook endpoint, simulator, and companion app.
- **W&B Inference (OpenAI-compatible):** Qwen3.8 for the agent, Gemma 4 for vision.
- **Web Speech API:** speaking descriptions in the browser.

## Feedback Q2: For each tool, what worked well?

- **Ring Partner API:**
  - The webhook contract is precise: v1.1 envelope, raw-body HMAC with a clear "verify first, parse second" warning, `request_id` for idempotency, and a 5-second response rule. Implementing a correct verifier took minutes.
  - Device reads are clean JSON:API and worked first time with a Playground token; `capabilities` tells you exactly what a camera supports (snapshot, privacy zones, night vision, resolutions).
  - The image download's `at_timestamp` mode maps perfectly to "what did the camera see when the bell rang".
  - The chime docs are unusually honest about what isn't specified yet (volume range, unassigned `audio_ref`).
- **Ring Developer Console:** creating a private app took minutes, scopes are explained per device group, and the credentials page is clear about what each key is for.
- **Strands Agents SDK:**
  - Tools with Zod schemas are concise.
  - Hooks are the standout. `event.cancel = "reason"` blocks a tool call and hands the reason back to the model, which reliably rewrote a too-long announcement on the next turn.
  - The OpenAI provider worked with a non-OpenAI endpoint by passing `clientConfig.baseURL`.
  - It ran on Vercel's Node runtime without changes beyond marking the package as a server external.

## Feedback Q3: For each tool, what needs work?

- **The Developer Playground is read-only, and that blocks the interesting half.** With a Playground token: image download returns 403 `TIME_RANGE_NOT_AUTHORIZED` for any timestamp (and `REQUEST_FORBIDDEN` without one), so no snapshot can be fetched; `audio.customizable_slots` is `null` and playback returns 400; event history is always empty; and the "Simulate live view event" buttons only start a WHEP session in the browser instead of delivering an event to a registered app. A partner with no hardware therefore cannot exercise snapshots, chimes or webhooks at all.
- **One device in the sandbox** (a single Doorbell Pro), so multi-camera products can't be tested.
- **Ring chime playback:** only an `audio_ref` already assigned to an app slot can be played, and slot provisioning is "published separately". For accessibility, playing a short generated audio clip (or text-to-speech) on the chime would be transformative.
- **Ring onboarding:** identity verification with a government ID is required before any console access, and the get-started page's prerequisites (a device plus a Ring Protection plan) contradict the hackathon's "no device required".
- **Ring starter repo:** `ring-api-helloworld` doesn't match the documented contract. It authenticates webhooks with a Bearer secret instead of `X-Signature` HMAC, and its schema rejects `button_press`.
- **Motion `sub_type`:** has no package classification (`motion`, `human`, `vehicle`, `other_motion`).
- **Ring docs:** the reference is a single 1.3 MB page; an OpenAPI spec and per-endpoint pages would help humans and AI assistants.
- **Strands TypeScript README:** doesn't document hooks; we found `addHook` and `cancel` in the type definitions.
- Full details in `FRICTION_LOG.md`.

## Feedback Q4: How was your onboarding experience (zero to hello world)?

- **Strands TypeScript:** under 15 minutes to a tool-calling agent against an OpenAI-compatible endpoint. Hooks took extra time because we had to read the `.d.ts` files.
- **Ring Partner API:** reading the docs and writing a spec-accurate client and webhook verifier took about an hour. Creating the developer account and a private app was quick once the government-ID check passed, and a Playground token is one click. The disappointment came after: the token is read-only and the sandbox has no footage, no chime and no webhook delivery, so "hello world" stops at listing one device. We built a simulator that follows the documented contract byte for byte, and a hybrid mode that keeps the real device reads live.

## Feedback Q5: Would you build with these devices and services again?

Yes. Ring's webhooks plus snapshots are exactly the signal accessibility and caretaking apps need, and the Ring Appstore gives a real path to customers (subscription revenue). Strands hooks made it practical to guarantee privacy rules instead of hoping a prompt holds. We'd build again faster if the Playground could serve a snapshot, expose a virtual chime, and post its simulated events to our webhook URL.

## Optional: Feature requests

1. **A Playground that can exercise an app end to end** (Critical): canned footage for image download, a virtual chime with app slots, and "deliver simulated events to my webhook URL". Today a partner without hardware cannot test the parts that matter.
2. **Dynamic chime audio** (Critical for accessibility): play a short HTTPS audio clip or Polly text on a Chime, consent-gated and rate-limited. It would let the description itself be spoken in the home, not just a tone.
3. **`package` motion sub_type** (Important): package delivery and removal as first-class events.
4. **OpenAPI spec for the Ring Partner API** (Nice-to-have): generate clients and let AI coding tools read the contract accurately.
5. **Strands TypeScript hooks documentation** (Nice-to-have): a README section with a guardrail example.

## Testing instructions

No login. Open https://describe-my-door.vercel.app. The badge shows which mode it is in: the public demo carries no Ring token, so it reads "Simulated Ring events" (with a token it reads "Live Ring device · simulated events" and names the real device).

1. In **Ring simulator**, press **Doorbell: someone with a box**. The Strands agent panel shows the signed webhook verified, `fetch_snapshot`, `describe_scene`, `check_expected_visitors`, hook verdicts, then `announce`. The big card speaks and shows the description (turn on sound; toggle "Speak aloud").
2. Press **Doorbell: two visitors knock** (matches "Maria and Tom from next door" by flowers + time).
3. Press **Motion: parcels left on the porch** (package announcement and package chime tone).
4. Press **Doorbell at 19:05**: the same delivery visitor, now outside the expected window, so no match.
5. Add your own expected visitor (e.g. "Plumber · 19:00–20:00 · box") and press the 19:05 button again.
6. Press **R** to repeat the last announcement.

Labels to look for: the camera tile says `SAMPLE IMAGE` when the picture is not from Ring, the chime line says "· simulated", and the webhook row is tagged "simulated". `GET /api/ring/status` returns the mode and a per-capability `sources` map.

Each run takes about 6–25 s. Rate limit: 12 runs per IP per 10 minutes. Pitch deck: /slides.html.
