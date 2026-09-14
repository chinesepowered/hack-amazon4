import type { Observation } from "@/lib/vision";

// Deterministic privacy rules. The vision prompt asks for the same thing, but prompts are not guarantees:
// everything the model says passes through these checks before it can be spoken or stored.

const SENSITIVE: { pattern: RegExp; rule: string }[] = [
  { pattern: /\b(man|men|woman|women|boy|girl|lady|ladies|gentleman|guy|male|female|he|she|his|her|him)\b/i, rule: "gender" },
  { pattern: /\b(old|older|elderly|young|younger|teen|teenage|child|kid|\d+\s*(years?|yrs?)(\s*old)?|aged?)\b/i, rule: "age" },
  { pattern: /\b(black|white|asian|latino|latina|hispanic|african|caucasian|indian|arab|ethnic\w*|race|skin)\s+(person|people|man|woman|guy|lady)\b/i, rule: "race or ethnicity" },
  { pattern: /\b(skin tone|complexion)\b/i, rule: "race or ethnicity" },
  { pattern: /\b(muslim|christian|jewish|hindu|sikh|buddhist|hijab|turban|religious)\b/i, rule: "religion" },
  { pattern: /\b(disabled|wheelchair user|blind|pregnant|sick|ill|overweight|fat|thin)\b/i, rule: "health or body" },
  { pattern: /\b(flag|nationality|license plate|plate number)\b/i, rule: "nationality or plate" },
  { pattern: /\b(looks like|resembles|recogni[sz]e[sd]?|identified as|facial|face(?!\s*(mask|covering|shield)))\b/i, rule: "identity" },
];

export interface PrivacyVerdict {
  ok: boolean;
  violations: string[];
}

export function checkText(text: string, allowedPhrases: string[] = []): PrivacyVerdict {
  let t = text;
  // Caregiver-provided labels (e.g. "Maria and Tom from next door") may be spoken after a deterministic match.
  for (const p of allowedPhrases) t = t.split(p).join(" ");
  const violations = SENSITIVE.filter((s) => s.pattern.test(t)).map((s) => s.rule);
  // Capitalised words that look like names and aren't from an allowed label or sentence start.
  const names = t.match(/(?<![.!?]\s|^)\b(?!A\b|An\b|The\b|No\b|This\b|It\b|One\b|Two\b|Someone\b|Nobody\b)[A-Z][a-z]{2,}\b/g) ?? [];
  if (names.length) violations.push(`possible name (${names.slice(0, 2).join(", ")})`);
  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

const scrub = (s: string) =>
  SENSITIVE.reduce((acc, { pattern, rule }) => (rule === "gender" ? acc.replace(new RegExp(pattern.source, "gi"), "person") : acc.replace(new RegExp(pattern.source, "gi"), "[omitted]")), s);

/** Remove anything sensitive the vision model slipped into its observations. Returns what was removed. */
export function sanitizeObservation(o: Observation): { clean: Observation; removed: string[] } {
  const removed = new Set<string>();
  const clean = (s: string) => {
    for (const { pattern, rule } of SENSITIVE) if (pattern.test(s)) removed.add(rule);
    return scrub(s);
  };
  return {
    clean: {
      people: o.people.map((p) => ({ clothing: clean(p.clothing), uniform_or_role_clues: clean(p.uniform_or_role_clues), carrying: clean(p.carrying), action: clean(p.action) })),
      packages_left_unattended: o.packages_left_unattended,
      vehicles: o.vehicles.map(clean),
      other: clean(o.other),
    },
    removed: [...removed],
  };
}

export const MAX_WORDS = 28;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
