import { describe, expect, it } from "vitest";

import { MAX_QUERY, normalizeQuery, prefixQuery } from "./search";

describe("keyword search queries", () => {
  it("tidies what was typed", () => {
    expect(normalizeQuery("  Keramikk\tKOPP \n")).toBe("keramikk kopp");
    expect(normalizeQuery("\u0000​hytte")).toBe("hytte");
    expect(normalizeQuery("x".repeat(300))).toHaveLength(MAX_QUERY);
    expect(normalizeQuery("   ")).toBe("");
  });

  it("builds a type-ahead query from letters and digits only", () => {
    expect(prefixQuery("Kera kop")).toBe("kera:* & kop:*");
    expect(prefixQuery("sykkel 26\"")).toBe("sykkel:* & 26:*");
    // Operators typed are dropped, so they cannot change the query.
    expect(prefixQuery("a & !b | c:* <-> (d)")).toBe("a:* & b:* & c:* & d:*");
    expect(prefixQuery("høst æble ölglas")).toBe("høst:* & æble:* & ölglas:*");
    expect(prefixQuery("!!! ---")).toBeNull();
  });
});
