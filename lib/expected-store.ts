import { DEFAULT_EXPECTED, type ExpectedVisitor } from "@/lib/expected";

// Server copy of the caregiver's expected-visitor list, used when live webhooks arrive with no browser attached.
const g = globalThis as unknown as { __expected?: ExpectedVisitor[] };

export const getExpected = () => g.__expected ?? DEFAULT_EXPECTED;
export const setExpected = (list: ExpectedVisitor[]) => {
  g.__expected = list;
};
