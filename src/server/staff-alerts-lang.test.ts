import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

import { contactLang } from "@/lib/staff-email-lang";

import { disputeEmail, newOrderEmail, returnRequestedEmail, summaryEmail } from "./staff-alerts";

const store = {
  id: "s",
  slug: "shop",
  name: "Shop",
  details: { legalName: "Shop AS", organisationNumber: "123", postalAddress: "Gate 1", contactEmail: "a@b.no", country: "NO" },
  markets: [],
  localization: {},
} as never;
const order = {
  number: "1001",
  totalMinor: 123450,
  balanceMinor: 0,
  currency: "NOK",
  locale: "en-GB",
  lines: [{ title: "Genser", quantity: 2 }],
  delivery: "Shipping",
  country: "Norway",
  business: false,
  host: null,
  gift: true,
  heldByRule: false,
  renewal: false,
  deliveryKind: "shipping" as const,
  countryCode: "NO",
};
const figures = {
  from: "2026-01-01",
  to: "2026-01-07",
  orders: 1,
  netSalesMinor: 59700,
  refundsMinor: 0,
  currency: "NOK",
  unconverted: 0,
  missingCurrencies: [],
  returnsRequested: 0,
  openReturns: 0,
  toSend: 1,
  lowStock: 0,
  supportWaiting: null,
};
const dispute = {
  orderNumber: "1001",
  orderId: "o",
  amountMinor: 50000,
  currency: "NOK",
  reason: "fraudulent",
  status: "needs_response",
  due: "Thu 1 Jan 2026, 10:00",
  dueAt: new Date("2026-01-01T10:00:00Z"),
  timeZone: "UTC",
  dashboardUrl: "https://dashboard.stripe.com/x",
} as never;

describe("staff alerts in the recipient's language (D312 A10)", () => {
  it("keeps the English as it was", () => {
    expect(newOrderEmail(store, "o", order).subject).toMatch(/^New order 1001: NOK\s1,234\.50$/);
    expect(newOrderEmail(store, "o", order).text).toContain("Delivery: Shipping\nCountry: Norway");
    expect(returnRequestedEmail(store, "r", { number: "R-1", orderNumber: "1001", kind: "return", lines: [] }).subject).toBe("Return requested: R-1 (order 1001)");
    expect(summaryEmail(store, "weekly", figures).subject).toBe("Shop: weekly summary for 2026-01-01 to 2026-01-07");
    expect(disputeEmail(store, "due", dispute).subject).toBe("Dispute evidence due Thu 1 Jan 2026, 10:00: order 1001");
  });

  it("writes Norwegian with Norwegian money, dates and words", () => {
    const o = newOrderEmail(store, "o", order, "nb");
    expect(o.subject).toMatch(/^Ny bestilling 1001: 1\s234,50/);
    expect(o.text).toContain("Levering: Frakt");
    expect(o.text).toContain("Land: Norge");
    expect(o.text).toContain("Gave");
    expect(o.html).toContain('lang="nb"');
    expect(returnRequestedEmail(store, "r", { number: "R-1", orderNumber: "1001", kind: "withdrawal", lines: [] }, "nb").subject).toBe(
      "Angrerett meldt: R-1 (bestilling 1001)",
    );
    const s = summaryEmail(store, "daily", figures, "nb");
    expect(s.subject).toBe("Shop: daglig oppsummering for 2026-01-07");
    expect(s.text).toContain("Nettosalg, ekskl. mva.");
    const d = disputeEmail(store, "opened", dispute, "nb");
    expect(d.subject).toMatch(/^Betaling bestridt: bestilling 1001, 500,00/);
    expect(d.text).toContain("Trenger svar");
    expect(disputeEmail(store, "due", dispute, "nb").subject).toMatch(/1\. jan\. 2026/);
  });

  it("writes to a contact address in the store's main language when it is Norwegian", () => {
    expect(contactLang("nb-NO")).toBe("nb");
    expect(contactLang("sv-SE")).toBe("en");
    expect(contactLang(null)).toBe("en");
  });
});
