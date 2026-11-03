import { describe, expect, it } from "vitest";

import { storeDiscountInput } from "./discounts";
import { amountOf, countriesOf, discountInputOf, discountOf, fontFamilyOf, hexOf, lookFromAnswer, lookOf, shippingOf, type DiscountLine } from "./shopify-settings";

const ALL = { __typename: "DiscountBuyerSelectionAll" };
const basic = (over: Record<string, unknown> = {}) => ({
  codeDiscount: {
    __typename: "DiscountCodeBasic",
    title: "Summer",
    status: "ACTIVE",
    startsAt: "2026-06-01T00:00:00Z",
    endsAt: null,
    usageLimit: 100,
    appliesOncePerCustomer: true,
    codes: { nodes: [{ code: "SUMMER10" }] },
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    context: ALL,
    minimumRequirement: null,
    customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 }, items: { __typename: "AllDiscountItems" } },
    ...over,
  },
});

describe("Shopify's settings for the copy", () => {
  it("reads amounts without trailing zeros, at most two decimals", () => {
    expect([amountOf("49.00"), amountOf("49.50"), amountOf("500"), amountOf(12.5), amountOf("1.2345"), amountOf("-3"), amountOf("abc")]).toEqual(["49", "49.5", "500", "12.5", null, null, null]);
  });

  it("lists every country of every market once, with its market's currency", () => {
    const data = {
      markets: {
        nodes: [
          { name: "Norway", regions: { nodes: [{ code: "NO" }] }, currencySettings: { baseCurrency: { currencyCode: "NOK" } } },
          { name: "Nordics", regions: { nodes: [{ code: "SE" }, { code: "NO" }, { code: "xx" }] }, currencySettings: { baseCurrency: { currencyCode: "SEK" } } },
        ],
      },
    };
    expect(countriesOf(data)).toEqual([
      { code: "NO", currency: "NOK" },
      { code: "SE", currency: "SEK" },
    ]);
  });

  it("turns the general profile's rates into one flat rate per country, free above the lowest free threshold", () => {
    const method = (amount: string, conditions: unknown[] = [], active = true) => ({ active, rateProvider: { price: { amount, currencyCode: "NOK" } }, methodConditions: conditions });
    const over = (amount: string) => ({ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { amount, currencyCode: "NOK" } });
    const data = {
      deliveryProfiles: {
        nodes: [
          { default: false, profileLocationGroups: [] },
          {
            default: true,
            profileLocationGroups: [
              {
                locationGroupZones: {
                  nodes: [
                    {
                      zone: { countries: [{ code: { countryCode: "NO", restOfWorld: false } }] },
                      methodDefinitions: { nodes: [method("99.00"), method("79.00"), method("0.00", [over("1000.00")]), method("0", [over("800")], false), method("49", [{ field: "TOTAL_WEIGHT", operator: "LESS_THAN_OR_EQUAL_TO", conditionCriteria: {} }])] },
                    },
                    { zone: { countries: [{ code: { countryCode: null, restOfWorld: true } }] }, methodDefinitions: { nodes: [method("300")] } },
                    { zone: { countries: [{ code: { countryCode: "SE", restOfWorld: false } }] }, methodDefinitions: { nodes: [{ active: true, rateProvider: {}, methodConditions: [] }] } },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    expect(shippingOf(data)).toEqual([{ country: "NO", currency: "NOK", amount: "79", freeOver: "1000" }]);
  });

  it("reads a percentage code, a fixed one with a minimum, free shipping, and says why the rest stay behind", () => {
    expect(discountOf(basic())).toMatchObject({ code: "SUMMER10", kind: "percent", percent: 10, productHandles: null, usageLimit: 100, oncePerCustomer: true, combinesWith: ["shipping"], startsAt: "2026-06-01T00:00:00.000Z" });
    expect(
      discountOf(
        basic({
          customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "50.00", currencyCode: "NOK" }, appliesOnEachItem: false }, items: { __typename: "DiscountCollections", collections: { nodes: [{ title: "Hats / Caps" }] } } },
          minimumRequirement: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "300.0", currencyCode: "NOK" } },
        }),
      ),
    ).toMatchObject({ kind: "fixed", amount: { amount: "50", currency: "NOK" }, minSubtotal: { amount: "300", currency: "NOK" }, productHandles: [], categoryNames: ["Hats - Caps"] });
    expect(discountOf({ codeDiscount: { ...basic().codeDiscount, __typename: "DiscountCodeFreeShipping", maximumShippingPrice: null } })).toMatchObject({ kind: "free_shipping" });
    expect(discountOf({ codeDiscount: { ...basic().codeDiscount, __typename: "DiscountCodeFreeShipping", maximumShippingPrice: { amount: "50.0" } } })).toEqual({ leftOut: "max_shipping", code: "SUMMER10" });
    expect(discountOf({ codeDiscount: { ...basic().codeDiscount, __typename: "DiscountCodeBxgy" } })).toMatchObject({ leftOut: "other_kind" });
    expect(discountOf(basic({ context: { __typename: "DiscountCustomerSegments" } }))).toMatchObject({ leftOut: "some_customers" });
    expect(discountOf(basic({ status: "EXPIRED" }))).toMatchObject({ leftOut: "expired" });
    expect(discountOf(basic({ customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.125 }, items: { __typename: "AllDiscountItems" } } }))).toMatchObject({ leftOut: "not_whole_percent" });
    expect(discountOf(basic({ customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "5", currencyCode: "NOK" }, appliesOnEachItem: true }, items: { __typename: "AllDiscountItems" } } }))).toMatchObject({ leftOut: "each_item" });
    expect(discountOf(basic({ customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.2 }, items: { __typename: "DiscountProducts", products: { nodes: [] }, productVariants: { nodes: [{ id: "v" }] } } } }))).toMatchObject({ leftOut: "variants" });
  });

  it("gives saveDiscount's own input, switched off, only in countries of the code's currency", () => {
    const markets = [
      { code: "NO", currency: "NOK" },
      { code: "SE", currency: "SEK" },
    ];
    const fixed = discountOf(
      basic({
        customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "50.00", currencyCode: "NOK" }, appliesOnEachItem: false }, items: { __typename: "AllDiscountItems" } },
        minimumRequirement: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "300", currencyCode: "NOK" } },
      }),
    ) as DiscountLine;
    const input = discountInputOf(fixed, markets, null, []);
    expect(input).toMatchObject({ code: "SUMMER10", kind: "fixed", amounts: { NO: "50" }, minSubtotals: { NO: "300" }, productIds: null, active: false });
    expect(storeDiscountInput.safeParse(input).success).toBe(true);
    const id = "8a7b0f8e-3a77-4f43-9b51-6f5a8a7d6d11";
    expect(discountInputOf({ ...fixed, productHandles: [], categoryNames: ["Hats"] }, markets, [], [id])).toMatchObject({ productIds: null, termIds: [id] });
    expect(storeDiscountInput.safeParse(discountInputOf({ ...fixed, productHandles: [], categoryNames: ["Hats"] }, markets, [], [id])).success).toBe(true);
    expect(discountInputOf({ ...fixed, amount: { amount: "5", currency: "EUR" } }, markets, null, [])).toBeNull();
  });

  it("reads the live theme's colours and fonts, from a colour scheme or the older names, behind a comment", () => {
    const dawn = `/* Shopify's comment */ ${JSON.stringify({ current: { type_header_font: "playfair_display_n7", type_body_font: "assistant_n4", color_schemes: { "scheme-1": { settings: { background: "#FFFFFF", text: "#121212", button: "#1F6F5C" } } } } })}`;
    expect(lookOf("Dawn", dawn)).toEqual({ name: "Dawn", accent: "#1f6f5c", background: "#ffffff", text: "#121212", headingFont: "Playfair Display", bodyFont: "Assistant" });
    const older = JSON.stringify({ current: "Default", presets: { Default: { colors_accent_1: "rgb(200, 16, 46)", colors_background_1: "#fff", colors_text: "#333333" } } });
    expect(lookOf("Old", older)).toEqual({ name: "Old", accent: "#c8102e", background: "#ffffff", text: "#333333", headingFont: null, bodyFont: null });
    expect(lookOf("None", JSON.stringify({ current: {} }))).toBeNull();
    expect(lookOf("Broken", "{")).toBeNull();
    expect(lookFromAnswer({ themes: { nodes: [{ name: "Dawn", files: { nodes: [{ body: { content: dawn } }] } }] } })?.accent).toBe("#1f6f5c");
    expect([fontFamilyOf("helvetica_n4"), fontFamilyOf("dm_sans_i4"), fontFamilyOf("x"), hexOf("rgba(0,0,0,0.5)"), hexOf("linear-gradient(red, blue)")]).toEqual(["Helvetica", "Dm Sans", null, null, null]);
  });
});
