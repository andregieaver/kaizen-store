import { describe, expect, it } from "vitest";

import { cleanPostalPattern, mostSpecific, parsePatternList, patternListProblem, patternMatches, specificity, takenPatterns, zoneFor } from "./postal-patterns";

describe("a postal-code pattern", () => {
  it("is an exact code as the country writes it, or a prefix of it with a star", () => {
    expect(cleanPostalPattern("NO", " 0150 ")).toBe("0150");
    expect(cleanPostalPattern("NO", "01*")).toBe("01*");
    expect(cleanPostalPattern("NO", "0*")).toBe("0*");
    expect(cleanPostalPattern("NO", "0150*")).toBe("0150*");
    expect(cleanPostalPattern("SE", "114 55")).toBe("11455");
    expect(cleanPostalPattern("SE", "114*")).toBe("114*");
    expect(cleanPostalPattern("dk", "1050")).toBe("1050");
    expect(cleanPostalPattern("GB", "sw1a*")).toBe("SW1A*");
  });

  it("refuses what the country never writes: wrong length, letters in digits, a bare star, two stars, a star inside", () => {
    expect(cleanPostalPattern("NO", "015")).toBeNull();
    expect(cleanPostalPattern("NO", "01500*")).toBeNull();
    expect(cleanPostalPattern("NO", "AB*")).toBeNull();
    expect(cleanPostalPattern("NO", "*")).toBeNull();
    expect(cleanPostalPattern("NO", "01**")).toBeNull();
    expect(cleanPostalPattern("NO", "0*1")).toBeNull();
    expect(cleanPostalPattern("NO", "0150-0199")).toBeNull();
    expect(cleanPostalPattern("GB", "ABCDEFGHIJK*")).toBeNull();
  });

  it("matches the code itself, or codes starting with the prefix", () => {
    expect(patternMatches("0150", "0150")).toBe(true);
    expect(patternMatches("0150", "0151")).toBe(false);
    expect(patternMatches("01*", "0150")).toBe(true);
    expect(patternMatches("01*", "0250")).toBe(false);
    expect(patternMatches("0150*", "0150")).toBe(true);
  });

  it("ranks an exact code above every prefix and a longer prefix above a shorter one", () => {
    expect(specificity("0150")).toBeGreaterThan(specificity("0150*"));
    expect(specificity("015*")).toBeGreaterThan(specificity("01*"));
    expect(mostSpecific(["0*", "01*", "015*"], "0150")).toBe("015*");
    expect(mostSpecific(["0*", "0150", "015*"], "0150")).toBe("0150");
    expect(mostSpecific(["5*"], "0150")).toBeNull();
  });
});

describe("a list of patterns as typed", () => {
  it("is split on commas, spaces, semicolons and lines, cleaned, kept in order without repeats, with what is not a pattern apart", () => {
    expect(parsePatternList("NO", "0150, 01*\n5*;0150  abc 0*")).toEqual({ patterns: ["0150", "01*", "5*", "0*"], invalid: ["abc"] });
    expect(parsePatternList("NO", "")).toEqual({ patterns: [], invalid: [] });
  });

  it("is refused as the database refuses it", () => {
    expect(patternListProblem([])).toBe("empty");
    expect(patternListProblem(["0150", "01*"])).toBeNull();
    expect(patternListProblem(["0150", "0150"])).toBe("duplicate");
    expect(patternListProblem(["01 50"])).toBe("malformed");
    expect(patternListProblem(["a1*"])).toBe("malformed");
    expect(patternListProblem(Array.from({ length: 1001 }, (_, i) => String(i)))).toBe("too_many");
    // 1,000 patterns of four characters are 4,000 characters: over 3,000.
    expect(patternListProblem(Array.from({ length: 1000 }, (_, i) => String(i).padStart(4, "0")))).toBe("too_long");
    expect(patternListProblem(Array.from({ length: 750 }, (_, i) => String(i).padStart(4, "0")))).toBeNull();
  });
});

describe("the zone of a postal code", () => {
  const zones = [
    { id: "z-oslo", name: "Oslo", patterns: ["0*", "10*", "11*", "12*"], position: 0 },
    { id: "z-centre", name: "Oslo centre", patterns: ["01*"], position: 1 },
    { id: "z-one", name: "One street", patterns: ["0150"], position: 2 },
    { id: "z-north", name: "North", patterns: ["9*", "8*"], position: 3 },
  ];

  it("is the zone with the most specific matching pattern, whatever the order of the zones", () => {
    expect(zoneFor(zones, "0150")?.id).toBe("z-one");
    expect(zoneFor(zones, "0151")?.id).toBe("z-centre");
    expect(zoneFor(zones, "0250")?.id).toBe("z-oslo");
    expect(zoneFor(zones, "1150")?.id).toBe("z-oslo");
    expect(zoneFor(zones, "9020")?.id).toBe("z-north");
    expect(zoneFor([...zones].reverse(), "0151")?.id).toBe("z-centre");
  });

  it("is none (Rest of country) for a code no zone covers, and before a code is given", () => {
    expect(zoneFor(zones, "5003")).toBeNull();
    expect(zoneFor(zones, null)).toBeNull();
    expect(zoneFor([], "0150")).toBeNull();
  });

  it("falls to the first by position when two zones hold the same pattern (which the database refuses for one market)", () => {
    expect(zoneFor([{ id: "b", patterns: ["5*"], position: 1 }, { id: "a", patterns: ["5*"], position: 0 }], "5003")?.id).toBe("a");
    expect(zoneFor([{ id: "b", patterns: ["5*"], position: 0 }, { id: "a", patterns: ["5*"], position: 0 }], "5003")?.id).toBe("a");
  });

  it("names the patterns another zone already holds", () => {
    expect(takenPatterns(["01*", "02*", "0150"], zones, "z-centre")).toEqual([{ pattern: "0150", zone: "One street" }]);
    expect(takenPatterns(["01*"], zones, null)).toEqual([{ pattern: "01*", zone: "Oslo centre" }]);
  });
});
