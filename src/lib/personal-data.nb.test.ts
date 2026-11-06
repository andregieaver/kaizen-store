import { describe, expect, it } from "vitest";

import { forbiddenUses } from "./i18n-glossary";
import { PERSONAL_DATA } from "./personal-data";
import { ORDERS_ANONYMISED_REASON_NB, PERSONAL_DATA_REASONS_NB, planReasonsNb } from "./personal-data.nb";

describe("the register's reasons in Norwegian (D312)", () => {
  it("has a reason for every table of the register, and none for a table it lacks", () => {
    expect(new Set(Object.keys(PERSONAL_DATA_REASONS_NB))).toEqual(new Set(PERSONAL_DATA.map((e) => e.table)));
  });

  it("gives each table written Norwegian, never empty and never the English", () => {
    for (const e of PERSONAL_DATA) {
      const nb = PERSONAL_DATA_REASONS_NB[e.table];
      expect(typeof nb === "string" && nb.trim().length > 0, e.table).toBe(true);
      expect(nb, e.table).not.toBe(e.reason);
    }
  });

  it("uses no word the glossary forbids", () => {
    expect(Object.entries(PERSONAL_DATA_REASONS_NB).flatMap(([table, text]) => forbiddenUses(text).map((use) => `${table}: ${use.word}`))).toEqual([]);
  });

  it("says an erasure plan's reasons in Norwegian, the orders made anonymous now by their own sentence", () => {
    const plan = {
      rows: [
        { table: "orders", action: "restricted", reason: "English", count: 1, label: "" },
        { table: "orders", action: "anonymised", reason: "English", count: 1, label: "" },
        { table: "customers", action: "deleted", reason: "English", count: 1, label: "" },
        { table: "not_a_table", action: "deleted", reason: "English", count: 1, label: "" },
      ],
    };
    expect(planReasonsNb(plan).rows.map((r) => r.reason)).toEqual([
      PERSONAL_DATA_REASONS_NB.orders,
      ORDERS_ANONYMISED_REASON_NB,
      PERSONAL_DATA_REASONS_NB.customers,
      "English",
    ]);
  });
});
