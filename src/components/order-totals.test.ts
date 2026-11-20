import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

import { OrderTotals, type TotalsOrder } from "./order-totals";

/**
 * One part draws an order's totals (bloat review step 3.16): the rows in the order the two order pages drew them, the refunded row only
 * with its label (My account's page) and what is still to pay at the venue only when `balanceAtVenue` is set (the confirmation leaves it out
 * for an order on payment terms).
 */

const m = t("en");
const money = (minor: number) => formatMoney(minor, "EUR", "en-IE");
const text = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const order = {
  status: "paid",
  locale: "en-IE",
  lines: [],
  ships: true,
  delivery: null,
  deliveryKept: null,
  shippingMinor: 500,
  discountMinor: 1000,
  discountCode: "SPRING",
  memberDiscountMinor: 0,
  memberLabel: null,
  memberPercent: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  referralDiscountMinor: 300,
  staffDiscountMinor: 200,
  staffDiscountLabel: "Loyal customer",
  bonus: { usedMinor: 400, earnedMinor: 0, availableAt: null },
  totalMinor: 9000,
  taxMinor: 1800,
  vatKind: "standard",
  vatReliefMinor: 0,
  shippingVatRate: 0.25,
  vat: null,
  balanceMinor: 2500,
  company: { name: "Fjord AS", number: "999 888 777" },
  refundedMinor: 700,
} as unknown as TotalsOrder;

const draw = (props: { balanceAtVenue?: boolean; refundedLabel?: string } = {}) =>
  text(renderToString(createElement(OrderTotals, { order, m, lang: "en", timeZone: "Europe/Oslo", money, ...props })));

describe("an order's totals", () => {
  it("are drawn in the order the order pages drew them", () => {
    const words = draw({ balanceAtVenue: true, refundedLabel: "Refunded" });
    const rows = [
      money(500),
      `${m.discount} (`,
      "Loyal customer",
      `${m.affiliate.discountRow} −${money(300)}`,
      `${m.bonus.usedRow} −${money(400)}`,
      `${m.total} ${money(9000)}`,
      `${m.booking.atVenue} ${money(2500)}`,
      `${m.totalExclVat} ${money(7200)}`,
      "Fjord AS",
      `Refunded −${money(700)}`,
    ];
    const at = rows.map((row) => words.indexOf(row));
    expect(at.every((i) => i >= 0), words).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("leave out the refunded row without its label and the venue's balance without balanceAtVenue", () => {
    const words = draw();
    expect(words).toContain(`${m.total} ${money(9000)}`);
    expect(words).not.toContain("Refunded");
    expect(words).not.toContain(m.booking.atVenue);
  });
});
