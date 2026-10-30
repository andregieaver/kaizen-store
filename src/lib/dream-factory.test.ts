import { describe, expect, it } from "vitest";

import {
  DREAM_STEPS,
  DRILL_PROMPT,
  answeredBrief,
  briefQuestions,
  initialSteps,
  isTestOwner,
  ownerWaitMs,
  readBrief,
  readSteps,
  runStatusOf,
  scoreOf,
  startable,
  stepMessage,
  type DreamSteps,
} from "./dream-factory";

const passedThrough = (steps: DreamSteps, ids: readonly (keyof DreamSteps)[]): DreamSteps => {
  const next = { ...steps };
  for (const id of ids) next[id] = { status: "done", tries: 1 };
  return next;
};

const answer = (business: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    storeName: "Leire",
    sells: "Hand-thrown ceramic mugs and bowls",
    audience: "people who like slow mornings",
    countries: ["NO", "SE"],
    languages: ["Norwegian"],
    currency: "NOK",
    priceRange: "250 to 600 kr",
    tone: "calm",
    products: 6,
    pages: [{ title: "About us", purpose: "Who makes the mugs." }],
    business,
    ...extra,
  });

describe("the Dream Factory's steps (D409)", () => {
  it("names every step once, and needs only steps that come before it", () => {
    const seen = new Set<string>();
    for (const step of DREAM_STEPS) {
      for (const need of step.needs) expect(seen.has(need), `${step.id} needs ${need}`).toBe(true);
      seen.add(step.id);
    }
    expect(seen.size).toBe(DREAM_STEPS.length);
  });

  it("starts with the brief, then the three lanes side by side after the owner's yes", () => {
    let steps = initialSteps();
    expect(startable(steps)).toEqual(["brief"]);
    steps = passedThrough(steps, ["brief"]);
    expect(startable(steps)).toEqual(["confirm"]);
    steps = passedThrough(steps, ["confirm"]);
    expect(startable(steps)).toEqual(["research", "setup", "brand", "plan"]);
    steps = passedThrough(steps, ["research", "setup"]);
    expect(startable(steps)).toEqual(["brand", "catalogue", "legal", "payments", "plan"]);
  });

  it("waits for the rehearsal, the payments and the plan before the owner opens, and sets goals after", () => {
    let steps = passedThrough(initialSteps(), ["brief", "confirm", "research", "setup", "brand", "catalogue", "website", "legal", "payments", "plan"]);
    expect(startable(steps)).toEqual(["rehearsal"]);
    steps = passedThrough(steps, ["rehearsal"]);
    expect(startable(steps)).toEqual(["open"]);
    expect(runStatusOf({ ...steps, open: { status: "asking", tries: 0 } })).toBe("ready");
    steps = passedThrough(steps, ["open"]);
    expect(startable(steps)).toEqual(["goals"]);
    expect(runStatusOf(passedThrough(steps, ["goals"]))).toBe("open");
  });

  it("says the run is asking when only the owner can move it, failed when a step failed", () => {
    const asking = { ...passedThrough(initialSteps(), ["brief"]), confirm: { status: "asking" as const, tries: 0 } };
    expect(runStatusOf(asking)).toBe("asking");
    expect(runStatusOf({ ...initialSteps(), brief: { status: "running", tries: 1 } })).toBe("running");
    expect(runStatusOf({ ...initialSteps(), brief: { status: "failed", tries: 3 } })).toBe("failed");
    // A test run skips the opening and ends ready once its goals are set.
    const test = passedThrough({ ...initialSteps(), open: { status: "skipped", tries: 0 } }, DREAM_STEPS.map((s) => s.id).filter((id) => id !== "open"));
    expect(runStatusOf(test)).toBe("ready");
  });

  it("reads kept steps defensively", () => {
    expect(readSteps({ brief: { status: "done", tries: 1 }, setup: { status: "nonsense" } }).brief.status).toBe("done");
    expect(readSteps({ brief: { status: "done", tries: 1 }, setup: { status: "nonsense" } }).setup.status).toBe("waiting");
    expect(readSteps(null).goals.status).toBe("waiting");
  });
});

describe("the brief", () => {
  const prompt = "Ceramic mugs for Norway and Sweden. Leire Keramikk AS, org nr 912345678, Storgata 1, 0155 Oslo, hei@leire.no";

  it("keeps the business details the owner wrote and drops those the model made up", () => {
    const brief = readBrief(answer({ legalName: "Leire Keramikk AS", organisationNumber: "912345678", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" }), prompt);
    expect(brief?.business).toEqual({ legalName: "Leire Keramikk AS", organisationNumber: "912345678", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" });
    const invented = readBrief(answer({ legalName: "Leire Ceramics Ltd", organisationNumber: "", postalAddress: "Fjordveien 9", contactEmail: "post@leire.com", country: "NO" }), "Ceramic mugs for Norway.");
    expect(invented?.business).toEqual({ legalName: "", organisationNumber: "", postalAddress: "", contactEmail: "", country: "" });
    expect(briefQuestions(invented!)).toEqual(expect.arrayContaining(["What is your business's legal name?", "What is your business's postal address?"]));
  });

  it("asks nothing when the description had it all, and reads the owner's answers over the brief", () => {
    const brief = readBrief(answer({ legalName: "Leire Keramikk AS", organisationNumber: "912345678", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" }), prompt)!;
    expect(briefQuestions(brief)).toEqual([]);
    const missing = { ...brief, business: { ...brief.business, legalName: "", country: "" } };
    const answered = answeredBrief(missing, { legalName: "Leire Keramikk AS", country: "no" });
    expect(answered.business.legalName).toBe("Leire Keramikk AS");
    expect(answered.business.country).toBe("NO");
    expect(briefQuestions(answered)).toEqual([]);
  });

  it("refuses an answer that is not JSON, and keeps sensible bounds", () => {
    expect(readBrief("I cannot help with that.", prompt)).toBeNull();
    const brief = readBrief(answer({}, { products: 40, countries: ["NO", "nonsense"] }), prompt)!;
    expect(brief.products).toBe(6);
    expect(brief.countries).toEqual([]);
  });

  it("holds the drill's own prompt's business details", () => {
    const brief = readBrief(
      answer({
        legalName: "Dream Factory Test AS",
        organisationNumber: "999999999",
        postalAddress: "Testveien 1, 0150 Oslo",
        contactEmail: "dreamfactory@resend.dev",
        country: "NO",
      }),
      DRILL_PROMPT,
    )!;
    expect(briefQuestions(brief)).toEqual([]);
    expect(stepMessage("setup", brief)).toContain('legal name "Dream Factory Test AS"');
  });
});

describe("test runs and the scorecard", () => {
  it("knows a test owner by the drills' test address", () => {
    expect(isTestOwner("delivered+dream202610301300@resend.dev")).toBe(true);
    expect(isTestOwner("owner@example.com")).toBe(false);
  });

  it("scores minutes to ready without the owner's waiting, presses and first tries", () => {
    const createdAt = new Date("2026-10-30T12:00:00Z");
    const readyAt = new Date("2026-10-30T12:50:00Z");
    const steps: DreamSteps = {
      ...passedThrough(initialSteps(), ["brief", "research", "setup", "website"]),
      confirm: { status: "done", tries: 0, startedAt: "2026-10-30T12:01:00Z", finishedAt: "2026-10-30T12:21:00Z" },
      catalogue: { status: "done", tries: 3 },
    };
    const wait = ownerWaitMs(steps, readyAt);
    expect(wait).toBe(20 * 60_000);
    const score = scoreOf({ createdAt, readyAt, ownerPresses: 2, steps, ownerWaitMs: wait });
    expect(score.minutesToReady).toBe(30);
    expect(score.ownerPresses).toBe(2);
    // Five done by the AI or code, four on their first try.
    expect(score.firstTryPercent).toBe(80);
    expect(score.done).toBe(6);
  });
});
