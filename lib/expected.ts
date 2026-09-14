// Caregiver-set "expected visitors". Matching is deterministic and uses only what a stranger could
// see from the doorway (carried objects, clothing, vehicles) plus the time window. Never faces or names.

export interface ExpectedVisitor {
  id: string;
  label: string; // e.g. "Lunch delivery"
  from: string; // "HH:MM" local time
  to: string;
  clues: string[]; // lowercase words to look for in the observations, e.g. ["delivery", "food box"]
}

export const DEFAULT_EXPECTED: ExpectedVisitor[] = [
  { id: "lunch", label: "Lunch delivery from Nonna's Kitchen", from: "12:00", to: "12:45", clues: ["delivery", "food", "box", "jacket"] },
  { id: "neighbors", label: "Maria and Tom from next door", from: "14:00", to: "16:00", clues: ["flower", "bouquet", "sunflower"] },
];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export interface MatchResult {
  matched: boolean;
  visitor?: { id: string; label: string; window: string };
  cluesFound: string[];
  reason: string;
}

/** Best match = inside the time window AND at least one visual clue present. Time alone never matches. */
export function matchExpected(observations: string, localTime: string, expected: ExpectedVisitor[]): MatchResult {
  const text = observations.toLowerCase();
  const now = toMin(localTime);
  let best: MatchResult = { matched: false, cluesFound: [], reason: "No expected visitor matches both the time and what the camera sees." };
  let bestScore = 0;
  for (const v of expected) {
    const inWindow = now >= toMin(v.from) && now <= toMin(v.to);
    const found = v.clues.filter((c) => text.includes(c.toLowerCase()));
    if (!inWindow || found.length === 0) continue;
    if (found.length > bestScore) {
      bestScore = found.length;
      best = {
        matched: true,
        visitor: { id: v.id, label: v.label, window: `${v.from}–${v.to}` },
        cluesFound: found,
        reason: `Within ${v.from}–${v.to} and the camera sees: ${found.join(", ")}.`,
      };
    }
  }
  return best;
}
