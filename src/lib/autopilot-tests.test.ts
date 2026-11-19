import { describe, expect, it } from "vitest";

import { assistantEn } from "./admin-messages/assistant.en";
import { assistantNb } from "./admin-messages/assistant.nb";
import { staffEmailsEn } from "./admin-messages/staff-emails.en";
import { AUTOPILOT_TEST_MAX_DAYS, chooseTest, daysLeft, guardrailsToClear, testAction, testLine, testState } from "./autopilot-tests";
import type { TrafficFacts } from "./experiment-traffic";
import { experimentsEn } from "@/lib/admin-messages/experiments.en";

/** A store that counts visits, where 60 % accept statistics cookies, 2 % of visits order, 10 % add to the cart and 5 % reach checkout. */
const facts = (visitsPerDay: number | null, counting = true): TrafficFacts => ({
  counting,
  days: 30,
  consentShare: 0.6,
  baselines: { orders: 0.02, cart: 0.1, checkout: 0.05, signup: null },
  targets: { page: { visitsPerDay, basis: "landing" } },
});

const NOW = new Date("2026-11-17T12:00:00Z");

describe("which test the autopilot's change gets (E4.1)", () => {
  it("counts orders where they answer within three weeks, though the cart would answer sooner", () => {
    // 4,000 visits a day: 2,400 could take part, so orders answer in three weeks and the cart in two.
    expect(chooseTest(facts(4000), "page", experimentsEn)).toEqual({ goal: "orders", days: 21 });
  });

  it("counts what answers soonest when orders would take too long", () => {
    // 2,000 visits a day: orders would take six weeks, adding to the cart two.
    expect(chooseTest(facts(2000), "page", experimentsEn)).toEqual({ goal: "cart", days: 14 });
  });

  it("has no test when even the cart would take longer than three weeks, or nothing is counted", () => {
    expect(chooseTest(facts(50), "page", experimentsEn)).toEqual({ none: "too_slow" });
    expect(chooseTest(facts(4000, false), "page", experimentsEn)).toEqual({ none: "not_counted" });
    expect(chooseTest(facts(null), "page", experimentsEn)).toEqual({ none: "not_counted" });
    expect(chooseTest({ ...facts(4000), consentShare: null }, "page", experimentsEn)).toEqual({ none: "not_counted" });
    expect(chooseTest(facts(4000), "another", experimentsEn)).toEqual({ none: "not_counted" });
  });

  it("holds a change back three weeks at most", () => {
    expect(AUTOPILOT_TEST_MAX_DAYS).toBe(21);
    expect(chooseTest(facts(4000), "page", experimentsEn, 14)).toEqual({ goal: "cart", days: 14 });
  });
});

describe("Kaizena Flow's own site: its sign-ups per visit (E5.3, D757)", () => {
  /** Kaizena Flow's own store sells nothing: no order, cart or checkout rate, and one visit in ten ending in a sign-up. */
  const house = (visitsPerDay: number | null): TrafficFacts => ({ ...facts(visitsPerDay), baselines: { orders: null, cart: null, checkout: null, signup: 0.1 } });

  it("tests a change on sign-ups, sized from the site's own sign-up rate", () => {
    // 2,000 visits a day, 1,200 of whom could take part: a change of a fifth in one visit in ten answers in two weeks.
    expect(chooseTest(house(2000), "page", experimentsEn)).toEqual({ goal: "signup", days: 14 });
    expect(chooseTest({ ...house(2000), baselines: { ...house(2000).baselines, signup: 0.02 } }, "page", experimentsEn)).toEqual({ none: "too_slow" });
  });

  it("publishes as before where the site is too quiet, or no sign-up was counted", () => {
    expect(chooseTest(house(50), "page", experimentsEn)).toEqual({ none: "too_slow" });
    expect(chooseTest({ ...house(2000), baselines: { orders: null, cart: null, checkout: null, signup: null } }, "page", experimentsEn)).toEqual({ none: "not_counted" });
    expect(chooseTest({ ...house(2000), counting: false }, "page", experimentsEn)).toEqual({ none: "not_counted" });
  });

  it("needs the speed guardrail cleared before a sign-up test's change goes live, as nothing else watches a site that sells nothing", () => {
    expect(guardrailsToClear("signup")).toEqual(["speed"]);
    for (const goal of ["orders", "cart", "checkout", null, "form"]) expect(guardrailsToClear(goal)).toEqual([]);
  });
});

describe("what the store does with the autopilot's test (E4.1)", () => {
  const running = { status: "running" as const, stopReason: null, best: null, plannedEnd: "2026-12-01T12:00:00Z", now: NOW };

  it("makes the change live only when the test answers for it", () => {
    expect(testAction({ ...running, verdict: "better", best: "b" })).toBe("apply");
    expect(testAction({ ...running, status: "stopped", stopReason: "planned_end", verdict: "better", best: "b" })).toBe("apply");
    for (const verdict of ["few", "early", "even"] as const) expect(testAction({ ...running, verdict })).toBe("wait");
  });

  it("keeps the page as it was when the change does worse, harms a guardrail, the split is off or the time is up", () => {
    expect(testAction({ ...running, verdict: "worse" })).toBe("keep");
    expect(testAction({ ...running, verdict: "broken" })).toBe("keep");
    expect(testAction({ ...running, verdict: "better", best: "b", harmed: true })).toBe("keep");
    expect(testAction({ ...running, status: "stopped", stopReason: "guardrail", verdict: "better", best: "b" })).toBe("keep");
    expect(testAction({ ...running, status: "stopped", stopReason: "planned_end", verdict: "even" })).toBe("keep");
    expect(testAction({ ...running, verdict: "even", plannedEnd: "2026-11-17T11:00:00Z" })).toBe("keep");
    expect(testAction({ ...running, verdict: "few", plannedEnd: "2026-11-16T12:00:00Z" })).toBe("keep");
  });

  it("leaves a test a person stopped or decided to them", () => {
    expect(testAction({ ...running, status: "stopped", stopReason: "person", verdict: "better", best: "b" })).toBe("leave");
    expect(testAction({ ...running, status: "applied", verdict: "better", best: "b" })).toBe("leave");
    expect(testAction({ ...running, status: "discarded", verdict: "worse" })).toBe("leave");
  });

  it("makes a sign-up test's change live only once speed was watched and found fine (E5.3, D757)", () => {
    const signups = { ...running, verdict: "better" as const, best: "b", goal: "signup" };
    const speed = (state: "watching" | "fine" | "worse" | "off") => [
      { kind: "orders" as const, state: "watching" as const },
      { kind: "speed" as const, state },
    ];
    expect(testAction({ ...signups, guardrails: speed("fine") })).toBe("apply");
    // Still watching: the test waits for it, until its time is up or it stopped.
    expect(testAction({ ...signups, guardrails: speed("watching") })).toBe("wait");
    expect(testAction({ ...signups, guardrails: speed("watching"), plannedEnd: "2026-11-17T11:00:00Z" })).toBe("keep");
    expect(testAction({ ...signups, status: "stopped", stopReason: "planned_end", guardrails: speed("watching") })).toBe("keep");
    // Nothing can watch it (the store stopped counting visits), or nothing was said: the page stays as it was.
    expect(testAction({ ...signups, guardrails: speed("off") })).toBe("keep");
    expect(testAction(signups)).toBe("keep");
    // A store's tests need nothing more than before: its orders and payments guardrails stop a harmful version themselves.
    expect(testAction({ ...signups, goal: "cart", guardrails: speed("watching") })).toBe("apply");
    expect(testAction({ ...signups, goal: "orders" })).toBe("apply");
  });
});

describe("how the owner is told (E4.1)", () => {
  it("counts the days left, at least one while it runs", () => {
    expect(daysLeft("2026-12-01T12:00:00Z", NOW)).toBe(14);
    expect(daysLeft("2026-11-17T13:00:00Z", NOW)).toBe(1);
    expect(daysLeft("2026-11-10T12:00:00Z", NOW)).toBe(1);
    expect(daysLeft(null, NOW, 21)).toBe(21);
  });

  it("names the state from the test and the store's decision", () => {
    expect(testState("running", null, null)).toBe("testing");
    expect(testState("running", null, "asked")).toBe("waiting");
    expect(testState("stopped", null, "asked")).toBe("waiting");
    expect(testState("applied", "b", "applied")).toBe("live");
    expect(testState("applied", "b", "asked")).toBe("live");
    expect(testState("discarded", null, "kept")).toBe("kept");
    expect(testState("applied", "b", "left")).toBe("decided");
    expect(testState("discarded", null, "left")).toBe("decided");
  });

  it("says each state in a line, in the page's and the report's words", () => {
    expect(testLine({ page: "About us", state: "testing", daysLeft: 9 }, assistantEn.autopilot.tests)).toBe(
      "Testing my change to About us against the current page: about 9 days left",
    );
    expect(testLine({ page: "About us", state: "testing", daysLeft: 1 }, assistantEn.autopilot.tests)).toContain("about 1 day left");
    expect(testLine({ page: "Om oss", state: "live", daysLeft: null }, assistantNb.autopilot.tests)).toBe("Endringen min av Om oss er publisert: A/B-testen svarte for den.");
    const e = staffEmailsEn.autopilot;
    const email = { testing: e.testing, waiting: e.testWaiting, live: e.testLive, kept: e.testKept, decided: e.testDecided };
    expect(testLine({ page: "About us", state: "kept", daysLeft: null }, email)).toBe("About us stays as it was: my change did not do better in its A/B test.");
  });
});
