import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LEGAL_WORDING_NB, misquotedPrescribed, staleWording, wordingProblems, type LegalPassage } from "./legal-wording-nb";

const NORWEGIAN_LEGAL_TEXTS = ["src/lib/legal-starters/nb.ts"];

describe("the law's own words for Norwegian legal pages (D312 5.2a)", () => {
  it("cites a section on Lovdata with the date it was read, and no passage twice", () => {
    expect(wordingProblems()).toEqual([]);
  });

  it("lists a passage for reading again a year after it was read", () => {
    const old: LegalPassage = { ...LEGAL_WORDING_NB[0], key: "old", read: "2025-10-21" };
    expect(staleWording("2026-10-22", [old, LEGAL_WORDING_NB[0]])).toEqual(["old"]);
  });

  it("finds a prescribed text quoted differently from the record", () => {
    const form: LegalPassage = { ...LEGAL_WORDING_NB[0], key: "form", cite: "forskrift § 9", text: "Til [navn]:", prescribed: true };
    expect(misquotedPrescribed("Etter forskrift § 9: Til [navn]:", [form])).toEqual([]);
    expect(misquotedPrescribed("Etter forskrift § 9: Til:", [form])).toEqual(["form"]);
  });

  it("is quoted word for word wherever a Norwegian legal text cites a prescribed passage", () => {
    const found = NORWEGIAN_LEGAL_TEXTS.flatMap((file) => misquotedPrescribed(readFileSync(path.join(process.cwd(), file), "utf8")).map((key) => `${file}: ${key}`));
    expect(found).toEqual([]);
  });

  it("never cites the repealed ekomloven § 2-7b in a Norwegian legal text", () => {
    for (const file of NORWEGIAN_LEGAL_TEXTS) expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toMatch(/2-7\s?b/);
  });
});
