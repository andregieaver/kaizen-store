import { describe, expect, it } from "vitest";

import { levelClashes, storeClashes, type NavEntry } from "./nav-labels";

const store = (label: string, page: string): NavEntry => ({ label, level: "store", page });
const platform = (label: string, page: string): NavEntry => ({ label, level: "platform", page });

/** A language that says two English names alike, as Norwegian says Plans and Subscriptions. */
const NB: Record<string, string> = { Plans: "Abonnementer", Subscriptions: "Abonnementer", Reports: "Rapporter", Requests: "Forespørsler" };
const nb = (label: string) => NB[label] ?? label;

describe("one word per thing in the menus (ecosystem plan E3.7, D718)", () => {
  it("finds two places of a store's menu with one name, whatever its case", () => {
    expect(storeClashes([store("Reports", "/analytics/reports"), store("reports", "/support/reports"), store("Inbox", "/support")])).toEqual([
      "«reports»: /analytics/reports, /support/reports",
    ]);
  });

  it("lets a section's tab and its main page share a name: they open the same page", () => {
    expect(storeClashes([store("Orders", "/orders"), store("Orders", "/orders"), store("Order settings", "/settings/orders")])).toEqual([]);
  });

  it("reads the names in the language given, so two English names said alike are a clash", () => {
    const entries = [store("Subscriptions", "/subscriptions"), store("Plans", "/plans")];
    expect(storeClashes(entries)).toEqual([]);
    expect(storeClashes(entries, nb)).toEqual(["«abonnementer»: /subscriptions, /plans"]);
  });

  it("finds a name of another level that a store uses for something else", () => {
    const { clashes, used } = levelClashes([store("Requests", "/support/requests")], [platform("Requests", "/requests")], []);
    expect(clashes).toEqual(["«requests»: platform /requests (Requests) and store /support/requests (Requests)"]);
    expect(used.size).toBe(0);
  });

  it("lets a name through that is listed as the same thing, and says which listing let it", () => {
    const same = [
      { labels: ["Pages"], why: "the level's own pages" },
      { labels: ["Plans", "Subscriptions"], why: "what that level's customers subscribe to" },
      { labels: ["Unused"], why: "nothing" },
    ];
    const mine = [store("Pages", "/pages"), store("Subscriptions", "/subscriptions")];
    const theirs = [platform("Pages", "/pages"), platform("Plans", "/plans")];
    expect(levelClashes(mine, theirs, same).clashes).toEqual([]);
    expect([...levelClashes(mine, theirs, same).used]).toEqual([0]);
    // In Norwegian Plans and Subscriptions are one word, and the pair is listed.
    const read = levelClashes(mine, theirs, same, nb);
    expect(read.clashes).toEqual([]);
    expect([...read.used].sort()).toEqual([0, 1]);
  });

  it("never lets a pair through that is listed under one of its names only", () => {
    const same = [{ labels: ["Plans"], why: "" }];
    expect(levelClashes([store("Subscriptions", "/subscriptions")], [platform("Plans", "/plans")], same, nb).clashes).toEqual([
      "«abonnementer»: platform /plans (Plans) and store /subscriptions (Subscriptions)",
    ]);
  });
});
