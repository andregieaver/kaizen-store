import { describe, expect, it } from "vitest";

import { assign, assignAll, unitDraw } from "./experiment-assign";
import {
  audienceAllows,
  dataCookieName,
  decodeAssignments,
  deviceOf,
  encodeAssignments,
  evenSplit,
  GOAL_WORDS,
  isBot,
  isGoal,
  NEXT_STATUSES,
  overdue,
  parseAudience,
  startProblems,
} from "./experiments";

const A = "11111111-1111-4111-8111-111111111111";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const E2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("the assignment cookie", () => {
  it("holds a visitor's own id and a version for each test, and reads back what it wrote", () => {
    const value = encodeAssignments({ visitor: A, versions: { [E1]: "b", [E2]: "c" } });
    expect(value).toBe(`1.${A}.${E1}=b,${E2}=c`);
    expect(decodeAssignments(value)).toEqual({ visitor: A, versions: { [E1]: "b", [E2]: "c" } });
    expect(decodeAssignments(encodeAssignments({ visitor: A, versions: {} }))).toEqual({ visitor: A, versions: {} });
  });

  it("refuses anything else, and drops what is not a test id or a version", () => {
    expect(decodeAssignments(undefined)).toBeNull();
    expect(decodeAssignments("2.x.y")).toBeNull();
    expect(decodeAssignments(`1.not-a-uuid.${E1}=b`)).toBeNull();
    expect(decodeAssignments(`1.${A}.${E1}=z`)?.versions).toEqual({});
    expect(decodeAssignments(`1.${A}.not-an-id=b,${E1}=a`)?.versions).toEqual({ [E1]: "a" });
    expect(encodeAssignments({ visitor: A, versions: { nope: "b", [E1]: "q" } })).toBe(`1.${A}.`);
  });

  it("is one cookie per store, so a visitor's id differs between stores", () => {
    expect(dataCookieName("store-1")).not.toBe(dataCookieName("store-2"));
  });
});

describe("who is given which version", () => {
  const split = [
    { key: "a", share: 0.5 },
    { key: "b", share: 0.5 },
  ];
  const visitors = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("gives the same visitor the same answer every time, and different tests different draws", () => {
    expect(assign(A, E1, 1, split)).toBe(assign(A, E1, 1, split));
    expect(unitDraw(A, E1, "version")).not.toBe(unitDraw(A, E2, "version"));
    expect(unitDraw(A, E1, "version")).not.toBe(unitDraw(A, E1, "enroll"));
  });

  it("divides visitors by the shares, and enrols only the traffic share", () => {
    const counts = { a: 0, b: 0, none: 0 };
    for (const v of visitors) {
      const got = assign(v, E1, 0.5, split);
      counts[(got ?? "none") as "a" | "b" | "none"] += 1;
    }
    expect(Math.abs(counts.none / 4000 - 0.5)).toBeLessThan(0.04);
    expect(Math.abs(counts.a - counts.b) / (counts.a + counts.b)).toBeLessThan(0.08);
    const uneven = visitors.map((v) => assign(v, E1, 1, [{ key: "a", share: 0.9 }, { key: "b", share: 0.1 }]));
    expect(uneven.filter((x) => x === "b").length / 4000).toBeGreaterThan(0.07);
    expect(uneven.filter((x) => x === "b").length / 4000).toBeLessThan(0.13);
  });

  it("does not let one test's draw decide another's", () => {
    const both = visitors.slice(0, 2000).map((v) => [assign(v, E1, 1, split), assign(v, E2, 1, split)]);
    const agree = both.filter(([x, y]) => x === y).length / both.length;
    expect(agree).toBeGreaterThan(0.42);
    expect(agree).toBeLessThan(0.58);
  });
});

describe("a visitor's answers for the tests running", () => {
  const visit = { market: "no", device: "desktop" as const, returning: false };
  const test = (id: string, over: object = {}) => ({ id, trafficShare: 1, audience: {}, variants: [{ key: "a", share: 0.5 }, { key: "b", share: 0.5 }], ...over });

  it("gives a new visitor an id and an answer for every test running", () => {
    const { assignments, changed } = assignAll([test(E1), test(E2)], null, visit, () => A);
    expect(changed).toBe(true);
    expect(assignments.visitor).toBe(A);
    expect(Object.keys(assignments.versions).sort()).toEqual([E1, E2]);
    expect(["a", "b"]).toContain(assignments.versions[E1]);
  });

  it("never changes what a visitor already has, adds only new tests, and drops tests that ended", () => {
    const existing = { visitor: A, versions: { [E1]: "b", ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]: "a" } };
    const same = assignAll([test(E1)], { visitor: A, versions: { [E1]: "b" } }, visit, () => "x");
    expect(same.changed).toBe(false);
    expect(same.assignments.versions[E1]).toBe("b");
    const grown = assignAll([test(E1), test(E2)], existing, visit, () => "x");
    expect(grown.changed).toBe(true);
    expect(grown.assignments.versions[E1]).toBe("b");
    expect(Object.keys(grown.assignments.versions).sort()).toEqual([E1, E2]);
    expect(grown.assignments.visitor).toBe(A);
  });

  it("leaves a visitor outside a test their audience or the traffic share does not include, and remembers it", () => {
    const mobileOnly = assignAll([test(E1, { audience: { devices: ["mobile"] } })], null, visit, () => A);
    expect(mobileOnly.assignments.versions[E1]).toBe("0");
    const nobody = assignAll([test(E1, { trafficShare: 0.000001 })], null, visit, () => A);
    expect(nobody.assignments.versions[E1]).toBe("0");
    // The next call has the answer, so nothing is asked again.
    expect(assignAll([test(E1, { audience: { devices: ["mobile"] } })], mobileOnly.assignments, visit, () => "x").changed).toBe(false);
  });
});

describe("narrowing the audience", () => {
  const visit = { market: "no", device: "mobile" as const, returning: false };

  it("lets everyone in when nothing is chosen, and keeps out who is not in the lists", () => {
    expect(audienceAllows({}, visit)).toBe(true);
    expect(audienceAllows(undefined, visit)).toBe(true);
    expect(audienceAllows({ markets: ["se"] }, visit)).toBe(false);
    expect(audienceAllows({ markets: ["se", "no"] }, visit)).toBe(true);
    // A market is a country: the same country in another language or currency is the same market.
    expect(audienceAllows({ markets: ["no"] }, { ...visit, market: "no-en-eur" })).toBe(true);
    expect(audienceAllows({ devices: ["desktop"] }, visit)).toBe(false);
    expect(audienceAllows({ returning: "returning" }, visit)).toBe(false);
    expect(audienceAllows({ returning: "new" }, visit)).toBe(true);
  });

  it("reads stored audiences strictly", () => {
    expect(parseAudience({ markets: ["no", "BAD!", 5], devices: ["mobile", "fax"], returning: "new" })).toEqual({ markets: ["no"], devices: ["mobile"], returning: "new" });
    expect(parseAudience({ devices: ["mobile", "tablet", "desktop"] })).toEqual({});
    expect(parseAudience(null)).toEqual({});
  });

  it("tells the coarse kind of device and who is a robot", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (X11; Linux x86_64) Chrome/120")).toBe("desktop");
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/120")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537")).toBe(false);
  });
});

describe("starting a test", () => {
  const ok = {
    name: "Shorter hero",
    goal: "orders",
    goalBlock: null,
    trafficShare: 1,
    variants: [
      { key: "a", name: "Original", share: 0.5, published: true },
      { key: "b", name: "B", share: 0.5, published: true },
    ],
    pagePublished: true,
    runningInStore: 0,
    pageIsSpecial: false,
  };

  it("has nothing to say about a test that is ready", () => {
    expect(startProblems(ok)).toEqual([]);
  });

  it("asks for the form a forms-sent test counts, as for a button (phase 11)", () => {
    expect(GOAL_WORDS.form).toMatchObject({ kind: "rate", needsBlock: true, block: "form" });
    expect(GOAL_WORDS.click).toMatchObject({ needsBlock: true, block: "button" });
    expect(startProblems({ ...ok, goal: "form" })).toContain("Choose the form whose answers you want more of.");
    expect(startProblems({ ...ok, goal: "click" })).toContain("Choose the button or link whose clicks you want more of.");
    expect(startProblems({ ...ok, goal: "form", goalBlock: "news-1" })).toEqual([]);
    expect(isGoal("form")).toBe(true);
  });

  it("says what is missing, in words", () => {
    expect(startProblems({ ...ok, name: " " })).toContain("Give the test a name.");
    expect(startProblems({ ...ok, goal: "click" })).toContain("Choose the button or link whose clicks you want more of.");
    expect(startProblems({ ...ok, goal: "click", goalBlock: "block-1" })).toEqual([]);
    expect(startProblems({ ...ok, pagePublished: false })[0]).toMatch(/Publish the page/);
    expect(startProblems({ ...ok, pageIsSpecial: true })[0]).toMatch(/cookies page and the blog/);
    expect(startProblems({ ...ok, variants: [ok.variants[0]] })[0]).toMatch(/at least one other version/);
    expect(startProblems({ ...ok, variants: [ok.variants[0], { ...ok.variants[1], share: 0.3 }] })[0]).toMatch(/add up to 100/);
    expect(startProblems({ ...ok, variants: [ok.variants[0], { ...ok.variants[1], published: false }] })[0]).toMatch(/Publish version B/);
    expect(startProblems({ ...ok, runningInStore: 5 })[0]).toMatch(/5 tests at a time/);
    expect(startProblems({ ...ok, trafficShare: 0 })[0]).toMatch(/more than 0/);
  });

  it("says when a version of a part test changes more than the part, or lost it", () => {
    const b = ok.variants[1];
    const test = (scope: "ok" | "outside" | "missing") => ({ ...ok, partLabel: "the heading", variants: [ok.variants[0], { ...b, scope }] });
    expect(startProblems(test("ok"))).toEqual([]);
    expect(startProblems(test("outside"))[0]).toMatch(/Version B changes more than the heading/);
    expect(startProblems(test("missing"))[0]).toMatch(/no longer has the heading/);
    // A whole-page test has no scope to check.
    expect(startProblems({ ...ok, variants: [ok.variants[0], { ...b, scope: null }] })).toEqual([]);
  });

  it("moves forward only", () => {
    expect(NEXT_STATUSES.draft).toEqual(["scheduled", "running", "discarded"]);
    expect(NEXT_STATUSES.scheduled).toEqual(["draft", "running", "discarded"]);
    expect(NEXT_STATUSES.running).toEqual(["stopped"]);
    expect(NEXT_STATUSES.stopped).toEqual(["applied", "discarded"]);
    expect(NEXT_STATUSES.applied).toEqual([]);
  });

  it("splits traffic evenly, adding up to one", () => {
    expect(evenSplit(2)).toEqual([0.5, 0.5]);
    const three = evenSplit(3);
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(three[0]).toBeGreaterThanOrEqual(three[1]);
    expect(evenSplit(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(evenSplit(0)).toEqual([]);
  });

  it("stops counting a week after the planned end, or after ninety days", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const planned = new Date("2026-10-15T00:00:00Z");
    expect(overdue(planned, start, new Date("2026-10-21T00:00:00Z"))).toBe(false);
    expect(overdue(planned, start, new Date("2026-10-22T00:00:00Z"))).toBe(true);
    expect(overdue(null, start, new Date("2027-01-02T00:00:00Z"))).toBe(true);
    expect(overdue(null, start, new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});
