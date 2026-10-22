import { describe, expect, it } from "vitest";

import { OWNER_TOOLS } from "./owner-tools";
import {
  GATED_WHEN_OPEN,
  SETUP_TOOLS,
  countriesSummary,
  currenciesOver,
  currenciesSummary,
  detailsOver,
  detailsSummary,
  flatRatesOver,
  flatShippingSummary,
  languagesOver,
  methodOver,
  methodSummary,
  openSummary,
  resolveLocale,
  setStoreDetailsInput,
  setupStatus,
  type MethodNow,
  type SetupFacts,
} from "./setup-tools";

const OFFERED = [
  { lang: "en", locales: ["en-GB", "en-IE"] },
  { lang: "nb", locales: ["nb-NO"] },
  { lang: "sv", locales: ["sv-SE", "sv-FI"] },
];
const NOW = { name: "Fjord", legalName: "Fjord AS", organisationNumber: "123", contactEmail: "hei@fjord.no", postalAddress: "Storgata 1, Oslo", country: "NO" };
const names = (code: string) => ({ NO: "Norway", SE: "Sweden", DK: "Denmark" })[code] ?? code;
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

describe("the setup tools' arguments and registry", () => {
  it("are every one a gated owner tool, waiting for a yes once the store is open (opening always)", () => {
    for (const name of SETUP_TOOLS) expect(OWNER_TOOLS.find((t) => t.name === name), name).toMatchObject({ gate: "public" });
    expect(GATED_WHEN_OPEN.has("open_store")).toBe(false);
    expect([...GATED_WHEN_OPEN].every((name) => SETUP_TOOLS.has(name))).toBe(true);
  });

  it("refuses a details call that changes nothing", () => {
    expect(setStoreDetailsInput.safeParse({}).success).toBe(false);
    expect(setStoreDetailsInput.safeParse({ contact_email: "a@b.no" }).success).toBe(true);
  });
});

describe("details", () => {
  it("lays what is given over what the store has, null taking the organisation number away", () => {
    expect(detailsOver(NOW, { contact_email: "post@fjord.no", country: "se" })).toEqual({ ...NOW, contactEmail: "post@fjord.no", country: "SE" });
    expect(detailsOver(NOW, { organisation_number: null }).organisationNumber).toBe("");
    const empty = { name: "New", legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: null };
    expect(detailsOver(empty, { legal_name: "Ny AS" })).toEqual({ name: "New", legalName: "Ny AS", organisationNumber: "", contactEmail: "", postalAddress: "", country: "" });
  });

  it("says what changes, and that nothing does", () => {
    expect(detailsSummary(NOW, { ...NOW, contactEmail: "post@fjord.no", organisationNumber: null })).toBe(
      'Change the store\'s details: take away the organisation number, the contact email to "post@fjord.no".',
    );
    expect(detailsSummary(NOW, { ...NOW })).toBe("Keep the store's details as they are.");
  });
});

describe("countries", () => {
  it("names the countries sold in, those added and those no longer offered", () => {
    expect(countriesSummary(["NO", "DK"], ["NO", "SE"], names)).toBe("Sell in Norway and Sweden: add Sweden, stop offering Denmark (its prices and settings are kept).");
    expect(countriesSummary(["NO"], ["NO"], names)).toBe("Sell in Norway.");
  });
});

describe("languages", () => {
  it("reads a language as the platform's locale, preferring the variant the store has", () => {
    expect(resolveLocale("nb-no", OFFERED, [])).toBe("nb-NO");
    expect(resolveLocale("en", OFFERED, [])).toBe("en-GB");
    expect(resolveLocale("en", OFFERED, ["en-IE"])).toBe("en-IE");
    expect(resolveLocale("sv-FI", OFFERED, ["sv-SE"])).toBe("sv-FI");
    expect(resolveLocale("xx", OFFERED, [])).toBeNull();
  });

  it("moves the main language to the front and keeps one variant of each language", () => {
    expect(languagesOver(["nb-NO", "sv-SE"], "en-GB", null)).toEqual(["en-GB", "nb-NO", "sv-SE"]);
    expect(languagesOver(["nb-NO", "sv-SE"], null, [])).toEqual(["nb-NO"]);
    expect(languagesOver(["nb-NO", "en-GB"], "en-IE", ["nb-NO", "en-GB", "sv-FI"])).toEqual(["en-IE", "nb-NO", "sv-FI"]);
  });
});

describe("currencies", () => {
  const current = [
    { currency: "NOK", rate: 11.6, roundTo: 1 },
    { currency: "DKK", rate: 7.46, roundTo: 100 },
  ];
  const natives = new Set(["NOK"]);

  it("adds, changes and takes away, never a country's own, and words rounding in the currency's minor units", () => {
    const { rows, problems } = currenciesOver(current, { add: [{ currency: "eur", round_to: 0.1 }, { currency: "SEK", rate: 11.5 }], remove: ["DKK"] }, natives, false);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { currency: "NOK", rate: 11.6, roundTo: 1 },
      { currency: "EUR", rate: 1, roundTo: 10 },
      { currency: "SEK", rate: 11.5, roundTo: 1 },
    ]);
    expect(currenciesSummary(["NOK", "DKK"], rows, false)).toBe("Offer NOK at 11.6 per euro, EUR and SEK at 11.5 per euro; stop offering DKK.");
    expect(currenciesOver(current, { remove: ["NOK"] }, natives, false).problems).toEqual(["NOK is a country's own currency, which its prices are in, so it stays."]);
    expect(currenciesOver(current, { add: [{ currency: "XYZ" }] }, natives, false).problems[0]).toContain("XYZ is not a currency stores can offer");
  });

  it("asks a rate for a currency added without one, unless the rates follow the ECB's", () => {
    expect(currenciesOver(current, { add: [{ currency: "SEK" }] }, natives, false).problems).toEqual(["SEK needs a rate to be shown to shoppers, or let the rates follow the ECB's."]);
    expect(currenciesOver(current, { add: [{ currency: "SEK" }] }, natives, true).problems).toEqual([]);
  });
});

describe("flat-rate shipping", () => {
  const markets = [
    { code: "NO", name: "Norway", currency: "NOK" },
    { code: "SE", name: "Sweden", currency: "SEK" },
  ];
  const now = [{ marketCode: "NO", amountMinor: 4900, freeOverMinor: 50000 }];

  it("reads amounts in each country's own currency, keeping a free-over left out and taking one given as null away", () => {
    expect(flatRatesOver(now, { rates: [{ country: "no", price: "79" }] }, markets).rates).toEqual([{ marketCode: "NO", amountMinor: 7900, freeOverMinor: 50000 }]);
    expect(flatRatesOver(now, { rates: [{ country: "NO", price: "79", free_over: null }] }, markets).rates[0].freeOverMinor).toBeNull();
    const both = flatRatesOver(now, { rates: [{ country: "SE", price: "69,50", free_over: "800" }] }, markets).rates;
    expect(both).toEqual([{ marketCode: "SE", amountMinor: 6950, freeOverMinor: 80000 }]);
    expect(flatShippingSummary(both, markets, money)).toBe("Charge shipping of SEK 69.50 in Sweden (free over SEK 800.00).");
  });

  it("refuses a country the store does not sell to and an amount it cannot read", () => {
    expect(flatRatesOver(now, { rates: [{ country: "DK", price: "10" }] }, markets).problems[0]).toContain("The store does not sell to DK");
    expect(flatRatesOver(now, { rates: [{ country: "NO", price: "ten" }] }, markets).problems).toEqual(['Norway: "ten" is not an amount in NOK.']);
    expect(flatRatesOver(now, { rates: [{ country: "NO", price: "10", free_over: "0" }] }, markets).problems).toEqual(['Norway: "0" is not an amount in NOK.']);
  });
});

describe("shipping methods", () => {
  const facts = { currency: "NOK", zones: [{ id: "00000000-0000-4000-8000-000000000001", name: "Oslo" }], profiles: [{ id: "00000000-0000-4000-8000-000000000002", name: "Bulky" }] };
  const existing: MethodNow = {
    id: "00000000-0000-4000-8000-000000000009",
    marketCode: "NO",
    name: "Home",
    names: { en: "Home" },
    estimate: { min: 1, max: 3 },
    freeOverMinor: null,
    active: true,
    rates: [
      { zoneId: null, profileId: null, basis: "weight", minValue: 0, maxValue: 5000, amountMinor: 9900 },
      { zoneId: null, profileId: null, basis: "weight", minValue: 5000, maxValue: null, amountMinor: 14900 },
    ],
  };

  it("needs a name and prices for a new method", () => {
    expect(methodOver(null, { country: "NO", rates: [{ tiers: [] }] }, facts)).toEqual({ ok: false, problem: "A new method needs a name, such as Home delivery." });
    expect(methodOver(null, { country: "NO", name: "Home" }, facts)).toEqual({ ok: false, problem: "A new method needs its prices (rates)." });
  });

  it("turns zones and profiles named into ids and tiers into the editor's minor units and grams", () => {
    const made = methodOver(
      null,
      {
        country: "no",
        name: "Express",
        rates: [
          { zone: "oslo", profile: "General", tiers: [{ by: "flat", price: "149" }] },
          { profile: "Bulky", tiers: [{ by: "value", price: "199" , up_to: "1000" }, { by: "value", from: "1000", price: "0" }] },
        ],
      },
      facts,
    );
    expect(made).toEqual({
      ok: true,
      input: {
        id: null,
        marketCode: "NO",
        name: "Express",
        names: {},
        estimate: null,
        freeOverMinor: null,
        active: true,
        groups: [
          { zoneId: facts.zones[0].id, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 14900 }] },
          {
            zoneId: null,
            profileId: facts.profiles[0].id,
            tiers: [
              { basis: "value", minValue: 0, maxValue: 100000, amountMinor: 19900 },
              { basis: "value", minValue: 100000, maxValue: null, amountMinor: 0 },
            ],
          },
        ],
      },
    });
    expect(methodOver(null, { country: "NO", name: "X", rates: [{ zone: "Bergen", tiers: [] }] }, facts)).toEqual({
      ok: false,
      problem: 'No shipping zone "Bergen" in NO: shipping_overview lists them.',
    });
  });

  it("keeps an existing method's prices, names and times where the change says nothing of them", () => {
    const changed = methodOver(existing, { country: "NO", free_over: "1500", names: { sv: "Hem" } }, facts);
    expect(changed.ok && changed.input).toMatchObject({
      id: existing.id,
      name: "Home",
      names: { en: "Home", sv: "Hem" },
      estimate: { min: 1, max: 3 },
      freeOverMinor: 150000,
      groups: [{ zoneId: null, profileId: null, tiers: existing.rates.map(({ basis, minValue, maxValue, amountMinor }) => ({ basis, minValue, maxValue, amountMinor })) }],
    });
    expect(methodOver(existing, { country: "NO", rates: [{ tiers: [{ by: "weight", from: "a lot", price: "1" }] }] }, facts)).toEqual({
      ok: false,
      problem: "A weight tier's from and up to are whole grams.",
    });
  });

  it("says what the method will be", () => {
    const input = { name: "Home", active: true, freeOverMinor: 150000, estimate: { min: 1, max: 3 }, groups: [{ tiers: [{ basis: "flat", amountMinor: 7900 }] }] };
    expect(methodSummary(true, input, "Norway", "NOK", money)).toBe('Make the shipping method "Home" in Norway: NOK 79.00, free over NOK 1500.00, 1–3 days.');
    expect(methodSummary(false, { ...input, active: false, groups: [{ tiers: [] }, { tiers: [{ basis: "weight", amountMinor: 1 }, { basis: "weight", amountMinor: 2 }] }] }, "Norway", "NOK", money)).toBe(
      'Change the shipping method "Home" in Norway: 1 block of prices, free over NOK 1500.00, 1–3 days, not offered at checkout.',
    );
  });
});

describe("the setup's steps", () => {
  const done = { features: false, details: false, countries: true, bookings: true, shipping: true, payments: false, paymentsOn: false, products: true, plan: false, readyToOpen: false };
  const facts: SetupFacts = { done, open: false, selling: true, booked: false, pendingDomains: [], carriers: 0 };
  const path = (page: string) => `/admin/fjord${page}`;

  it("lists the steps in the wizard's order with the tool for each, or the one thing only the owner can do", () => {
    const status = setupStatus(facts, path);
    expect(status.steps.map((s) => s.step)).toEqual([
      "What the store will sell (Settings, Features)",
      "Business details",
      "Countries to sell to",
      "Shipping price for every country",
      "Payments account (Stripe or Mollie)",
      "Payments switched on",
      "Own products (not only the demo ones)",
      "A Kaizena Flow plan",
      "Open the store",
    ]);
    // The features question is optional, so the next step is the details, done with a tool.
    expect(status.next).toMatchObject({ step: "Business details", tools: ["set_store_details"], page: "/admin/fjord/settings/company" });
    expect(status.owner_only.map((o) => o.what)).toEqual(["Payments account (Stripe or Mollie)", "Payments switched on", "A Kaizena Flow plan", "A carrier at checkout (optional)"]);
    expect(status.owner_only[0]).toMatchObject({ page: "/admin/fjord/settings/payments", do: expect.stringContaining("only you can") });
  });

  it("leaves a website's shop out, asks for bookable staff while bookings are on, and names a domain waiting for its records", () => {
    const website = setupStatus({ ...facts, selling: false, booked: true, pendingDomains: ["fjord.no"] }, path);
    expect(website.steps.map((s) => s.step)).toEqual([
      "What the store will sell (Settings, Features)",
      "Business details",
      "The website's country",
      "Staff, rooms or items to book",
      "A Kaizena Flow plan",
      "Open the store",
    ]);
    expect(website.owner_only.map((o) => o.what)).toEqual(["A Kaizena Flow plan", "The domain fjord.no"]);
  });

  it("drops the features question once open and says that changes now wait for a yes", () => {
    const open = setupStatus({ ...facts, open: true, done: { ...done, details: true, readyToOpen: true } }, path);
    expect(open.steps[0].step).toBe("Business details");
    expect(open.steps.at(-1)).toMatchObject({ step: "Open the store", done: true });
    expect(open.note).toContain("waits for the owner's yes");
  });

  it("says what opening does, and that a shop takes no payment until payments are on", () => {
    expect(openSummary("Fjord", { selling: true, paymentsOn: false })).toBe(
      "Open Fjord to shoppers: its pages become public, search engines may list it, and it takes no payment until payments are switched on.",
    );
    expect(openSummary("Fjord", { selling: true, paymentsOn: true })).toBe("Open Fjord to shoppers: its pages become public, search engines may list it and it takes orders.");
    expect(openSummary("Fjord", { selling: false, paymentsOn: false })).toBe("Open Fjord: its website becomes public and search engines may list it.");
  });
});
