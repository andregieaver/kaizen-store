import { describe, expect, it } from "vitest";

import {
  addPeriod,
  chargeOf,
  chargeWords,
  isChargeOf,
  likelySubscriptions,
  monthlyMinor,
  plainWords,
  recurringInputOf,
  recurringState,
  type RecurringCost,
  type RecurringLine,
} from "./recurring-costs";
import { parseMoneyText } from "./work-calc";

const claude: RecurringCost = {
  id: "c1",
  name: "Claude Max",
  matchText: "ANTHROPIC",
  kind: "software",
  vatRate: 0,
  abroad: true,
  every: "month",
  amountMinor: 220_000,
  startedOn: "2026-01-01",
  endedOn: null,
};
const vercel: RecurringCost = { ...claude, id: "c2", name: "Vercel Pro", matchText: "Vercel", amountMinor: 21_500 };
const domain: RecurringCost = { ...claude, id: "c3", name: "Domain", matchText: "Domeneshop", abroad: false, vatRate: 25, every: "year", amountMinor: 18_000, startedOn: "2025-03-01" };

const line = (day: string, amountMinor: number, text: string, counterparty: string | null = null): RecurringLine => ({
  id: `${day}-${text}`,
  day,
  amountMinor,
  text,
  counterparty,
  reference: null,
});

describe("subscriptions known by their charges (D503)", () => {
  it("compares words without case or marks, as whole words", () => {
    expect(plainWords("  *4321 ANTHROPIC.COM  USD 200,00 ")).toBe("4321 anthropic com usd 200 00");
    expect(isChargeOf(line("2026-03-04", -219_000, "Varekjøp *4321 ANTHROPIC USD 200,00 Kurs 10,95"), claude)).toBe(true);
    // In the counterparty's name too; never money in, a day before it started or after it ended, or a word inside another.
    expect(isChargeOf(line("2026-03-04", -21_000, "Kortkjøp", "VERCEL INC."), vercel)).toBe(true);
    expect(isChargeOf(line("2026-03-04", 21_000, "VERCEL refund"), vercel)).toBe(false);
    expect(isChargeOf(line("2025-12-31", -219_000, "ANTHROPIC"), claude)).toBe(false);
    expect(isChargeOf(line("2026-06-02", -219_000, "ANTHROPIC"), { ...claude, endedOn: "2026-05-31" })).toBe(false);
    expect(isChargeOf(line("2026-03-04", -21_000, "SUPERVERCELLO"), vercel)).toBe(false);
  });

  it("takes the one whose usual amount is nearest when two carry the same words", () => {
    const api: RecurringCost = { ...claude, id: "c4", name: "Claude API", amountMinor: 55_000 };
    expect(chargeOf(line("2026-03-04", -219_000, "ANTHROPIC"), [api, claude])?.id).toBe("c1");
    expect(chargeOf(line("2026-03-09", -60_000, "ANTHROPIC"), [api, claude])?.id).toBe("c4");
    expect(chargeOf(line("2026-03-09", -60_000, "Rema 1000"), [api, claude])).toBeNull();
  });

  it("says what a month costs, a year's a twelfth, and moves days by months and years", () => {
    expect(monthlyMinor(claude)).toBe(220_000);
    expect(monthlyMinor(domain)).toBe(1_500);
    expect(addPeriod("2026-01-31", "month")).toBe("2026-02-28");
    expect(addPeriod("2028-01-31", "month")).toBe("2028-02-29");
    expect(addPeriod("2026-12-15", "month")).toBe("2027-01-15");
    expect(addPeriod("2026-03-01", "year")).toBe("2027-03-01");
  });

  it("gives each its last charge and the next, says one late after a week's grace, and adds up those running", () => {
    const lines = [
      line("2026-09-04", -214_000, "ANTHROPIC"),
      line("2026-10-04", -221_000, "ANTHROPIC"),
      line("2026-09-20", -21_400, "VERCEL"),
      line("2026-03-02", -18_000, "DOMENESHOP AS"),
    ];
    const state = recurringState([claude, vercel, domain, { ...claude, id: "c5", name: "Old", matchText: "Figma", endedOn: "2026-06-30" }], lines, "2026-11-08");
    expect(state.rows.map((r) => [r.cost.name, r.running, r.lastDay, r.lastMinor, r.nextDay, r.late])).toEqual([
      ["Claude Max", true, "2026-10-04", 221_000, "2026-11-04", false],
      ["Domain", true, "2026-03-02", 18_000, "2027-03-02", false],
      // Vercel's October charge never came: due 20 October, late after the 27th.
      ["Vercel Pro", true, "2026-09-20", 21_400, "2026-10-20", true],
      ["Old", false, null, null, null, false],
    ]);
    expect(state.monthlyMinor).toBe(220_000 + 21_500 + 1_500);
  });

  it("offers charges that come back each month as subscriptions, never a transfer made many times a month", () => {
    const lines = [
      line("2026-08-03", -21_000, "Varekjøp *4321 SUPABASE INC USD 25,00 Kurs 10,40"),
      line("2026-09-03", -26_000, "Varekjøp *4321 SUPABASE INC USD 25,00 Kurs 10,52"),
      line("2026-10-03", -25_800, "Varekjøp *4321 SUPABASE INC USD 25,00 Kurs 10,32"),
      line("2026-11-03", -25_600, "Varekjøp *4321 SUPABASE INC USD 25,00 Kurs 10,24"),
      // Already a subscription.
      line("2026-08-04", -219_000, "Varekjøp ANTHROPIC CLAUDE AI"),
      line("2026-09-04", -219_000, "Varekjøp ANTHROPIC CLAUDE AI"),
      line("2026-10-04", -219_000, "Varekjøp ANTHROPIC CLAUDE AI"),
      // A transfer many times a month.
      ...["2026-08-01", "2026-08-09", "2026-08-15", "2026-09-02", "2026-09-10", "2026-10-01", "2026-10-20"].map((d) => line(d, -50_000, "Kontoregulering 1234 Mobil Overføring Kari")),
      // Amounts that wander are no subscription.
      line("2026-08-10", -10_000, "Rema Tøyen"),
      line("2026-09-10", -90_000, "Rema Tøyen"),
      line("2026-10-10", -40_000, "Rema Tøyen"),
    ];
    expect(chargeWords(lines[0])).toBe("supabase");
    expect(likelySubscriptions(lines, [claude], "2026-11-08")).toEqual([
      { matchText: "supabase", name: "Supabase", amountMinor: 25_700, firstDay: "2026-08-03", lastDay: "2026-11-03", count: 4 },
    ]);
    // One not seen for six weeks has stopped.
    expect(likelySubscriptions(lines, [claude], "2026-12-20")).toEqual([]);
  });

  it("reads the form: a name, words to know it by, what it was, its VAT, how often, about what and from when", () => {
    const raw = { name: " Claude Max ", matchText: "ANTHROPIC", kind: "software", vat: "abroad", every: "month", amount: "2 200,00", startedOn: "2026-01-01" };
    expect(recurringInputOf(raw, "NOK", parseMoneyText)).toEqual({
      ok: true,
      input: { name: "Claude Max", matchText: "ANTHROPIC", kind: "software", vatRate: 0, abroad: true, every: "month", amountMinor: 220_000, startedOn: "2026-01-01" },
    });
    expect(recurringInputOf({ ...raw, vat: "usual" }, "NOK", parseMoneyText)).toMatchObject({ ok: true, input: { vatRate: 25, abroad: false } });
    expect(recurringInputOf({ name: "", matchText: "ab", kind: "toys", vat: "7", every: "week", amount: "0", startedOn: "soon" }, "NOK", parseMoneyText)).toEqual({
      ok: false,
      problems: ["name", "words", "kind", "vat", "every", "amount", "day"],
    });
  });
});
