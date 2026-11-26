import { describe, expect, it } from "vitest";

import {
  AUTO_QUIET_DAYS,
  BEACON_FADES_AFTER,
  SPOTLIGHT_GAP_MS,
  applyGuideEvent,
  beaconKey,
  effectiveLevel,
  guideEventOf,
  guideMoment,
  guidePlaces,
  guideProgressOf,
  guideSettingsOf,
  guideTally,
  kindOn,
  newGuideProgress,
  placeAt,
  type GuideProgress,
  type GuideSettings,
  type GuideSignals,
} from "./guide";

const NOW = Date.parse("2026-11-26T10:00:00Z");
const START = new Date(NOW).toISOString();
const HOME = "/admin/shop";

const places = guidePlaces({
  home: HOME,
  sections: [
    { key: "orders", href: "/admin/shop/orders", label: "Orders", within: ["/admin/shop/orders", "/admin/shop/returns"], also: ["Returns"] },
    { key: "products", href: "/admin/shop/products", label: "Products", within: ["/admin/shop/products"], also: ["Gift cards", "Reviews", "Inventory", "More"] },
    { key: "analytics", href: "/admin/shop/analytics", label: "Analytics", within: ["/admin/shop/analytics"], also: [], fallback: "How the store does." },
    { key: "settings", href: "/admin/shop/settings", label: "Settings", exact: true, within: ["/admin/shop/settings/payments"], also: [] },
  ],
  words: {
    welcome: { rail: { label: "The rail", what: "Every section" }, todo: { label: "To-do", what: "What is left" }, ai: { label: "AI manager", what: "Ask" } },
    places: { orders: "Pack and send", products: "What you sell", settings: "How it is set up" },
  },
  core: ["orders", "products", "settings"],
});

const fresh = (): GuideProgress => newGuideProgress(START);
const balanced: GuideSettings = { level: null, off: [] };
const calm = (path: string, extra: Partial<GuideSignals> = {}): GuideSignals => ({ path, calm: true, phone: false, now: NOW, ...extra });

describe("the places", () => {
  it("starts with the welcome's three, then each section in the menu's order, with its line or the menu's", () => {
    expect(places.map((p) => p.key)).toEqual(["rail", "todo", "ai", "orders", "products", "analytics", "settings"]);
    expect(places.find((p) => p.key === "analytics")?.what).toBe("How the store does.");
    expect(places.find((p) => p.key === "products")?.also).toEqual(["Gift cards", "Reviews", "Inventory"]);
    expect(places.find((p) => p.key === "orders")?.core).toBe(true);
    expect(places.find((p) => p.key === "analytics")?.core).toBeUndefined();
  });

  it("finds the section a page is in, the deepest address winning, and a page of cards on its own address only", () => {
    expect(placeAt(places, "/admin/shop/returns/abc")?.key).toBe("orders");
    expect(placeAt(places, "/admin/shop/products")?.key).toBe("products");
    expect(placeAt(places, "/admin/shop/settings")?.key).toBe("settings");
    expect(placeAt(places, "/admin/shop/settings/payments")?.key).toBe("settings");
    expect(placeAt(places, "/admin/shop/settings/tax")).toBeUndefined();
    expect(placeAt(places, HOME)).toBeUndefined();
    expect(placeAt(places, "/admin/shop/productsx")).toBeUndefined();
  });
});

describe("the pace", () => {
  it("welcomes on Home once the page is calm, never before", () => {
    expect(guideMoment(places, HOME, balanced, fresh(), calm(HOME), null)).toEqual({ kind: "spotlight", key: "welcome", steps: ["rail", "todo", "ai"] });
    expect(guideMoment(places, HOME, balanced, fresh(), calm(HOME, { calm: false }), null)).toBeNull();
  });

  it("keeps to one spotlight a day: the welcome waits a day after another spotlight, but Hands-on does not", () => {
    const shown = applyGuideEvent(fresh(), { type: "spotlight", moment: "welcome" }, START);
    expect(guideMoment(places, HOME, balanced, shown, calm(HOME), null)).toBeNull();
    expect(guideMoment(places, HOME, balanced, shown, calm(HOME, { now: NOW + SPOTLIGHT_GAP_MS }), null)?.kind).toBe("spotlight");
    expect(guideMoment(places, HOME, { level: "handson", off: [] }, shown, calm(HOME), null)?.kind).toBe("spotlight");
  });

  it("welcomes once: done or put away, it does not come back by itself", () => {
    const done = applyGuideEvent(fresh(), { type: "done", moment: "welcome" }, START);
    expect(guideMoment(places, HOME, balanced, done, calm(HOME), null)).toBeNull();
    const later = applyGuideEvent(fresh(), { type: "later", moment: "welcome", kind: "spotlight" }, START);
    expect(guideMoment(places, HOME, balanced, later, calm(HOME), null)).toBeNull();
  });

  it("puts a beacon on a core section's first visits, and fades it after three visits not pressed", () => {
    let p = fresh();
    for (let visit = 0; visit < BEACON_FADES_AFTER; visit++) {
      expect(guideMoment(places, HOME, balanced, p, calm("/admin/shop/products/new"), null)).toEqual({ kind: "beacon", key: "beacon:products", place: "products", open: false });
      p = applyGuideEvent(p, { type: "seen", moment: beaconKey("products") }, START);
    }
    expect(guideMoment(places, HOME, balanced, p, calm("/admin/shop/products"), null)).toBeNull();
  });

  it("leaves the other sections for Hands-on", () => {
    expect(guideMoment(places, HOME, balanced, fresh(), calm("/admin/shop/analytics"), null)).toBeNull();
    expect(guideMoment(places, HOME, { level: "handson", off: [] }, fresh(), calm("/admin/shop/analytics"), null)?.kind).toBe("beacon");
  });

  it("stops a kind after two Laters", () => {
    let p = applyGuideEvent(fresh(), { type: "later", moment: beaconKey("orders"), kind: "beacon" }, START);
    expect(kindOn("beacon", balanced, p, NOW)).toBe(true);
    p = applyGuideEvent(p, { type: "later", moment: beaconKey("settings"), kind: "beacon" }, START);
    expect(kindOn("beacon", balanced, p, NOW)).toBe(false);
    expect(guideMoment(places, HOME, balanced, p, calm("/admin/shop/products"), null)).toBeNull();
    expect(kindOn("spotlight", balanced, p, NOW)).toBe(true);
  });

  it("says nothing loud in Quiet, with a kind switched off, or on a phone; hints stay", () => {
    expect(guideMoment(places, HOME, { level: "quiet", off: [] }, fresh(), calm(HOME), null)).toBeNull();
    expect(guideMoment(places, HOME, { level: null, off: ["spotlight"] }, fresh(), calm(HOME), null)).toBeNull();
    expect(guideMoment(places, HOME, balanced, fresh(), calm(HOME, { phone: true }), null)).toBeNull();
    expect(kindOn("hint", { level: "quiet", off: [] }, fresh(), NOW)).toBe(true);
    expect(kindOn("hint", { level: null, off: ["hint"] }, fresh(), NOW)).toBe(false);
  });

  it("turns itself to Quiet after two weeks unless a level was chosen", () => {
    const later = NOW + AUTO_QUIET_DAYS * 24 * 60 * 60 * 1000;
    expect(effectiveLevel(balanced, fresh(), NOW)).toBe("balanced");
    expect(effectiveLevel(balanced, fresh(), later)).toBe("quiet");
    expect(effectiveLevel({ level: "balanced", off: [] }, fresh(), later)).toBe("balanced");
  });

  it("shows what was asked for from the panel on arrival, whatever the budget, Laters or level", () => {
    let p = applyGuideEvent(fresh(), { type: "done", moment: "welcome" }, START);
    p = applyGuideEvent(p, { type: "later", moment: "x", kind: "beacon" }, START);
    p = applyGuideEvent(p, { type: "later", moment: "y", kind: "beacon" }, START);
    const quiet: GuideSettings = { level: "quiet", off: ["beacon", "spotlight"] };
    expect(guideMoment(places, HOME, quiet, p, calm(HOME), { place: "todo" })).toEqual({ kind: "spotlight", key: "welcome", steps: ["todo"] });
    expect(guideMoment(places, HOME, quiet, p, calm("/admin/shop/analytics"), { place: "analytics" })).toEqual({ kind: "beacon", key: "beacon:analytics", place: "analytics", open: true });
    expect(guideMoment(places, HOME, quiet, p, calm(HOME), { place: "welcome" })).toEqual({ kind: "spotlight", key: "welcome", steps: ["rail", "todo", "ai"] });
    // On the way there, nothing else is shown: not even the beacon of the page being left.
    expect(guideMoment(places, HOME, balanced, fresh(), calm("/admin/shop/orders"), { place: "products" })).toBeNull();
    // Not there yet: nothing, until the person arrives.
    expect(guideMoment(places, HOME, quiet, p, calm("/admin/shop/orders"), { place: "analytics" })).toBeNull();
    // Still never while the person is busy.
    expect(guideMoment(places, HOME, quiet, p, calm(HOME, { calm: false }), { place: "todo" })).toBeNull();
  });
});

describe("a Home without every welcome step", () => {
  it("lists and welcomes only the steps that person's Home has", () => {
    const staff = guidePlaces({ home: HOME, sections: [], words: { welcome: { rail: { label: "R", what: "" }, todo: { label: "T", what: "" }, ai: { label: "A", what: "" } }, places: {} }, core: [], welcome: ["rail", "todo"] });
    expect(staff.map((p) => p.key)).toEqual(["rail", "todo"]);
    expect(guideMoment(staff, HOME, balanced, fresh(), calm(HOME), null)).toEqual({ kind: "spotlight", key: "welcome", steps: ["rail", "todo"] });
  });
});

describe("the record", () => {
  it("counts the places found and names the first left", () => {
    let p = applyGuideEvent(fresh(), { type: "found", place: "rail" }, START);
    p = applyGuideEvent(p, { type: "found", place: "rail" }, START);
    p = applyGuideEvent(p, { type: "found", place: "todo" }, START);
    const tally = guideTally(places, p);
    expect(tally).toMatchObject({ found: 2, total: 7 });
    expect(tally.next?.key).toBe("ai");
  });

  it("replays a moment and starts over", () => {
    let p = applyGuideEvent(fresh(), { type: "done", moment: "welcome" }, START);
    p = applyGuideEvent(p, { type: "replay", moment: "welcome" }, START);
    expect(p.moments.welcome).toEqual({});
    p = applyGuideEvent(p, { type: "found", place: "rail" }, START);
    const later = "2026-12-01T00:00:00.000Z";
    expect(applyGuideEvent(p, { type: "restart" }, later)).toEqual(newGuideProgress(later));
  });

  it("reads a stored value back, dropping what it does not know", () => {
    const stored = {
      startedAt: "2026-11-20T08:00:00Z",
      found: ["rail", "rail", "Not a key", 4],
      moments: { welcome: { done: true, seen: 2, extra: 1 }, "<b>": { done: true }, "beacon:orders": { seen: -1 } },
      later: { beacon: 1, hint: 5 },
      lastSpotlightAt: "nonsense",
      other: true,
    };
    expect(guideProgressOf(stored, START)).toEqual({
      startedAt: "2026-11-20T08:00:00.000Z",
      found: ["rail"],
      moments: { welcome: { done: true, seen: 2 }, "beacon:orders": {} },
      later: { beacon: 1 },
      lastSpotlightAt: null,
    });
    expect(guideProgressOf(null, START)).toEqual(newGuideProgress(START));
    expect(guideProgressOf([1, 2], START)).toEqual(newGuideProgress(START));
  });

  it("accepts only events it knows", () => {
    expect(guideEventOf({ type: "found", place: "orders" })).toEqual({ type: "found", place: "orders" });
    expect(guideEventOf({ type: "later", moment: "welcome", kind: "spotlight" })).toEqual({ type: "later", moment: "welcome", kind: "spotlight" });
    expect(guideEventOf({ type: "later", moment: "welcome", kind: "hint" })).toBeNull();
    expect(guideEventOf({ type: "found", place: "x".repeat(60) })).toBeNull();
    expect(guideEventOf({ type: "drop" })).toBeNull();
    expect(guideEventOf("restart")).toBeNull();
    expect(guideEventOf({ type: "restart", extra: 1 })).toEqual({ type: "restart" });
  });

  it("reads the settings, keeping only known levels and kinds", () => {
    expect(guideSettingsOf("handson", ["beacon", "loud", "hint"])).toEqual({ level: "handson", off: ["beacon", "hint"] });
    expect(guideSettingsOf(null, null)).toEqual({ level: null, off: [] });
    expect(guideSettingsOf("loud", "beacon")).toEqual({ level: null, off: [] });
  });
});
