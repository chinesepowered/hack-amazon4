# Devpost submission drafts: Describe My Door

## Basics

- **Name (≤60):** Describe My Door
- **Tagline (≤200):** A Ring app that tells blind and low-vision residents who is at the door: a Strands agent turns doorbell events into short, private spoken descriptions.
- **Primary track:** Ring
- **Mini challenge:** AWS Builder (Strands Agents SDK). Open Source: No.
- **New or existing:** New
- **Repo:** https://github.com/chinesepowered/describe-my-door
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
- **Simulator mode:** the public demo uses a built-in Ring simulator. It emits the same signed v1.1 webhook envelope and runs through the same verification path, clearly labeled "Simulated Ring events". One env var switches to the live Ring API.

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
  - image download to get the doorbell snapshot
  - device configurations and chime audio playback to sound a visitor or package tone
  - devices list for status
- **Ring API documentation and the `ring-api-helloworld` starter:** reference for payload shapes and auth modes.
- **Strands Agents SDK (TypeScript):** agent loop, typed tools, and `BeforeToolCallEvent` / `BeforeModelCallEvent` hooks as deterministic guardrails.
- **Vercel + Next.js:** hosting the webhook endpoint, simulator, and companion app.
- **W&B Inference (OpenAI-compatible):** Qwen3.8 for the agent, Gemma 4 for vision.
- **Web Speech API:** speaking descriptions in the browser.

## Feedback Q2: For each tool, what worked well?

- **Ring Partner API:**
  - The webhook contract is precise: v1.1 envelope, raw-body HMAC with a clear "verify first, parse second" warning, `request_id` for idempotency, and a 5-second response rule. Implementing a correct verifier took minutes.
  - The image download's `at_timestamp` mode maps perfectly to "what did the camera see when the bell rang".
  - The chime docs are unusually honest about what isn't specified yet (volume range, unassigned `audio_ref`).
- **Strands Agents SDK:**
  - Tools with Zod schemas are concise.
  - Hooks are the standout. `event.cancel = "reason"` blocks a tool call and hands the reason back to the model, which reliably rewrote a too-long announcement on the next turn.
  - The OpenAI provider worked with a non-OpenAI endpoint by passing `clientConfig.baseURL`.
  - It ran on Vercel's Node runtime without changes beyond marking the package as a server external.

## Feedback Q3: For each tool, what needs work?

- **Ring chime playback:** only an `audio_ref` already assigned to an app slot can be played, and slot provisioning is "published separately". For accessibility, playing a short generated audio clip (or text-to-speech) on the chime would be transformative.
- **Ring onboarding:** there's no sandbox or webhook replayer before identity verification; the Playground is inside the console. We built our own signed-webhook simulator.
- **Ring starter repo:** `ring-api-helloworld` doesn't match the documented contract. It authenticates webhooks with a Bearer secret instead of `X-Signature` HMAC, and its schema rejects `button_press`.
- **Motion `sub_type`:** has no package classification (`motion`, `human`, `vehicle`, `other_motion`).
- **Ring docs:** the reference is a single 1.3 MB page; an OpenAPI spec and per-endpoint pages would help humans and AI assistants.
- **Strands TypeScript README:** doesn't document hooks; we found `addHook` and `cancel` in the type definitions.
- Full details in `FRICTION_LOG.md`.

## Feedback Q4: How was your onboarding experience (zero to hello world)?

- **Strands TypeScript:** under 15 minutes to a tool-calling agent against an OpenAI-compatible endpoint. Hooks took extra time because we had to read the `.d.ts` files.
- **Ring Partner API:** reading the docs and writing a spec-accurate client and webhook verifier took about an hour. A real hello world (actual devices and webhooks) requires a developer account with government ID verification and, per the get-started page, a device plus Ring Protection plan or trial for staging. We haven't completed that yet, so we built a simulator that follows the documented contract byte for byte.

## Feedback Q5: Would you build with these devices and services again?

Yes. Ring's webhooks plus snapshots are exactly the signal accessibility and caretaking apps need, and the Ring Appstore gives a real path to customers (subscription revenue). Strands hooks made it practical to guarantee privacy rules instead of hoping a prompt holds. We'd build again sooner if the chime could play generated audio and there were a sandbox before identity verification.

## Optional: Feature requests

1. **Dynamic chime audio** (Critical for accessibility): play a short HTTPS audio clip or Polly text on a Chime, consent-gated and rate-limited. It would let the description itself be spoken in the home, not just a tone.
2. **Public webhook replayer / sandbox** (Important): send signed sample events and snapshots to a partner URL before identity verification.
3. **`package` motion sub_type** (Important): package delivery and removal as first-class events.
4. **OpenAPI spec for the Ring Partner API** (Nice-to-have): generate clients and let AI coding tools read the contract accurately.
5. **Strands TypeScript hooks documentation** (Nice-to-have): a README section with a guardrail example.

## Testing instructions

No login. Open https://describe-my-door.vercel.app. The badge reads "Simulated Ring events" because no Ring account or device is needed.

1. In **Ring simulator**, press **Doorbell: someone with a box**. The Strands agent panel shows the signed webhook verified, `fetch_snapshot`, `describe_scene`, `check_expected_visitors`, hook verdicts, then `announce`. The big card speaks and shows the description (turn on sound; toggle "Speak aloud").
2. Press **Doorbell: two visitors knock** (matches "Maria and Tom from next door" by flowers + time).
3. Press **Motion: parcels left on the porch** (package announcement and package chime tone).
4. Press **Doorbell at 19:05**: the same delivery visitor, now outside the expected window, so no match.
5. Add your own expected visitor (e.g. "Plumber · 19:00–20:00 · box") and press the 19:05 button again.
6. Press **R** to repeat the last announcement.

Each run takes about 6–25 s. Rate limit: 12 runs per IP per 10 minutes. Pitch deck: /slides.html.
