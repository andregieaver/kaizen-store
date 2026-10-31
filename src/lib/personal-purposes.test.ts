import { describe, expect, it } from "vitest";

import { PERSONAL_DATA } from "./personal-data";
import { BASIS_TEXT, PURPOSE_OF, PURPOSES, processingRecord, type PurposeKey } from "./personal-purposes";

/**
 * The record of processing (PSI REG-01, GDPR Art. 30(1)(b)): every entry of the personal-data register says what it is processed for, and
 * so on what basis; every purpose is used; consent is the basis only for marketing, and a legal obligation names its law.
 */
describe("purposes and bases of the personal-data register (PSI REG-01)", () => {
  it("gives every register entry a purpose", () => {
    expect(PERSONAL_DATA.filter((e) => !(e.purpose in PURPOSES)).map((e) => e.table)).toEqual([]);
  });

  it("names no table that is not in the register, and uses every purpose", () => {
    const tables = new Set(PERSONAL_DATA.map((e) => e.table));
    expect(Object.keys(PURPOSE_OF).filter((t) => !tables.has(t))).toEqual([]);
    const used = new Set(PERSONAL_DATA.map((e) => e.purpose));
    expect((Object.keys(PURPOSES) as PurposeKey[]).filter((p) => !used.has(p))).toEqual([]);
  });

  it("rests on consent only where the law asks for it, and names the law of every obligation", () => {
    expect(Object.entries(PURPOSES).filter(([, p]) => p.basis === "a").map(([k]) => k)).toEqual(["marketing"]);
    for (const p of Object.values(PURPOSES).filter((p) => p.basis === "c")) expect(p.why).toMatch(/§|Art\.|Directive|Regulation|law/);
  });

  it("keeps the platform's own data under the platform's purposes, and shoppers' under the store's", () => {
    for (const e of PERSONAL_DATA) {
      const controller = PURPOSES[e.purpose].controller;
      if (e.subject === "shopper") expect([e.table, controller]).toEqual([e.table, "store"]);
      if (e.subject === "staff") expect([e.table, controller]).toEqual([e.table, "platform"]);
    }
  });

  it("draws one record row per purpose with its basis, subjects, tables and retention rules", () => {
    const record = processingRecord(PERSONAL_DATA);
    expect(record.map((r) => r.purpose)).toEqual(Object.keys(PURPOSES));
    expect(record.reduce((n, r) => n + r.tables.length, 0)).toBe(PERSONAL_DATA.length);
    const bookkeeping = record.find((r) => r.purpose === "bookkeeping")!;
    expect(bookkeeping).toMatchObject({ basis: "c", basisText: BASIS_TEXT.c, controller: "store" });
    expect(bookkeeping.tables).toContain("invoices");
    expect(record.find((r) => r.purpose === "illegal_content")!.retention).toEqual(["content_report_senders"]);
  });
});
