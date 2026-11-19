import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { extensionOffer, offerCurrency, type PublicExtensions } from "@/lib/extension-offer";
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

  it("drops the founding prices once the offer has ended", () => {
    const after = extensionOffer(data, "NOK", new Date("2027-01-02T00:00:00Z"));
    expect(after.extensions[0].price.foundingMinor).toBeNull();
    expect(after.bundles[0].savingMinor).toBe(39000 + 25000 + 35000 - 85000);
  });
});

describe("ExtensionsView", () => {
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
