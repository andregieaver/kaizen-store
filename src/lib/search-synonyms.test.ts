import { describe, expect, it } from "vitest";

import { cleanWord, expandQuery, MAX_ALTERNATIVES, readSynonym, splitWords, synonymLine, type SynonymGroup } from "./search-synonyms";

/** Search synonyms (wave 6 unit F1, D324, `docs/wave-6-catalogue.md` F.1). */

const both = (...words: string[]): SynonymGroup => ({ kind: "both", words, means: [] });
const oneWay = (words: string[], means: string[]): SynonymGroup => ({ kind: "one_way", words, means });

describe("expandQuery", () => {
  it("puts each word of a two-way group in place of the others", () => {
    expect(expandQuery("blue sofa", [both("sofa", "couch", "settee")])).toEqual(["blue couch", "blue settee"]);
    expect(expandQuery("blue couch", [both("sofa", "couch", "settee")])).toEqual(["blue sofa", "blue settee"]);
  });

  it("finds one way only", () => {
    const groups = [oneWay(["jumper", "pullover"], ["sweater"])];
    expect(expandQuery("red jumper", groups)).toEqual(["red sweater"]);
    expect(expandQuery("red sweater", groups)).toEqual([]);
  });

  it("matches whole words and phrases, never a part of a word", () => {
    expect(expandQuery("sofabed", [both("sofa", "couch")])).toEqual([]);
    expect(expandQuery("a sofa bed", [both("sofa bed", "daybed")])).toEqual(["a daybed"]);
    expect(expandQuery("kjøleskap hvit", [both("kjøleskap", "kjøler")])).toEqual(["kjøler hvit"]);
  });

  it("tries the longest word first and never gives the search itself", () => {
    const groups = [both("shirt", "top"), both("t-shirt", "tee")];
    expect(expandQuery("t-shirt", groups)[0]).toBe("tee");
    expect(expandQuery("sofa", [both("sofa", "sofa")])).toEqual([]);
  });

  it("keeps to the cap and reads the search as typed", () => {
    const many = both(...Array.from({ length: 15 }, (_, i) => `w${i}`));
    expect(expandQuery("w0", [many])).toHaveLength(MAX_ALTERNATIVES);
    expect(expandQuery("  BLUE   Sofa ", [both("sofa", "couch")])).toEqual(["blue couch"]);
    expect(expandQuery("", [both("sofa", "couch")])).toEqual([]);
  });
});

describe("readSynonym", () => {
  const value = (raw: unknown) => {
    const read = readSynonym(raw);
    return read.ok ? read.value : read.problems;
  };

  it("keeps words as a search reads them, once each", () => {
    expect(value({ locale: "nb-NO", kind: "both", words: ["Sofa", " couch ", "sofa", ""] })).toEqual({
      id: null,
      locale: "nb-NO",
      kind: "both",
      words: ["sofa", "couch"],
      means: [],
    });
  });

  it("says what is wrong: a group too small, a word a search cannot hold, a word that finds itself", () => {
    expect(value({ locale: "en", kind: "both", words: ["sofa"] })).toEqual([{ code: "both_count" }]);
    expect(value({ locale: "en", kind: "both", words: ["sofa", "couch | x"] })).toEqual([{ code: "word", word: "couch | x" }, { code: "both_count" }]);
    expect(value({ locale: "en", kind: "one_way", words: ["tee"], means: [] })).toEqual([{ code: "one_way_means" }]);
    expect(value({ locale: "en", kind: "one_way", words: ["tee"], means: ["tee"] })).toEqual([{ code: "self" }]);
    expect(value({ locale: "en", kind: "sideways", words: [] })).toEqual([{ code: "shape" }]);
    expect(readSynonym({ locale: "en", kind: "one_way", words: ["tee"], means: ["t-shirt"] })).toMatchObject({ ok: true, value: { means: ["t-shirt"] } });
  });

  it("drops what a two-way group sends as means", () => {
    expect(value({ locale: "en", kind: "both", words: ["a1", "b1"], means: ["c1"] })).toMatchObject({ means: [] });
  });
});

describe("words", () => {
  it("cleans a word and splits a field", () => {
    expect(cleanWord("  Men's   T-Shirt ")).toBe("men's t-shirt");
    expect(cleanWord("x".repeat(61))).toBeNull();
    expect(cleanWord("sofa & couch")).toBeNull();
    expect(cleanWord("-sofa")).toBeNull();
    expect(splitWords("sofa, couch\nsettee = divan;;")).toEqual(["sofa", "couch", "settee", "divan"]);
  });

  it("shows a group as one line", () => {
    expect(synonymLine(both("sofa", "couch"))).toBe("sofa = couch");
    expect(synonymLine(oneWay(["jumper", "pullover"], ["sweater"]))).toBe("jumper, pullover → sweater");
  });
});
