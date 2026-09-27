import { describe, expect, it } from "vitest";

import { embeddingDocument, MAX_EMBEDDED, MAX_QUERY, normalizeQuery, prefixQuery, reciprocalRankFusion } from "./search";
import { vectorLiteral } from "./vectors";

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

describe("search by meaning (D74)", () => {
  it("merges keyword and meaning results by rank", () => {
    // In both lists beats first in one; ties keep keyword's order.
    expect(reciprocalRankFusion([["a", "b", "c"], ["c", "d"]])).toEqual(["c", "a", "b", "d"]);
    expect(reciprocalRankFusion([["a", "b"], []])).toEqual(["a", "b"]);
    expect(reciprocalRankFusion([[], ["x", "y"]])).toEqual(["x", "y"]);
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("embeds the title, categories and description, cutting the description", () => {
    expect(embeddingDocument(" Keramikkopp ", "Kjøkken, Kopper", "Tåler oppvask.")).toBe("Keramikkopp\nKjøkken, Kopper\nTåler oppvask.");
    expect(embeddingDocument("Kopp", "", "")).toBe("Kopp");
    const long = embeddingDocument("Kopp", "Kjøkken", "x".repeat(10_000));
    expect(long).toHaveLength(MAX_EMBEDDED);
    expect(long.startsWith("Kopp\nKjøkken\n")).toBe(true);
  });

  it("writes vectors for pgvector", () => {
    expect(vectorLiteral([0.5, -1, 2e-3])).toBe("[0.5,-1,0.002]");
    expect(() => vectorLiteral([])).toThrow();
    expect(() => vectorLiteral([1, Number.NaN])).toThrow();
  });
});
