import { describe, expect, it } from "vitest";

import { ERASED, blankTraces, tracePatterns } from "./erasure-traces";

describe("a shopper's traces in the AI manager's conversations (PSI REG-03)", () => {
  const patterns = tracePatterns({ emails: ["kari.nordmann@example.com", null], names: ["Kari Nordmann", "Kari", ""], phones: ["+47 912 34 567", "12"] });

  it("blanks the email, the full name and the phone number however it is spaced", () => {
    const text = "Order 1042 for Kari  Nordmann (KARI.NORDMANN@example.com), phone 912 34 567; Kari also wrote. Call +4791234567.";
    expect(blankTraces(text, patterns)).toBe(`Order 1042 for ${ERASED} (${ERASED}), phone ${ERASED}; Kari also wrote. Call +47${ERASED}.`);
  });

  it("leaves a first name alone, a short number, and characters a pattern would read as rules", () => {
    expect(patterns).toHaveLength(3);
    expect(tracePatterns({ emails: ["a+b@x.no"], names: [], phones: [] })).toEqual(["a\\+b@x\\.no"]);
    expect(blankTraces("a+b@x.no and aab@xyno", tracePatterns({ emails: ["a+b@x.no"], names: [], phones: [] }))).toBe(`${ERASED} and aab@xyno`);
  });
});
