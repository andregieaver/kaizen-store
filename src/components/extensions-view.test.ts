import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { extensionChoices, extensionComparison, extensionOffer, offerCurrency, type PublicExtensions, type PublicPrice } from "@/lib/extension-offer";
import { extensionsIn } from "@/lib/extension-words";
import { blockHasContent, pageBlockSchema, type ExtensionsBlock } from "@/lib/page-content";
import { mapBlockTexts } from "@/lib/page-translation";

import { ExtensionsView } from "./extensions-view";

/** The Extensions block (D748 E8): the first price sheet, in NOK, with founding prices offered until the end of the year. */

const now = new Date("2026-12-01T12:00:00Z");
const nok = (amountMinor: number, foundingMinor: number | null) => ({ currency: "NOK", interval: "month" as const, amountMinor, foundingMinor });
const data: PublicExtensions = {
  extensions: [
    { id: "ab_testing", name: "A/B testing", description: "Try two versions of a page on your visitors and keep the one that sells more.", standalone: false, size: { label: "Unlimited tests", prices: [nok(29000, 19000)] } },
    { id: "support_desk", name: "AI support desk", description: "", standalone: true, size: { label: "100 AI-handled conversations a month", prices: [nok(39000, 29000)] } },
    { id: "email_automation", name: "Email automation", description: "", standalone: true, size: { label: "Up to 2,500 contacts", prices: [nok(25000, 19000)] } },
    { id: "deals", name: "Deals and contracts", description: "", standalone: true, size: { label: "3 people", prices: [nok(35000, 29000)] } },
    // No price in NOK: not drawn.
    { id: "work", name: "Work", description: "", standalone: true, size: { label: "3 people", prices: [{ ...nok(3500, 2500), currency: "EUR" }] } },
  ],
  bundles: [{ id: "b1", name: "Customers", description: "The support desk, email automation and deals together.", members: ["support_desk", "email_automation", "deals"], prices: [nok(85000, 59000)] }],
  plans: [
    { id: "p0", name: "Basic", position: 0, includes: [] },
    { id: "p1", name: "Grow", position: 1, includes: ["ab_testing"] },
    { id: "p2", name: "Advanced", position: 2, includes: ["ab_testing", "support_desk"] },
    { id: "p3", name: "Plus", position: 3, includes: ["ab_testing", "support_desk", "deals"] },
  ],
  founding: { until: "2026-12-31T23:00:00.000Z", months: 12 },
};
const block: ExtensionsBlock = { id: "ex", type: "extensions", buttonLabel: "", buttonHref: "" };

describe("extensionOffer", () => {
  it("shows each extension priced in the currency, with its founding price while offered and which plans include it", () => {
    expect(offerCurrency(data)).toBe("NOK");
    const { extensions, bundles } = extensionOffer(data, "NOK", now);
    expect(extensions.map((e) => e.id)).toEqual(["ab_testing", "support_desk", "email_automation", "deals"]);
    expect(extensions[0]).toMatchObject({ price: { amountMinor: 29000, foundingMinor: 19000 }, includedIn: { plans: ["Grow", "Advanced", "Plus"], andUp: true } });
    expect(extensions[3].includedIn).toEqual({ plans: ["Plus"], andUp: false });
    // Founding prices against founding prices: 290 + 190 + 290 = 770, the bundle 590.
    expect(bundles).toEqual([expect.objectContaining({ name: "Customers", savingMinor: 18000, members: ["AI support desk", "Email automation", "Deals and contracts"] })]);
  });

  it("leaves out what the block switched off, a bundle still saving against the prices of the extensions left out", () => {
    const { extensions, bundles } = extensionOffer(data, "NOK", now, ["ab_testing", "email_automation"]);
    expect(extensions.map((e) => e.id)).toEqual(["support_desk", "deals"]);
    expect(bundles).toEqual([expect.objectContaining({ id: "b1", savingMinor: 18000 })]);
    expect(extensionOffer(data, "NOK", now, ["b1"]).bundles).toEqual([]);
  });

  it("offers the builder each extension on offer, then each bundle, to switch off", () => {
    expect(extensionChoices(data)).toEqual([
      { id: "ab_testing", name: "A/B testing", kind: "extension" },
      { id: "support_desk", name: "AI support desk", kind: "extension" },
      { id: "email_automation", name: "Email automation", kind: "extension" },
      { id: "deals", name: "Deals and contracts", kind: "extension" },
      { id: "work", name: "Work", kind: "extension" },
      { id: "b1", name: "Customers", kind: "bundle" },
    ]);
  });

  it("drops the founding prices once the offer has ended", () => {
    const after = extensionOffer(data, "NOK", new Date("2027-01-02T00:00:00Z"));
    expect(after.extensions[0].price.foundingMinor).toBeNull();
    expect(after.bundles[0].savingMinor).toBe(39000 + 25000 + 35000 - 85000);
  });
});

/** The same sheet with yearly prices: ten months for twelve, founding prices too. */
const yearOf = (p: PublicPrice) => ({ ...p, interval: "year" as const, amountMinor: p.amountMinor * 10, foundingMinor: p.foundingMinor === null ? null : p.foundingMinor * 10 });
const withYears: PublicExtensions = {
  ...data,
  extensions: data.extensions.map((e) => (e.size ? { ...e, size: { ...e.size, prices: [...e.size.prices, ...e.size.prices.map(yearOf)] } } : e)),
  bundles: data.bundles.map((b) => ({ ...b, prices: [...b.prices, ...b.prices.map(yearOf)] })),
};

describe("extensionOffer, as the Plans block shows prices", () => {
  it("leads with the monthly price and shows the yearly one under it, with what the year saves", () => {
    const { extensions, bundles } = extensionOffer(withYears, "NOK", now);
    expect(extensions[0]).toMatchObject({ price: { interval: "month", foundingMinor: 19000 }, other: { interval: "year", foundingMinor: 190000 }, yearlySavingPercent: 17 });
    expect(bundles[0]).toMatchObject({ price: { interval: "month" }, other: { interval: "year" }, savingMinor: 18000 });
  });

  it("leads with the yearly price when asked, saving a year against the extensions' yearly prices, and marks the one recommended", () => {
    const { extensions, bundles } = extensionOffer(withYears, "NOK", now, [], { interval: "year", highlightId: "b1" });
    expect(extensions[0]).toMatchObject({ price: { interval: "year" }, other: null, yearlySavingPercent: 17, highlighted: false });
    expect(bundles[0]).toMatchObject({ price: { interval: "year" }, savingMinor: 180000, highlighted: true });
    // Monthly only: no yearly line, nothing said of a year.
    expect(extensionOffer(withYears, "NOK", now, [], { interval: "month" }).extensions[0]).toMatchObject({ other: null, yearlySavingPercent: null });
    // Asked for yearly with no yearly price: the monthly one.
    expect(extensionOffer(data, "NOK", now, [], { interval: "year" }).extensions[0].price.interval).toBe("month");
  });

  it("compares each extension shown against each bundle shown and each plan that includes one of them", () => {
    const shown = extensionOffer(data, "NOK", now, ["email_automation"]);
    expect(extensionComparison(data, shown)).toEqual({
      columns: [
        { id: "b1", name: "Customers" },
        { id: "p1", name: "Grow" },
        { id: "p2", name: "Advanced" },
        { id: "p3", name: "Plus" },
      ],
      rows: [
        { id: "ab_testing", name: "A/B testing", included: [false, true, true, true] },
        { id: "support_desk", name: "AI support desk", included: [true, false, true, true] },
        { id: "deals", name: "Deals and contracts", included: [true, false, false, true] },
      ],
    });
    expect(extensionComparison(data, { extensions: [], bundles: [] })).toEqual({ columns: [], rows: [] });
  });
});

describe("ExtensionsView", () => {
  it("draws the switch with both sets of cards, the recommended mark and the comparison table when asked", () => {
    const html = renderToStaticMarkup(createElement(ExtensionsView, { block: { ...block, switcher: true, highlightId: "support_desk", comparison: true }, data: withYears, lang: "en", now }));
    expect(html).toContain('data-plan-switch=""');
    expect(html).toContain('data-plan-panel="month"');
    expect(html).toContain('data-plan-panel="year"');
    expect(html).toContain("Save 17 %");
    expect(html).toContain("per year, billed yearly");
    expect(html.match(/>Recommended</g)?.length).toBe(2);
    expect(html).toContain("Compare extensions");
    expect(html).toContain("less a year than one by one");
    expect(pageBlockSchema.safeParse({ ...block, switcher: true, interval: "year", highlightId: "b1", comparison: true }).success).toBe(true);
  });

  it("shows the yearly price under the monthly one by default", () => {
    const html = renderToStaticMarkup(createElement(ExtensionsView, { block, data: withYears, lang: "en", now }));
    expect(html).toContain("or NOK");
    expect(html).toContain("Save 17 % with yearly billing");
    expect(html).not.toContain("data-plan-switch");
    expect(html).not.toContain("Compare extensions");
  });

  it("draws a card per extension and the bundles, without VAT, with a free trial to sign up", () => {
    const html = renderToStaticMarkup(createElement(ExtensionsView, { block, data, lang: "en", now }));
    expect(html).toContain("A/B testing");
    expect(html).toContain("Included in Grow and up");
    expect(html).toContain("For 12 months, then");
    expect(html).toContain("Founding prices until");
    expect(html).toContain("Customers");
    expect(html).toContain("less a month than one by one");
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain("Start free trial");
    expect(html).not.toContain("Work");
  });

  it("draws only what is left on, the bundles alone if every extension is off, and nothing when all is off", () => {
    const some = renderToStaticMarkup(createElement(ExtensionsView, { block: { ...block, hide: ["ab_testing"] }, data, lang: "en", now }));
    expect(some).not.toContain("A/B testing");
    expect(some).toContain("AI support desk");
    const off = ["ab_testing", "support_desk", "email_automation", "deals"];
    const bundlesOnly = renderToStaticMarkup(createElement(ExtensionsView, { block: { ...block, hide: off }, data, lang: "en", now }));
    expect(bundlesOnly).toContain("Customers");
    expect(renderToStaticMarkup(createElement(ExtensionsView, { block: { ...block, hide: [...off, "b1"] }, data, lang: "en", now }))).toBe("");
    expect(pageBlockSchema.safeParse({ ...block, hide: off }).success).toBe(true);
  });

  it("leaves the bundles out when told, and speaks Norwegian on a Norwegian page", () => {
    const html = renderToStaticMarkup(createElement(ExtensionsView, { block: { ...block, bundles: false }, data: extensionsIn(data, "nb"), lang: "nb", now }));
    expect(html).toContain("A/B-testing");
    expect(html).toContain("Prøv gratis");
    expect(html).toContain("Inkludert i Grow og opp");
    expect(html).not.toContain("Kunder");
  });

  it("is a block of Kaizena Flow's pages whose only words are its button's", () => {
    expect(pageBlockSchema.parse({ ...block, bundles: false })).toMatchObject({ type: "extensions", bundles: false });
    expect(blockHasContent(block)).toBe(true);
    const seen: string[] = [];
    mapBlockTexts({ ...block, buttonLabel: "Try" }, (key, value) => {
      seen.push(key);
      return value;
    });
    expect(seen).toEqual(["block.ex.buttonLabel"]);
  });
});
