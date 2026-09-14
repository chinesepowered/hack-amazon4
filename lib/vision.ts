import OpenAI from "openai";
import { z } from "zod";

// Vision runs on a free OpenAI-compatible endpoint (W&B Inference). The model only reports what is
// visible; privacy rules are enforced again in code (lib/privacy.ts) before anything is spoken.

export const ObservationSchema = z.object({
  people: z
    .array(
      z.object({
        clothing: z.string().describe("clothing colors and type, e.g. 'green and black jacket with reflective stripes'"),
        uniform_or_role_clues: z.string().describe("visible uniform, logo-free role clues, or 'none'"),
        carrying: z.string().describe("what they hold, or 'nothing'"),
        action: z.string().describe("e.g. 'holding out a box', 'knocking'"),
      }),
    )
    .max(6),
  packages_left_unattended: z.number().int().min(0),
  vehicles: z.array(z.string()).max(4),
  other: z.string().describe("anything else useful for someone who cannot see the door, or ''"),
});
export type Observation = z.infer<typeof ObservationSchema>;

const PROMPT = `You describe a doorbell camera snapshot for a blind resident.
Return ONLY JSON matching: {"people":[{"clothing":"","uniform_or_role_clues":"","carrying":"","action":""}],"packages_left_unattended":0,"vehicles":[],"other":""}
Rules:
- Describe only what is visible: clothing, uniforms, carried objects, actions, packages, vehicles.
- For "carrying", name every object each person holds (for example flowers, box, bag, toolbox, clipboard).
- The camera is at the door: ignore hands or arms at the image edge that belong to the resident.
- Never identify anyone, never guess names, age, gender, race, ethnicity, religion, health or disability.
- Refer to people only as "person".
- Do not read out flags, nationality symbols, or license plates.
- Keep each field under 12 words.`;

let client: OpenAI | null = null;
const llm = () =>
  (client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 }));

export async function observeImage(bytes: Buffer, mime: string): Promise<Observation> {
  const model = process.env.VISION_MODEL || "google/gemma-4-31B-it";
  const res = await llm().chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } },
        ],
      },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return ObservationSchema.parse(JSON.parse(json));
}
