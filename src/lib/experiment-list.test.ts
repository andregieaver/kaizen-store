import { describe, expect, it } from "vitest";

import { groupOf, listLead, testIdeas, type IdeaTarget } from "./experiment-list";
import type { TrafficFacts } from "./experiment-traffic";

const progress = (readyAround: string | null) => ({ progress: { days: 3, minDays: 14, visitors: 100, minVisitors: 200, share: 0.2, reached: false, readyAround } });

describe("groupOf", () => {
  it("asks for a decision once a running test has an answer or a broken split, and always for a stopped one", () => {
    expect(groupOf("running", { state: "answer" })).toBe("decide");
    expect(groupOf("running", { state: "broken" })).toBe("decide");
    expect(groupOf("running", { state: "learning" })).toBe("learning");
    expect(groupOf("stopped", { state: "learning" })).toBe("decide");
    expect(groupOf("draft", { state: "draft" })).toBe("planned");
    expect(groupOf("scheduled", { state: "scheduled" })).toBe("planned");
    expect(groupOf("applied", { state: "applied" })).toBe("done");
    expect(groupOf("discarded", { state: "discarded" })).toBe("done");
  });
});

describe("listLead", () => {
  it("says first what waits for the owner", () => {
    expect(listLead([{ group: "learning", card: progress("2026-11-30") }, { group: "decide", card: progress(null) }])).toEqual({ kind: "decide", n: 1 });
  });

  it("names the first learning test likely ready", () => {
    expect(listLead([{ group: "learning", card: progress("2026-12-04") }, { group: "learning", card: progress("2026-11-27") }, { group: "learning", card: progress(null) }])).toEqual({
      kind: "learning",
      n: 3,
      readyAround: "2026-11-27",
    });
  });

  it("falls back to drafts, then to finished tests, then to none", () => {
    expect(listLead([{ group: "planned", card: progress(null) }, { group: "done", card: progress(null) }])).toEqual({ kind: "planned", n: 1 });
    expect(listLead([{ group: "done", card: progress(null) }])).toEqual({ kind: "done" });
    expect(listLead([])).toEqual({ kind: "none" });
  });
});

const facts = (targets: TrafficFacts["targets"], counting = true): TrafficFacts => ({
  counting,
  days: 30,
  consentShare: 0.6,
  baselines: { orders: 0.02, cart: 0.09, checkout: 0.04 },
  targets,
});

const targets: IdeaTarget[] = [
  { id: "about", slug: "about", title: "About us", kind: "page", buttons: [] },
  { id: "front", slug: "front", title: "Home", kind: "role", role: "front", buttons: ["Shop the autumn range"] },
  { id: "layout", slug: "layout", title: "Standard product page", kind: "layout", buttons: [] },
  { id: "footer", slug: "footer", title: "Footer", kind: "footer", buttons: [] },
  { id: "cart", slug: "cart", title: "Cart", kind: "role", role: "cart", partOnly: true, buttons: [] },
  { id: "header", slug: "header", title: "Header", kind: "header", buttons: [] },
];

describe("testIdeas", () => {
  it("puts the pages most visitors could take part on first, each with one change to try", () => {
    const ideas = testIdeas({
      targets,
      facts: facts({ about: { visitsPerDay: 20, basis: "landing" }, front: { visitsPerDay: 400, basis: "landing" }, layout: { visitsPerDay: 250, basis: "product_viewers" }, header: { visitsPerDay: 600, basis: "site" } }),
      busy: new Set(),
    });
    expect(ideas.map((i) => [i.targetId, i.change])).toEqual([
      ["header", "header"],
      ["front", "button"],
      ["layout", "layout"],
    ]);
    const front = ideas[1];
    expect(front.button).toBe("Shop the autumn range");
    // 400 visits a day, 60 % accept statistics.
    expect(front.perDay).toBe(240);
    expect(front.weeks).toBeGreaterThanOrEqual(1);
    expect(front.findable).not.toBeNull();
  });

  it("leaves out a page already in a test, a footer and a working page", () => {
    const ideas = testIdeas({ targets, facts: facts({}), busy: new Set(["front"]), limit: 10 });
    expect(ideas.map((i) => i.targetId)).toEqual(["about", "layout", "header"]);
  });

  it("without counted traffic, starts from the front page and gives no weeks", () => {
    const ideas = testIdeas({ targets, facts: facts({}, false), busy: new Set() });
    expect(ideas[0]).toMatchObject({ targetId: "front", perDay: null, weeks: null, findable: null });
    expect(ideas.map((i) => i.targetId)).toEqual(["front", "about", "layout"]);
  });

  it("calls a page without buttons a heading to try", () => {
    expect(testIdeas({ targets: [targets[0]], facts: facts({}), busy: new Set() })[0].change).toBe("heading");
  });
});
