import { describe, expect, it } from "vitest";

import { TOOL_FEATURES, toolFeatureRefusal, toolOffered } from "./owner-tool-features";
import { OWNER_TOOLS_BY_NAME } from "./owner-tools";
import {
  COUNTED_FEATURES,
  FEATURE_GROUPS,
  FEATURE_IDS,
  FEATURES_BY_ID,
  NO_FACTS,
  STORE_FEATURES,
  dependentsOf,
  effectiveFeatures,
  featureBlockers,
  featureCount,
  featureInUse,
  featureKept,
  featureOn,
  featureRows,
  featureWarnings,
  featuresIn,
  isFeatureId,
  missingNeeds,
  normaliseFeatures,
  requirementLabel,
  requirementMet,
} from "./store-features";

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

describe("the store features registry (D178)", () => {
  it("lists each feature once, in a group or as the shop's master switch", () => {
    expect(STORE_FEATURES.map((f) => f.id)).toEqual([...FEATURE_IDS]);
    expect(STORE_FEATURES.filter((f) => f.group === null).map((f) => f.id)).toEqual(["shop"]);
    for (const group of FEATURE_GROUPS) expect(featuresIn(group.id).length, group.id).toBeGreaterThan(0);
    expect(COUNTED_FEATURES).toHaveLength(10);
    expect(isFeatureId("bonus")).toBe(true);
    expect(isFeatureId("work")).toBe(false);
  });

  it("has needs that are features, never itself, and transitively complete (the database checks one level)", () => {
    for (const f of STORE_FEATURES) {
      expect(f.needs).not.toContain(f.id);
      for (const need of f.needs) {
        expect(FEATURE_IDS).toContain(need);
        for (const further of FEATURES_BY_ID[need].needs) expect(f.needs, `${f.id} needs ${need}, which needs ${further}`).toContain(further);
      }
    }
  });

  it("puts the selling and customer features behind the shop, and countries and languages not", () => {
    for (const f of [...featuresIn("selling"), ...featuresIn("customers")]) expect(f.needs, f.id).toContain("shop");
    expect(FEATURES_BY_ID.countries.needs).toEqual([]);
    expect(FEATURES_BY_ID.languages.needs).toEqual([]);
    expect(FEATURES_BY_ID.currencies.needs).toEqual(["shop"]);
    expect(FEATURES_BY_ID.referrals.needs).toEqual(["shop", "bonus"]);
  });

  it("is on only when kept with everything it needs, and remembers its switch while the shop is off", () => {
    expect(featureOn(["shop", "bonus"], "bonus")).toBe(true);
    expect(featureOn(["bonus"], "bonus")).toBe(false);
    expect(featureKept(["bonus"], "bonus")).toBe(true);
    expect(featureOn(["shop", "referrals"], "referrals")).toBe(false);
    expect(featureOn({ features: ["shop", "bonus", "referrals"] }, "referrals")).toBe(true);
    expect(featureOn(["languages"], "languages")).toBe(true);
    expect(effectiveFeatures(["referrals", "bonus", "countries", "boxes"])).toEqual(["countries"]);
    expect(effectiveFeatures(["referrals", "bonus", "countries", "boxes", "shop"])).toEqual(["shop", "boxes", "countries", "bonus", "referrals"]);
    expect(normaliseFeatures(["bonus", "nope", "shop", "bonus"])).toEqual(["shop", "bonus"]);
    expect(missingNeeds(["shop"], "referrals")).toEqual(["bonus"]);
    expect(missingNeeds([], "referrals")).toEqual(["shop", "bonus"]);
    expect(dependentsOf("bonus")).toEqual(["referrals"]);
  });

  it("meets a requirement of one feature or any of several", () => {
    expect(requirementMet(["shop"], undefined)).toBe(true);
    expect(requirementMet(["shop", "bookings"], ["appointments", "bookings"])).toBe(true);
    expect(requirementMet(["bookings"], ["appointments", "bookings"])).toBe(false);
    expect(requirementLabel(["appointments", "bookings"])).toBe("Appointments or Stays and rentals");
  });

  it("counts the features on of the ten", () => {
    expect(featureCount(["shop"])).toEqual({ on: 0, total: 10 });
    expect(featureCount(["shop", "bonus", "languages"])).toEqual({ on: 2, total: 10 });
    expect(featureCount(["bonus", "languages"])).toEqual({ on: 1, total: 10 });
    expect(featureCount([...FEATURE_IDS])).toEqual({ on: 10, total: 10 });
  });
});

describe("what blocks switching a feature off, and what is confirmed", () => {
  it("blocks where customers would be hit, with the page to deal with it", () => {
    expect(featureBlockers("subscriptions", { ...NO_FACTS, runningSubscriptions: 2 })).toEqual([{ text: expect.stringContaining("2 subscriptions are still running"), path: "/subscriptions" }]);
    expect(featureBlockers("boxes", { ...NO_FACTS, runningBoxes: 1, boxOrdersUnpaid: 3 }).map((b) => b.path)).toEqual(["/deliveries", "/orders"]);
    expect(featureBlockers("appointments", { ...NO_FACTS, futureAppointments: 1, futureStays: 4 })).toHaveLength(1);
    expect(featureBlockers("bookings", { ...NO_FACTS, futureStays: 1, unpaidHostCommissions: 1 }).map((b) => b.path)).toEqual(["/bookings/stays", "/hosts"]);
    expect(featureBlockers("countries", { ...NO_FACTS, foreignSubscriptions: 1, foreignBoxes: 1, runningSubscriptions: 5 })).toHaveLength(2);
    // Goods paid for and still to send to another country block too (D178 step 4); paid orders at home do not.
    expect(featureBlockers("countries", { ...NO_FACTS, foreignUnsent: 2, paidUnshipped: 7 })).toEqual([{ text: expect.stringContaining("2 paid orders have goods still to send to another country"), path: "/orders" }]);
    // Open carts in another country are warned of.
    expect(featureWarnings("countries", { ...NO_FACTS, otherCountries: 2, foreignCarts: 3 }, ["shop", "countries"], () => "")).toEqual([
      expect.stringContaining("2 countries besides your own are no longer offered"),
      expect.stringContaining("3 open carts are in another country"),
    ]);
    const shop = featureBlockers("shop", { ...NO_FACTS, paidUnshipped: 1, runningSubscriptions: 1, runningBoxes: 1, futureAppointments: 1, futureStays: 1 });
    expect(shop.map((b) => b.path)).toEqual(["/orders", "/subscriptions", "/deliveries", "/bookings", "/bookings/stays"]);
    expect(featureBlockers("shop", NO_FACTS)).toEqual([]);
  });

  it("never blocks the bonus or referral program, selling to businesses, currencies or languages: it warns", () => {
    const busy = { ...NO_FACTS, creditHolders: 3, creditsMinor: 12345, creditsCurrency: "NOK", referrers: 2, pendingReferrals: 1, businessCarts: 1, businessProducts: 2, companies: 1, extraCurrencies: 2, otherLanguages: 1 };
    for (const id of ["bonus", "referrals", "business", "currencies", "languages"] as const) {
      expect(featureBlockers(id, busy), id).toEqual([]);
      expect(featureWarnings(id, busy, ["shop", "bonus", "referrals"], money).length, id).toBeGreaterThan(0);
    }
    expect(featureWarnings("bonus", busy, ["shop", "bonus"], money)[0]).toContain("123.45 NOK");
    // The referral program goes to sleep with the bonus program, and is said to.
    expect(featureWarnings("bonus", NO_FACTS, ["shop", "bonus", "referrals"], money)).toEqual([expect.stringContaining("Referral program needs it")]);
    expect(featureWarnings("bonus", NO_FACTS, ["shop", "bonus"], money)).toEqual([]);
    expect(featureWarnings("shop", NO_FACTS, ["shop", "bonus", "countries"], money)).toEqual([expect.stringContaining("Bonus program needs it")]);
  });

  it("knows what is in use", () => {
    expect(featureInUse("subscriptions", NO_FACTS)).toBe(false);
    expect(featureInUse("subscriptions", { ...NO_FACTS, subscriptionProducts: 1 })).toBe(true);
    expect(featureInUse("bookings", { ...NO_FACTS, hosts: 1 })).toBe(true);
    expect(featureInUse("bonus", { ...NO_FACTS, bonusEnabled: true })).toBe(true);
  });

  it("draws rows: blockers and warnings only for what is on, and what is missing in words", () => {
    const rows = featureRows(["bonus", "referrals"], { ...NO_FACTS, runningSubscriptions: 1 }, money);
    expect(rows.bonus).toMatchObject({ kept: true, on: false, missing: ["the online shop"], blockers: [], warnings: [] });
    expect(rows.referrals.missing).toEqual(["the online shop", "the bonus program"]);
    const on = featureRows(["shop", "subscriptions", "referrals"], { ...NO_FACTS, runningSubscriptions: 1 }, money);
    expect(on.subscriptions.blockers).toHaveLength(1);
    expect(on.referrals).toMatchObject({ kept: true, on: false, missing: ["the bonus program"] });
    expect(JSON.parse(JSON.stringify(on))).toEqual(on);
  });
});

describe("the AI manager's tools behind a feature", () => {
  it("names only tools that exist", () => {
    for (const name of Object.keys(TOOL_FEATURES)) expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
  });

  it("offers a tool only while its feature is on", () => {
    expect(toolOffered(["shop"], "get_bonus_program")).toBe(false);
    expect(toolOffered(["shop", "bonus"], "get_bonus_program")).toBe(true);
    expect(toolOffered(["shop", "appointments"], "list_bookings")).toBe(true);
    expect(toolOffered(["shop", "bonus"], "set_affiliate_program")).toBe(false);
    expect(toolOffered(["shop"], "list_orders")).toBe(true);
    expect(toolFeatureRefusal("list_bookings")).toContain("Appointments or Stays and rentals is switched off");
  });
});
