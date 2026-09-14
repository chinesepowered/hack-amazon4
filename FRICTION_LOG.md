# Friction log: Describe My Door

Real issues we hit while building on the Ring Partner API and the Strands Agents SDK during the hackathon (September 2026). Severity: **High** = blocked or forced a redesign; **Medium** = cost real time or would cause a bug; **Low** = annoyance.

---

## 1. Chime playback can't play dynamic audio, which is the obvious accessibility use case

- **Task:** Speak a generated description ("a person in a green delivery jacket holding a box") through the resident's Ring Chime.
- **Steps:** Read *Chimes → Playing audio on a chime* and *Chime configurations* in the Ring Partner API docs.
- **Expected:** A playback request that accepts an audio URL or text (TTS), or a way to upload a clip to one of the app's slots.
- **Actual:** `POST /v1/devices/{id}/media/audio/playback` only accepts an `audio_ref` that already occupies one of the app's `customizable_slots` (two on Chime Pro). The docs state that assigning audio to a slot "is not a device API operation" and that provisioning guidance "is published separately". We could not find that guidance.
- **Severity:** High (for accessibility and caretaking apps).
- **Workaround:** The chime plays a category tone (slot 1 visitor, slot 2 package). The full spoken description is delivered on the companion web app with the browser's speech synthesis and an ARIA live region.
- **Suggestion:** Let partners play a short HTTPS audio URL (or text via Amazon Polly) on a chime, rate-limited and consent-gated. At minimum, link the slot provisioning guide from the playback section.

## 2. No way to try the API or receive webhooks before identity verification

- **Task:** Develop and demo a webhook-driven app before (or without) a Ring developer account and device.
- **Steps:** Read *Get started* and the console docs; looked for a public sandbox, sample webhook payload replayer, or test credentials.
- **Expected:** A sandbox token, or a documented webhook replay tool, usable before account setup.
- **Actual:** The Developer Playground lives inside the console, which requires creating a developer account with government photo ID verification. The get-started prerequisites also list a physical device and a Ring Protection plan or trial for staging.
- **Severity:** High (for hackathon onboarding).
- **Workaround:** We built a local Ring simulator that emits byte-for-byte v1.1 webhook envelopes signed with HMAC-SHA256 and runs them through the same verification path as the live endpoint (`app/api/sim/doorbell/route.ts`, `lib/intake.ts`). The UI labels it "Simulated Ring events".
- **Suggestion:** Publish a public webhook payload replayer (or a CLI like `ring-dev send-webhook button_press --to <url> --key <hmac>`) and sample snapshot fixtures.

## 3. The official starter doesn't match the documented webhook contract

- **Task:** Reuse webhook handling from `AmazonAppDev/ring-api-helloworld`.
- **Steps:** Read `app/api/webhook/route.ts` and `lib/schemas/webhook.ts` in the starter; compared with *Webhook Authentication & Verification* and *Webhook v1.1 Payload Structure* in the docs.
- **Expected:** HMAC-SHA256 verification of the raw body against `X-Signature: sha256=<hex>`, and a schema that accepts `button_press`.
- **Actual:** The starter authenticates with `Authorization: Bearer ${RING_WEBHOOK_SECRET}` and never checks `X-Signature`. Its Zod enum for `data.type` is `motion_detected | device_added | device_removed | person_detected`, so a real `button_press` falls back to "generic" handling. It models `confidence`, `bounding_box` and `thumbnail_url`, which the v1.1 docs don't list, but not `meta.account_id` or `attributes.sub_type`.
- **Severity:** Medium (copying the starter would ship an endpoint that accepts unsigned requests).
- **Workaround:** Wrote our own verifier (verify raw bytes first, parse second) and a v1.1 Zod schema (`lib/ring/webhook.ts`).
- **Suggestion:** Update the starter to the v1.1 contract and include an HMAC verification test.

## 4. No package classification in motion events

- **Task:** Announce "a package was left at your door".
- **Steps:** Read *Motion Detection* for `attributes.sub_type` values.
- **Expected:** A `package` (delivery) sub_type, since package management is a promoted use case.
- **Actual:** Valid values are `motion`, `human`, `vehicle`, `other_motion`.
- **Severity:** Medium.
- **Workaround:** On `motion_detected`, download the snapshot and count unattended packages with a vision model, comparing with the previous count.
- **Suggestion:** Expose package detection as a sub_type (Ring apps already detect packages), or document that partners should run their own.

## 5. The API reference is one 1.3 MB page

- **Task:** Get exact request bodies for image download and chime playback.
- **Steps:** Opened `developer.amazon.com/docs/ring/api-documentation.html`; also tried an AI summarizer on it.
- **Expected:** Per-endpoint pages or an OpenAPI spec.
- **Actual:** Every section lives on one page (~40,000 lines of extracted text). A summarizer returned a wrong playback body (`{"audio_ref": "..."}` instead of the JSON:API `{"data":{"type":"audio","attributes":{"audio_ref":"..."}}}`). We had to download the page and grep it.
- **Severity:** Low to medium.
- **Workaround:** Downloaded the HTML and searched it locally.
- **Suggestion:** Publish an OpenAPI document and split the reference into per-endpoint pages. Both help AI coding assistants too.

## 6. Strands TypeScript hooks aren't in the README

- **Task:** Enforce privacy and ordering rules deterministically before tool calls.
- **Steps:** Read the `@strands-agents/sdk` README (v1.17), then the type definitions.
- **Expected:** A README example of registering `BeforeToolCallEvent` and cancelling a call.
- **Actual:** The README covers agents, tools and streaming; hook registration (`agent.addHook(BeforeToolCallEvent, cb)`, `event.cancel = "reason"`) had to be found in `dist/src/agent/agent.d.ts` and `hooks/events.d.ts`.
- **Severity:** Low.
- **Workaround:** Read the `.d.ts` files.
- **Suggestion:** Add a "Hooks and guardrails" section with a cancel example to the TypeScript README.
