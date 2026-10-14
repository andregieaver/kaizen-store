import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FormState } from "@/components/admin/action-form";

// The method editor moves to the new method's page once saved; drawn on the server here, it never navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));

import { LocalView, GEONAMES_ATTRIBUTION, type LocalAreaItem } from "./local-view";
import { MethodEditor } from "./method-editor";
import { MethodsListView, ratesSummary } from "./methods-list";
import { PickupView, type PickupPlace } from "./pickup-view";
import { ProfilesView } from "./profiles-view";
import { ShippingHubView, warningWords } from "./shipping-hub";
import { MarketTabs, chosenMarket } from "./shipping-parts";
import { ZonesView } from "./zones-view";

/** The admin's shipping screens (D237, `docs/wave-3-shipping-methods.md` 2.1 to 2.3, 6.1 "Admin screens"), drawn as the server draws them. */

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s  ]+/g, " ");
const draw = (element: Parameters<typeof renderToString>[0]) => {
  const html = renderToString(element);
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};
const action = async (): Promise<FormState> => ({ status: "ok", messages: [] });

const ZONE = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const METHOD = "33333333-3333-4333-8333-333333333333";
const PLACE = "44444444-4444-4444-8444-444444444444";

describe("the Shipping hub", () => {
  const markets = [
    { code: "NO", name: "Norway", currency: "NOK", methods: 2, activeMethods: 1, zones: 1, hasFlat: true },
    { code: "SE", name: "Sweden", currency: "SEK", methods: 1, activeMethods: 1, zones: 0, hasFlat: false },
  ];

  it("shows the flat rate first, a card per part, and the warnings in words", () => {
    const { text, html } = draw(
      h(ShippingHubView, {
        base: "/admin/s/settings/shipping",
        markets,
        profiles: 1,
        profiledProducts: 3,
        defaultWeightGrams: 500,
        pickup: { places: 2, active: 1 },
        local: { areas: 0, active: 0 },
        warnings: [
          { code: "no_flat_with_methods", marketCode: "SE" },
          { code: "zones_without_rest", marketCode: "NO" },
          { code: "subscriptions_need_flat", marketCode: "SE" },
          { code: "default_weight_used", variants: 4 },
        ],
        flatRateForm: h("p", null, "FLAT FORM"),
        defaultWeightForm: h("p", null, "WEIGHT FORM"),
      }),
    );
    expect(text).toContain("Needs a look");
    expect(text).toContain("Sweden: there is no flat rate, so a basket no method prices cannot be bought.");
    expect(text).toContain("Norway: no method has a rate for Rest of country");
    expect(text).toContain("Sweden: subscriptions and subscription boxes pay the flat rate, and none is set.");
    expect(text).toContain("4 variants have no weight and use the default weight in weight tiers.");
    expect(text.indexOf("Flat rate per country")).toBeLessThan(text.indexOf("Methods"));
    expect(text).toContain("FLAT FORM");
    expect(text).toContain("WEIGHT FORM");
    expect(text).toContain("1 method offered, 1 off");
    expect(text).toContain("No flat rate");
    expect(text).toContain("1 profile besides General, with 3 products.");
    expect(text).toContain("Offered at 1 place of 2.");
    expect(text).toContain("No areas yet.");
    expect(text).toContain("now 500 g");
    for (const href of ["methods?market=NO", "zones", "profiles", "pickup", "local"]) expect(html).toContain(`/admin/s/settings/shipping/${href}`);
    expect(html).toContain('href="/admin/s/integrations"');
  });

  it("says nothing needs a look when nothing does, and a single variant in the singular", () => {
    const { text } = draw(
      h(ShippingHubView, {
        base: "/b",
        markets: [markets[0]],
        profiles: 0,
        profiledProducts: 0,
        defaultWeightGrams: 750,
        pickup: { places: 0, active: 0 },
        local: { areas: 2, active: 1 },
        warnings: [],
        flatRateForm: null,
        defaultWeightForm: null,
      }),
    );
    expect(text).not.toContain("Needs a look");
    expect(text).toContain("No stores or pickup points yet.");
    expect(text).toContain("1 area on, of 2.");
    expect(warningWords({ code: "default_weight_used", variants: 1 }, (c) => c)).toBe("1 variant has no weight and uses the default weight in weight tiers.");
  });
});

describe("the methods list and the market tabs", () => {
  it("lists a market's methods with what their rates come to, offered or off, and moves them", () => {
    const { text, html } = draw(
      h(MethodsListView, {
        base: "/b",
        market: { code: "NO", name: "Norway", currency: "NOK" },
        canWrite: true,
        move: () => async () => undefined,
        methods: [
          { id: METHOD, name: "Standard", active: true, estimate: { min: 1, max: 3 }, freeOverMinor: 100000, rates: [{ zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900 }] },
          {
            id: "m2",
            name: "Express",
            active: false,
            estimate: null,
            freeOverMinor: null,
            rates: [
              { zoneId: null, profileId: null, basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 14900 },
              { zoneId: ZONE, profileId: null, basis: "value", minValue: 0, maxValue: null, amountMinor: 0 },
            ],
          },
        ],
      }),
    );
    expect(text).toContain("Standard");
    expect(text).toContain("NOK 99.00 flat · 1–3 days · free from NOK 1,000.00");
    expect(text).toContain("2 rate blocks, by weight, by basket value");
    expect(text).toContain("Offered");
    expect(text).toContain("Off");
    expect(html).toContain(`href="/b/methods/${METHOD}"`);
    expect(html).toContain('href="/b/methods/new?market=NO"');
    expect(html).toContain('aria-label="Move Standard up"');
    expect(ratesSummary([], "NOK")).toBe("No rates yet: not offered");
  });

  it("says a market with no methods pays the flat rate, and hides buttons from someone who may only read", () => {
    const { text, html } = draw(h(MethodsListView, { base: "/b", market: { code: "SE", name: "Sweden", currency: "SEK" }, canWrite: false, move: () => async () => undefined, methods: [] }));
    expect(text).toContain("No methods in Sweden yet: baskets there pay the flat rate.");
    expect(html).not.toContain("Add a method");
  });

  it("marks the country shown, and falls back to the first", () => {
    const { html } = draw(h(MarketTabs, { href: (c: string) => `/z?market=${c}`, markets: [{ code: "NO", name: "Norway" }, { code: "SE", name: "Sweden" }], current: "SE" }));
    expect(html).toMatch(/aria-current="page"[^>]*>Sweden|href="\/z\?market=SE"[^>]*aria-current="page"/);
    expect(chosenMarket([{ code: "NO" }, { code: "SE" }], "se")?.code).toBe("SE");
    expect(chosenMarket([{ code: "NO" }, { code: "SE" }], "DK")?.code).toBe("NO");
    expect(chosenMarket([], "NO")).toBeNull();
  });
});

describe("the method editor's grid", () => {
  const props = {
    base: "/b",
    market: { code: "NO", name: "Norway", currency: "NOK" },
    zones: [{ id: ZONE, name: "Northern Norway" }],
    profiles: [{ id: PROFILE, name: "Bulky" }],
    canWrite: true,
    save: async () => ({ ok: true as const, id: METHOD, message: "Method saved." }),
  };

  it("draws a block per zone and profile with the saved rates, the ladder's from values and Not offered in words", () => {
    const { text, html } = draw(
      h(MethodEditor, {
        ...props,
        method: {
          id: METHOD,
          name: "Standard",
          names: {},
          estimate: { min: 1, max: 3 },
          freeOverMinor: 100000,
          active: true,
          rates: [
            { zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900 },
            { zoneId: ZONE, profileId: null, basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 14900 },
            { zoneId: ZONE, profileId: null, basis: "weight", minValue: 2000, maxValue: null, amountMinor: 24900 },
          ],
        },
      }),
    );
    expect(text.indexOf("Rest of country")).toBeLessThan(text.indexOf("Northern Norway"));
    expect(text.indexOf("General")).toBeLessThan(text.indexOf("Bulky"));
    expect(html).toContain('value="Standard"');
    expect(html).toContain('value="1000"');
    expect(html).toContain('value="99"');
    expect(html).toContain('aria-label="Tier 1 up to, kg"');
    expect(html).toContain('value="149"');
    expect(html).toContain('placeholder="and above"');
    expect(text).toContain("This method is not offered to a basket with Bulky products sent to Rest of country.");
    expect(text).toContain("This method is not offered to a basket with Bulky products sent to Northern Norway.");
    expect(text).toContain("Save method");
    expect(text).toContain("Amounts include VAT, in NOK.");
  });

  it("starts a new method with every block Not offered, and offers no Save to someone who may only read", () => {
    const fresh = draw(h(MethodEditor, { ...props, method: null }));
    expect(fresh.text).toContain("Add method");
    expect(fresh.html.match(/<option value="none" selected=""/g)?.length).toBe(4);
    const readOnly = draw(h(MethodEditor, { ...props, method: null, canWrite: false }));
    expect(readOnly.text).not.toContain("Add method");
  });
});

describe("zones and profiles", () => {
  it("lists a market's zones with their patterns, a delete per zone, a form to add one and the code check", () => {
    const { text, html } = draw(
      h(ZonesView, {
        market: { code: "NO", name: "Norway" },
        zones: [{ id: ZONE, name: "Northern Norway", patterns: ["8*", "9*", "7010"] }],
        canWrite: true,
        save: () => action,
        remove: () => action,
        check: action,
      }),
    );
    expect(text).toContain("Check a postal code");
    expect(html).toContain("8*, 9*, 7010");
    expect(text).toContain("Postal codes and prefixes (3)");
    expect(text).toContain("Delete Northern Norway");
    expect(text).toContain("Add a zone");
    expect(text).toContain("At most 1000 codes and 3,000 characters a zone.");
    const empty = draw(h(ZonesView, { market: { code: "SE", name: "Sweden" }, zones: [], canWrite: false, save: () => action, remove: () => action, check: action }));
    expect(empty.text).toContain("No zones: every postal code in Sweden is Rest of country.");
    expect(empty.text).not.toContain("Add a zone");
  });

  it("shows General's count, each profile with its products ticked, and what deleting does", () => {
    const products = [
      { id: "p1", title: "Sofa", profileId: PROFILE, shipped: true },
      { id: "p2", title: "Mug", profileId: null, shipped: true },
      { id: "p3", title: "Gift card", profileId: null, shipped: false },
    ];
    const { text, html } = draw(h(ProfilesView, { profiles: [{ id: PROFILE, name: "Bulky", products: 1 }], products, canWrite: true, save: () => action, remove: () => action }));
    expect(text).toContain("General");
    expect(text).toContain("2 products.");
    expect(text).toContain("Products in this profile: 1");
    expect(html).toContain(`name="product" value="p1"`);
    expect(text).toContain("Gift card (not shipped)");
    expect(text).toContain("· in Bulky");
    expect(text).toContain("Its 1 product moves to General, and its rates are removed.");
    expect(text).toContain("Add a profile");
  });
});

describe("pickup and local delivery settings", () => {
  const place = (change: Partial<PickupPlace>): PickupPlace => ({
    locationId: PLACE,
    name: "Shop Oslo",
    kind: "shop",
    street: "Storgata 1",
    postalCode: "0155",
    city: "Oslo",
    country: "NO",
    sellsThere: true,
    currency: "NOK",
    option: { active: true, amountMinor: 4900, readyInHours: 2, instructions: "Ask at the counter.", instructionsT: { en: "Ask at the counter." } },
    ...change,
  });

  it("lists every place with its switch, price, ready time and instructions, and refuses a country the store does not sell to", () => {
    const { text, html } = draw(
      h(PickupView, {
        places: [place({}), place({ locationId: "x", name: "Lager Göteborg", country: "SE", sellsThere: false, currency: null, option: null })],
        companyHref: "/c",
        canWrite: true,
        save: () => action,
      }),
    );
    expect(text).toContain("Shop Oslo");
    expect(text).toContain("Offered at checkout");
    expect(text).toContain("Store · Storgata 1, 0155 Oslo, NO");
    expect(html).toContain('value="49"');
    expect(html).toContain("Ask at the counter.");
    expect(text).toContain("1 translation is kept;");
    expect(text).toContain("SE is not a country you sell to, so customers cannot collect here.");
    const none = draw(h(PickupView, { places: [], companyHref: "/c", canWrite: true, save: () => action }));
    expect(none.text).toContain("Add a store or a pickup point under Company");
  });

  it("free pickup shows an empty price, read as free", () => {
    const { html } = draw(h(PickupView, { places: [place({ option: { active: false, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} } })], companyHref: "/c", canWrite: true, save: () => action }));
    expect(html).toContain('placeholder="Free"');
    expect(html).toContain("Not offered");
  });

  it("lists areas with where they reach, their price, minimum and free-above, the radius's limit and the data's attribution", () => {
    const area = (change: Partial<LocalAreaItem>): LocalAreaItem => ({
      id: "a1",
      marketCode: "NO",
      currency: "NOK",
      name: "Oslo centre",
      kind: "postal",
      patterns: ["01*", "02*"],
      locationId: null,
      radiusKm: null,
      amountMinor: 9900,
      minBasketMinor: 30000,
      freeOverMinor: 100000,
      info: "Tuesdays and Fridays.",
      active: true,
      placeName: null,
      included: null,
      ...change,
    });
    const { text, html } = draw(
      h(LocalView, {
        markets: [{ code: "NO", name: "Norway", currency: "NOK" }],
        areas: [area({}), area({ id: "a2", name: "Around the shop", kind: "radius", patterns: [], locationId: PLACE, radiusKm: 7.5, amountMinor: 0, minBasketMinor: null, freeOverMinor: null, active: false, placeName: "Shop Oslo", included: 120 })],
        places: [{ id: PLACE, name: "Shop Oslo", country: "NO", hasPosition: true }],
        radiusCountries: ["NO"],
        canWrite: true,
        save: () => action,
        remove: () => action,
        check: action,
      }),
    );
    expect(text).toContain("Norway · 2 postal codes and prefixes · NOK 99.00, from a basket of NOK 300.00, free from NOK 1,000.00");
    expect(text).toContain("Within 7,5 km of Shop Oslo, 120 postal codes · free");
    expect(text).toContain("Off");
    expect(text).toContain("Distances are measured between postal-code centres");
    expect(text).toContain(GEONAMES_ATTRIBUTION);
    expect(text).toContain("Add an area");
    expect(html).toContain("Tuesdays and Fridays.");
    expect(html).toContain('checked="" value="radius"');
  });

  it("offers postal-code areas only where no postal-code positions are loaded, and states no radius limit then", () => {
    const { text, html } = draw(
      h(LocalView, { markets: [{ code: "DE", name: "Germany", currency: "EUR" }], areas: [], places: [], radiusCountries: [], canWrite: true, save: () => action, remove: () => action, check: action }),
    );
    expect(text).toContain("No areas yet");
    expect(text).toContain("not for this country: no postal-code positions are loaded");
    expect(html).toMatch(/disabled=""[^>]*value="radius"/);
    expect(text).not.toContain(GEONAMES_ATTRIBUTION);
  });
});
