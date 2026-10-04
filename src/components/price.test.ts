import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { priceView, WITH_VAT } from "@/lib/pricing";
import type { PriceVat } from "@/lib/pricing";
import { planPrice } from "@/lib/subscriptions";
import type { ShownMeasure } from "@/lib/unit-price";
import { unitLabelsOf } from "@/lib/unit-price-text";

import { LineUnitPrice, Price, UnitLine } from "./price";
import { PlanPrice, PurchaseOptions } from "./purchase-options";

/**
 * The price per kg, litre or metre beside a price (D160, docs/wave-1d-unit-price.md 2.1): the line under a price, its VAT display,
 * what it says for a screen reader, and when it is left out. The figures themselves are held by `unit-price.test.ts`; this holds
 * that the surface gives `unitPrice()` the price as it shows it and draws what comes back.
 */

const nb = t("nb");
const en = t("en");
const kaffe: ShownMeasure = { amount: "250", unit: "g", base: "kg" };
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;| /g, " ")
    .replace(/\s+/g, " ")
    .trim();
const vat = (shown: PriceVat["shown"]): PriceVat => ({ rate: 0.25, shown });
const line = (props: Partial<Parameters<typeof UnitLine>[0]> = {}) =>
  renderToString(
    createElement(UnitLine, {
      amountMinor: 4990,
      currency: "NOK",
      locale: "nb-NO",
      vat: WITH_VAT,
      measure: kaffe,
      labels: unitLabelsOf(nb),
      ...props,
    }),
  );
const price = (view: ReturnType<typeof priceView>, m = nb, locale = "nb-NO") =>
  renderToString(createElement(Price, { price: view, locale, m }));

describe("the unit line under a price", () => {
  it("shows the price per kg of the price shown, in the market's currency and the language's number format", () => {
    expect(text(line())).toContain("199,60 kr/kg");
    expect(text(line({ locale: "en-GB", currency: "NOK", labels: unitLabelsOf(en) }))).toContain("199.60/kg");
  });

  it("draws the figure for the eye and the label as words for a screen reader", () => {
    const html = line();
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/sr-only[^>]*>Enhetspris: [^<]*199,60[^<]* per kg</);
    expect(html).toContain("text-muted");
  });

  it("follows the price's VAT display: with VAT, without it (netted and rounded first), or both", () => {
    // 4990 with 25% VAT is 3992 without, and 3992 x 4 is 15968 per kg (the table of 4.1).
    expect(text(line({ vat: vat("excl") }))).toContain("159,68 kr/kg");
    expect(text(line({ vat: vat("excl") }))).not.toContain("199,60");
    const both = line({ vat: vat("choice") }).replace(/[\u00a0\u202f]/g, " ");
    expect(both).toMatch(/for-private[^>]*>.*199,60 kr\/kg/);
    expect(both).toMatch(/for-business[^>]*>.*159,68 kr\/kg/);
  });

  it("says nothing about VAT itself: the price above carries the label", () => {
    expect(text(line())).not.toMatch(/mva/i);
  });

  it("is left out with no content, for a free price, and when it equals the price", () => {
    expect(line({ measure: null })).toBe("");
    expect(line({ amountMinor: 0 })).toBe("");
    expect(line({ measure: { amount: "1", unit: "kg", base: "kg" } })).toBe("");
    expect(line({ measure: { amount: "1000", unit: "g", base: "kg" } })).toBe("");
    // A figure that rounds to nothing is never shown as 0,00.
    expect(line({ amountMinor: 1, measure: { amount: "1000000", unit: "g", base: "kg" } })).toBe("");
  });

  it("in a business-only store with no figure for the business view draws nothing, and in a mixed store only the view that has one", () => {
    expect(line({ amountMinor: 1, vat: vat("excl"), measure: { amount: "1000000", unit: "g", base: "kg" } })).toBe("");
    const mixed = line({ amountMinor: 4, vat: vat("choice"), measure: { amount: "4", unit: "g", base: "kg" } });
    expect(mixed).toContain("for-private");
  });

  it("can be drawn inside a link without a paragraph (the chat card)", () => {
    const html = line({ inline: true });
    expect(html.startsWith("<span")).toBe(true);
    expect(html).not.toContain("<p");
  });

  it("is the euro view's own figure: from the euro price shown, not converted from the krone one", () => {
    // 4999 NOK shown as 435 EUR at 11,5: 435 x 4 = 1740 per kg (a converted 19996 would be 1739).
    expect(text(line({ amountMinor: 435, currency: "EUR", locale: "nb-NO" }))).toContain("17,40");
  });
});

describe("the price block", () => {
  it("draws the unit line last, under the price", () => {
    const html = price(priceView(4990, "NOK", null, WITH_VAT, kaffe));
    const copy = text(html);
    expect(copy).toContain("49,90 kr");
    expect(copy.indexOf("199,60 kr/kg")).toBeGreaterThan(copy.indexOf("49,90 kr"));
  });

  it("draws nothing extra for a product without content", () => {
    expect(price(priceView(4990, "NOK", null, WITH_VAT))).not.toContain("data-unit-price");
  });

  it("shows a reduced price's unit price of the price charged, and the 30-day reference apart, without a unit price of its own", () => {
    // Lowered from 4990 to 3990: 3990 x 4 is 15960, never the old 19960.
    const reduced = price(priceView(3990, "NOK", 4990, WITH_VAT, kaffe));
    const copy = text(reduced);
    expect(copy).toContain("Laveste pris siste 30 dager: 49,90 kr");
    expect(copy).toContain("159,60 kr/kg");
    expect(copy).not.toContain("199,60");
    // Exactly one unit line, and it comes after the reference line, not inside it.
    expect(reduced.match(/data-unit-price/g)).toHaveLength(1);
    expect(reduced.indexOf("data-unit-price")).toBeGreaterThan(reduced.indexOf("Laveste pris"));
    expect(reduced.slice(reduced.indexOf("Laveste pris"), reduced.indexOf("data-unit-price"))).toContain("</p>");
  });

  it("follows the language: Swedish and Danish and English labels for the same figure", () => {
    const view = priceView(4990, "SEK", null, WITH_VAT, kaffe);
    expect(price(view, t("sv"), "sv-SE")).toMatch(/Jämförpris: [^<]*per kg/);
    expect(price(priceView(4990, "DKK", null, WITH_VAT, kaffe), t("da"), "da-DK")).toMatch(/Enhedspris: [^<]*per kg/);
    expect(price(view, en, "en-GB")).toMatch(/Unit price: [^<]*per kg/);
  });

  it("uses 100 g where the market's base is 100 g", () => {
    const html = price(priceView(4990, "NOK", null, WITH_VAT, { amount: "250", unit: "g", base: "100g" }));
    expect(text(html)).toContain("19,96 kr/100 g");
  });
});

describe("a line's unit price (cart, checkout, order)", () => {
  const draw = (props: Partial<Parameters<typeof LineUnitPrice>[0]>) =>
    renderToString(createElement(LineUnitPrice, { shownMinor: 4990, measure: kaffe, currency: "NOK", locale: "nb-NO", m: nb, ...props }));

  it("is of one unit's price as the line shows it, whatever the quantity", () => {
    expect(text(draw({}))).toContain("199,60 kr/kg");
  });

  it("is of the net price for a business buyer (the caller nets the price as the line does)", () => {
    expect(text(draw({ shownMinor: 3992 }))).toContain("159,68 kr/kg");
  });

  it("is left out for a gift, a free line, a missing price and no content", () => {
    expect(draw({ gift: true })).toBe("");
    expect(draw({ shownMinor: 0 })).toBe("");
    expect(draw({ shownMinor: null })).toBe("");
    expect(draw({ measure: null })).toBe("");
  });

  it("says it in words for a screen reader too", () => {
    expect(draw({})).toMatch(/sr-only[^>]*>Enhetspris: [^<]*per kg</);
  });
});

describe("the purchase option's price (D25)", () => {
  const plans = [{ id: "p1", discountPercent: 10, label: "Every month", note: "" }];
  const choose = (props: { subscriptionOnly: boolean; measure: ShownMeasure | null }) =>
    renderToString(
      createElement(
        PurchaseOptions,
        {
          plans,
          subscriptionOnly: props.subscriptionOnly,
          labels: { legend: "Buy", oneTime: "Once" },
        } as ComponentProps<typeof PurchaseOptions>,
        createElement(
          PlanPrice,
          {
            amountMinor: 4990,
            currency: "NOK",
            locale: "nb-NO",
            vat: WITH_VAT,
            labels: { vatIncluded: "inkl. mva.", vatExcluded: "eks. mva." },
            measure: props.measure,
            unitLabels: unitLabelsOf(nb),
          } as ComponentProps<typeof PlanPrice>,
          createElement("span", null, "the one-time price"),
        ),
      ),
    );

  it("works the unit price out again from the subscriber's reduced price", () => {
    // 10 % off 4990 is 4491; 4491 x 4 is 17964 per kg.
    expect(planPrice(4990, 10)).toBe(4491);
    const copy = text(choose({ subscriptionOnly: true, measure: kaffe }));
    expect(copy).toContain("44,91 kr");
    expect(copy).toContain("179,64 kr/kg");
    expect(copy).not.toContain("199,60");
  });

  it("shows the one-time price block, with its own unit line, when buying once", () => {
    const copy = text(choose({ subscriptionOnly: false, measure: kaffe }));
    expect(copy).toContain("the one-time price");
    expect(copy).not.toContain("179,64");
  });

  it("has no unit line without content", () => {
    expect(choose({ subscriptionOnly: true, measure: null })).not.toContain("data-unit-price");
  });
});
