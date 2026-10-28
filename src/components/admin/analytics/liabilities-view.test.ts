import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { liabilityRow, rollForward, BONUS_ROLL_KINDS } from "@/lib/liabilities";

import { LiabilitiesView } from "./liabilities-view";

const html = (rows: ReturnType<typeof liabilityRow>[]) => renderToString(createElement(LiabilitiesView, { locale: "en-GB", rows }));

describe("what the store owes customers on Finance (D381)", () => {
  it("draws nothing without a ledger", () => {
    expect(html([])).toBe("");
  });

  it("draws each ledger's roll-forward, says a row that does not add up by how much, and the main currency beside bonus credit", () => {
    const bonus = liabilityRow("bonus", rollForward("EUR", 1_000, [{ kind: "earn", amountMinor: 500 }], 1_400, BONUS_ROLL_KINDS), 1_400, { currency: "NOK", minor: 16_100 });
    const cards = liabilityRow("gift_cards", rollForward("NOK", 0, [{ kind: "issue", amountMinor: 50_000 }], 50_000, []), 50_000);
    const out = html([bonus, cards]);
    expect(out).toContain("Owed to customers");
    expect(out).toContain("Bonus credit");
    expect(out).toContain("Gift cards");
    expect(out).toContain("Off by");
    expect(out).toContain("in NOK");
  });
});
