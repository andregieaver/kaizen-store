import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { formFromSettings, readAffiliateForm } from "@/lib/affiliate-admin";
import { AFFILIATE_DEFAULTS, type AffiliateAttributionRow, type AffiliateOverview, type AffiliateRow, type AffiliateSettings, type CustomerAffiliate } from "@/lib/affiliates";

import { AffiliateBlockForm } from "./affiliate-block-form";
import { AffiliateOverviewCard } from "./affiliate-overview";
import { AffiliateSettingsForm, AffiliateSettingsView, type AffiliateSettingsViewProps } from "./affiliate-settings-form";
import { AttributionsTable, ReferrersTable } from "./affiliate-tables";
import { CustomerAffiliateSection, showsAffiliate } from "./customer-affiliate";
import { OrderAttributionCard, ReferralDiscountRow } from "./order-affiliate";

/** What a person reads before any script runs: tags out of the way, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u00a0/g, " ");

const save = async () => ({ ok: true as const });
const settings = (over: Partial<AffiliateSettings> = {}): AffiliateSettings => ({ ...AFFILIATE_DEFAULTS, ...over });

const form = (over: Partial<AffiliateSettings> = {}, props: Record<string, unknown> = {}) =>
  html(createElement(AffiliateSettingsForm, { initial: settings(over), currency: "NOK", locale: "en-GB", bonusOn: true, pendingDays: 14, canEdit: true, save, ...props }));

describe("the referral settings form", () => {
  it("shows the program off, what it does and what turning it on means", () => {
    const out = form();
    expect(out).toContain("Referral program");
    expect(out).toContain("The referral program is on");
    expect(out).not.toMatch(/id="affiliate-enabled"[^>]*checked/);
    expect(out).toContain("It is off. Nobody has a link");
    expect(out).toContain("What it comes to");
    expect(out).toContain("A friend gets 10% off the goods in their first order.");
    expect(out).toContain("A first order of NOK 1,000.00 in goods");
    expect(out).toContain(">Save<");
    expect(out).not.toContain("Turn the bonus program on under Bonus credits first");
  });

  it("shows the program on with the notes that matter, and the owner's numbers", () => {
    const out = form({ enabled: true, friendPercent: 15, friendMaxMinor: 20_000, rewardBps: 250, rewardOrders: null, monthlyCapMinor: 50_000, cookieDays: 45 });
    expect(out).toMatch(/id="affiliate-enabled"[^>]*checked/);
    expect(out).toContain("While it is on");
    expect(out).toContain("marketing cookies");
    expect(out).toContain("Nobody can refer themselves");
    expect(out).toContain('value="15"');
    expect(out).toContain('value="200,00"');
    expect(out).toContain('value="2.5"');
    expect(out).toContain('value="500,00"');
    expect(out).toContain('value="45"');
    // Every order earns: no number of orders to give.
    expect(out).not.toContain('id="affiliate-rewardOrders"');
    expect(out).toContain("One customer can earn at most NOK 500.00 a month.");
    expect(out).toContain("for every order");
  });

  it("explains the bonus program is needed, and cannot be switched on without it", () => {
    const out = form({}, { bonusOn: false });
    expect(out).toContain("Turn the bonus program on under Bonus credits first");
    expect(out).toMatch(/id="affiliate-enabled"[^>]*disabled/);
    // A program that is on can still be switched off while the bonus program is off.
    const on = form({ enabled: true }, { bonusOn: false });
    expect(on).toContain("Turn the bonus program on under Bonus credits first");
    expect(on).not.toMatch(/id="affiliate-enabled"[^>]*disabled/);
  });

  it("is read-only for staff, who see how it is set up", () => {
    const out = form({ enabled: true }, { canEdit: false });
    expect(out).toContain("Only an owner can change the referral program.");
    expect(out).not.toContain(">Save<");
    expect(out).toMatch(/<fieldset[^>]*disabled/);
  });

  it("says what is wrong beside each field, and what the server refused", () => {
    const values = { ...formFromSettings(settings(), "NOK"), friendPercent: "ten", cookieDays: "91" };
    const read = readAffiliateForm(values, "NOK");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const props: AffiliateSettingsViewProps = {
      values,
      errors: read.errors,
      serverProblems: ["Turn on the bonus program first: referrers are rewarded in bonus credits, so the referral program needs it."],
      saved: null,
      savedOn: false,
      pending: false,
      canEdit: true,
      currency: "NOK",
      locale: "en-GB",
      bonusOn: true,
      pendingDays: 14,
      shown: settings(),
      complete: false,
      onChange: () => {},
      onSubmit: () => {},
    };
    const out = html(createElement(AffiliateSettingsView, props));
    expect(out).toContain("The settings were not saved. Fix this:");
    expect(out).toContain("Write a whole percentage such as 10, or 0 for no welcome discount.");
    expect(out).toContain("Write a number of days from 1 to 90.");
    expect(out).toContain("Turn on the bonus program first: referrers are rewarded");
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("This shows the last rules that were complete.");
    expect(out).toContain('href="#affiliate-friendPercent"');
  });
});

const overview: AffiliateOverview = { currency: "NOK", affiliates: 3, visits30d: 40, orders30d: 5, rewarded30dMinor: 12_500, outstandingMinor: 10_000, pendingMinor: 2_500, rejected30d: 1 };

describe("the overview", () => {
  it("shows the figures of the program, and what the store still owes", () => {
    const out = html(createElement(AffiliateOverviewCard, { overview, locale: "en-GB" }));
    expect(out).toContain("Referrals at a glance");
    expect(out).toContain("Customers with a link");
    expect(out).toContain("NOK 125.00");
    expect(out).toContain("NOK 100.00");
    expect(out).toContain("What the store still owes in price reductions for referrals.");
  });
});

const rows: AffiliateRow[] = [
  { customerId: "c1", name: "Lisa Listed", email: "lisa@example.com", code: "abcdef23", blocked: false, friends: 2, earnedMinor: 12_500 },
  { customerId: "c2", name: "", email: "bo@example.com", code: "zzzzzz22", blocked: true, friends: 0, earnedMinor: 0 },
];
const act = async () => ({ ok: true as const });

describe("the referrers", () => {
  it("lists who they are (staff may see), their codes, friends and earnings, and whether they are blocked", () => {
    const out = html(createElement(ReferrersTable, { rows, storeSlug: "kaffe", currency: "NOK", locale: "en-GB", canBlock: true, block: act }));
    expect(out).toContain("Lisa Listed (lisa@example.com)");
    expect(out).toContain('href="/admin/kaffe/customers/c1"');
    expect(out).toContain("abcdef23");
    expect(out).toContain("NOK 125.00");
    expect(out).toContain(">Block Lisa<");
    expect(out).toContain(">Unblock bo@example.com<");
  });

  it("shows only the status without the power to block, and explains an empty list", () => {
    const read = html(createElement(ReferrersTable, { rows, storeSlug: "kaffe", currency: "NOK", locale: "en-GB", canBlock: false, block: act }));
    expect(read).not.toContain("Block Lisa");
    expect(read).toContain("Earning");
    expect(read).toContain("Blocked");
    expect(html(createElement(ReferrersTable, { rows: [], storeSlug: "kaffe", currency: "NOK", locale: "en-GB", canBlock: true, block: act }))).toContain("Nobody has a link yet.");
  });
});

const attribution = (over: Partial<AffiliateAttributionRow> = {}): AffiliateAttributionRow => ({
  id: "a1",
  at: "2026-09-30T10:00:00.000Z",
  orderId: "o1",
  orderNumber: "1001",
  friendId: "f1",
  friendName: "Bob Buyer",
  friendEmail: "bob@example.com",
  affiliateId: "c1",
  affiliateName: "Lisa Listed",
  code: "abcdef23",
  status: "rewarded",
  reason: null,
  discountMinor: 1_000,
  orderCurrency: "NOK",
  rewardMinor: 500,
  creditsCurrency: "NOK",
  ...over,
});

describe("the orders that came through links", () => {
  it("lists the order, who shared the link, the friend, what each got and the status", () => {
    const out = html(createElement(AttributionsTable, { rows: [attribution(), attribution({ id: "a2", orderId: "o2", orderNumber: "1002", status: "rejected", reason: "self", rewardMinor: 0, discountMinor: 0, friendId: null })], storeSlug: "kaffe", locale: "en-GB" }));
    expect(out).toContain("#1001");
    expect(out).toContain('href="/admin/kaffe/orders/o1"');
    expect(out).toContain("Bob Buyer (bob@example.com)");
    expect(out).toContain("NOK 10.00");
    expect(out).toContain("NOK 5.00");
    expect(out).toContain("Rewarded");
    expect(out).toContain("No reward: The friend is the referrer");
    expect(out).toContain("Deleted customer");
    expect(html(createElement(AttributionsTable, { rows: [], storeSlug: "kaffe", locale: "en-GB" }))).toContain("No order has come through a link yet.");
  });
});

describe("blocking a referrer", () => {
  it("offers to block, asking for a reason first, or to unblock in one step", () => {
    expect(html(createElement(AffiliateBlockForm, { blocked: false, who: "Lisa", act }))).toContain(">Block Lisa<");
    const unblock = html(createElement(AffiliateBlockForm, { blocked: true, who: "Lisa", act }));
    expect(unblock).toContain(">Unblock Lisa<");
    expect(unblock).not.toContain("Reason");
  });
});

describe("the order page's parts", () => {
  it("shows the welcome discount among the totals, nothing without one", () => {
    expect(html(createElement(ReferralDiscountRow, { minor: 4_980, currency: "NOK", locale: "en-GB" }))).toContain("Welcome discount (referral)");
    expect(html(createElement(ReferralDiscountRow, { minor: 4_980, currency: "NOK", locale: "en-GB" }))).toContain("−NOK 49.80");
    expect(html(createElement(ReferralDiscountRow, { minor: 0, currency: "NOK", locale: "en-GB" }))).toBe("");
  });

  it("says whose friend the order is, the status and what each got; nothing for an order no link led to", () => {
    const out = html(createElement(OrderAttributionCard, { attribution: attribution(), storeSlug: "kaffe", locale: "en-GB" }));
    expect(out).toContain("Referral");
    expect(out).toContain("Lisa Listed");
    expect(out).toContain('href="/admin/kaffe/customers/c1"');
    expect(out).toContain("abcdef23");
    expect(out).toContain("NOK 10.00");
    expect(out).toContain("NOK 5.00");
    const rejected = html(createElement(OrderAttributionCard, { attribution: attribution({ status: "rejected", reason: "not_new", rewardMinor: 0, discountMinor: 0 }), storeSlug: "kaffe", locale: "en-GB" }));
    expect(rejected).toContain("No reward: The friend had ordered before");
    expect(rejected).toContain("None");
    expect(html(createElement(OrderAttributionCard, { attribution: null, storeSlug: "kaffe", locale: "en-GB" }))).toBe("");
  });
});

describe("a customer's page", () => {
  const data = (over: Partial<CustomerAffiliate> = {}): CustomerAffiliate => ({
    code: "abcdef23",
    blocked: false,
    blockedReason: "",
    friends: 2,
    earnedMinor: 12_500,
    currency: "NOK",
    referredBy: null,
    attributions: [attribution()],
    ...over,
  });

  it("shows whether a customer takes part at all", () => {
    expect(showsAffiliate(data())).toBe(true);
    expect(showsAffiliate(data({ code: null, attributions: [], referredBy: { customerId: "c9", name: "", email: "x@example.com", code: "qqqqqq22" } }))).toBe(true);
    expect(showsAffiliate(data({ code: null, attributions: [] }))).toBe(false);
  });

  it("shows their link, friends and earnings, who referred them and the orders through links", () => {
    const out = html(
      createElement(CustomerAffiliateSection, {
        data: data({ referredBy: { customerId: "c9", name: "Rita Referrer", email: "rita@example.com", code: "qqqqqq22" } }),
        storeSlug: "kaffe",
        locale: "en-GB",
        who: "Lisa",
        block: act,
      }),
    );
    expect(out).toContain("Came through the link of");
    expect(out).toContain("Rita Referrer (rita@example.com)");
    expect(out).toContain("abcdef23");
    expect(out).toContain("NOK 125.00");
    expect(out).toContain("Orders through links");
    expect(out).toContain("#1001");
    expect(out).toContain("Rewarded");
    expect(out).toContain(">Block Lisa<");
  });

  it("says when they are blocked, and why", () => {
    const out = html(createElement(CustomerAffiliateSection, { data: data({ blocked: true, blockedReason: "Referred herself" }), storeSlug: "kaffe", locale: "en-GB", who: "Lisa", block: act }));
    expect(out).toContain("Blocked: they earn nothing new.");
    expect(out).toContain("Reason: Referred herself");
    expect(out).toContain(">Unblock Lisa<");
  });
});
