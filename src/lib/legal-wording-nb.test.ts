import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NB } from "./legal-starters/nb";
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

/**
 * Every statement of a right in the stores' Norwegian legal starters (D312 P5), with the passages of the record it is written from: the
 * starter cites each passage's section (`angrerettloven § 20`, `personvernforordningen artikkel 15`; `§§ 20 og 21` for two of one statute)
 * and uses the passage's own words where the record holds them. A new statement of a right goes here with its passages.
 */
const RIGHT_STATEMENTS: Record<string, { cites: string[]; words?: string[] }> = {
  "terms.withdrawal.1": { cites: ["arl_20", "arl_21_1"], words: ["gå fra avtalen (angrerett) ved å gi melding", "før utløpet av angrefristen"] },
  "terms.withdrawal.services": { cites: ["arl_21_1"], words: ["14 dager fra den dag avtalen om tjeneste ble inngått"] },
  "terms.withdrawal.regular": { cites: ["arl_21_1"] },
  "terms.conformity.1": { cites: ["fkjl_26"], words: ["holde kjøpesummen tilbake", "kreve prisavslag", "kreve heving", "kreve erstatning"] },
  "terms.complaints.1": { cites: ["fkjl_27_1", "fkjl_27_2"], words: ["innen rimelig tid etter at", "oppdaget eller burde ha oppdaget den", "aldri være kortere enn to måneder", "senest skje to år", "vesentlig lenger"] },
  "privacy.right.access": { cites: ["gdpr_15"] },
  "privacy.right.rectify": { cites: ["gdpr_16"] },
  "privacy.right.erase": { cites: ["gdpr_17"] },
  "privacy.right.restrict": { cites: ["gdpr_18"] },
  "privacy.right.portability": { cites: ["gdpr_20"] },
  "privacy.right.object": { cites: ["gdpr_21"] },
  "returns.window.extended": { cites: ["arl_21_1"] },
  "returns.refund.received": { cites: ["arl_24_1", "arl_24_2"], words: ["alle betalinger", "uten unødig opphold"] },
  "returns.refund.request": { cites: ["arl_24_1", "arl_24_2"], words: ["alle betalinger", "uten unødig opphold"] },
  "withdrawal.right.1": { cites: ["arl_20"] },
  "withdrawal.right.2": { cites: ["arl_21_1"] },
  "withdrawal.right.services": { cites: ["arl_21_1"], words: ["14 dager fra den dag avtalen om tjeneste ble inngått"] },
  "withdrawal.right.regular": { cites: ["arl_21_1"] },
  "withdrawal.how.1": { cites: ["arl_20"], words: ["ved bruk av utfylt angreskjema eller ved fremsettelse av annen utvetydig erklæring"] },
  "withdrawal.effects.1": { cites: ["arl_24_1", "arl_24_2"], words: ["alle betalinger", "uten unødig opphold"] },
};

/** A passage's citation as a page writes it: the statute and its section or article, without the paragraph (`angrerettloven § 24`). */
const section = (cite: string) => cite.replace(/ (første|annet|andre|tredje) ledd.*$/, "");

/** Whether `text` cites `cite`: the section on its own, or within `§§ a og b` of the same statute. */
function cites(text: string, cite: string): boolean {
  const short = section(cite);
  if (text.includes(short)) return true;
  const m = /^(\S+) § (\S+)$/.exec(short);
  return m !== null && new RegExp(`${m[1]} §§ [^)]*\\b${m[2]}\\b`).test(text);
}

describe("the stores' Norwegian legal starters state rights in the law's words (D312 P5)", () => {
  const byKey = new Map(LEGAL_WORDING_NB.map((p) => [p.key, p]));

  it("cites the section of every passage a statement of a right is written from", () => {
    const missing = Object.entries(RIGHT_STATEMENTS).flatMap(([key, { cites: keys }]) => {
      const text = NB.m[key];
      if (text === undefined) return [`${key}: no such text`];
      return keys.flatMap((k) => {
        const passage = byKey.get(k);
        if (!passage) return [`${key}: ${k} is not in the record`];
        return cites(text, passage.cite) ? [] : [`${key}: does not cite ${section(passage.cite)}`];
      });
    });
    expect(missing).toEqual([]);
  });

  it("uses the passage's own words, and only words the record holds", () => {
    const wrong = Object.entries(RIGHT_STATEMENTS).flatMap(([key, { cites: keys, words = [] }]) => {
      const record = keys.map((k) => byKey.get(k)?.text ?? "").join(" ").toLowerCase();
      return words.flatMap((w) => [
        ...(NB.m[key]?.includes(w) ? [] : [`${key}: lacks «${w}»`]),
        // The record's own words, allowing only the person (du/deg for forbrukeren) to change.
        ...(record.includes(w.toLowerCase()) || record.includes(w.toLowerCase().replace(/\bdu\b/g, "forbrukeren").replace(/\bdeg\b/g, "seg")) || record.includes(w.toLowerCase().replace(/\bdu\b/g, "han eller hun")) ? [] : [`${key}: «${w}» is not in the record`]),
      ]);
    });
    expect(wrong).toEqual([]);
  });
});
