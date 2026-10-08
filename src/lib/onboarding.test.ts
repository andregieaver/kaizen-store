import { describe, expect, it } from "vitest";

import {
  answersForFeatures,
  featureSummary,
  featuresForAnswers,
  planFeatureChanges,
  QUESTION_FEATURES,
  readAnswers,
  SELL_ANSWERS,
  targetFeatures,
  targetProblems,
  type OnboardingAnswers,
} from "./onboarding";
import { FEATURE_IDS, featureOn, normaliseFeatures } from "./store-features";

const features = (answers: OnboardingAnswers) => {
  const result = featuresForAnswers(answers);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.features;
};

describe("What will you sell? (D178 step 6)", () => {
  it("maps each kind of thing sold to the online shop and what that kind needs", () => {
    expect(features({ sells: ["goods"], extras: [] })).toEqual(["shop"]);
    expect(features({ sells: ["downloads"], extras: [] })).toEqual(["shop"]);
    expect(features({ sells: ["appointments"], extras: [] })).toEqual(["shop", "appointments"]);
    expect(features({ sells: ["stays"], extras: [] })).toEqual(["shop", "bookings"]);
    expect(features({ sells: ["subscriptions"], extras: [] })).toEqual(["shop", "subscriptions"]);
    expect(features({ sells: ["boxes"], extras: [] })).toEqual(["shop", "boxes"]);
    expect(features({ sells: ["goods", "appointments", "stays", "boxes"], extras: [] })).toEqual(["shop", "boxes", "appointments", "bookings"]);
  });

  it("makes a website the shop off, alone, keeping countries and languages but never currencies or businesses", () => {
    expect(features({ sells: ["website"], extras: [] })).toEqual([]);
    expect(features({ sells: ["website"], extras: ["countries", "languages"] })).toEqual(["countries", "languages"]);
    expect(featuresForAnswers({ sells: ["website"], extras: ["business"] })).toMatchObject({ ok: false });
  });

  it("adds Several currencies with Several languages only with a shop, and the other extras as they are", () => {
    expect(features({ sells: ["goods"], extras: ["languages"] })).toEqual(["shop", "languages", "currencies"]);
    expect(features({ sells: ["goods"], extras: ["countries", "business"] })).toEqual(["shop", "countries", "business"]);
  });

  it("refuses no answer, and a website with something sold", () => {
    expect(featuresForAnswers({ sells: [], extras: ["countries"] })).toEqual({ ok: false, problems: ["Choose what you will sell, or Just a website."] });
    expect(featuresForAnswers({ sells: ["website", "goods"], extras: [] })).toMatchObject({ ok: false });
  });

  it("always gives a set that holds together (each feature with what it needs)", () => {
    // Every combination of answers.
    const extras = ["countries", "languages", "business"] as const;
    for (let mask = 0; mask < 1 << SELL_ANSWERS.length; mask++) {
      for (let extra = 0; extra < 1 << extras.length; extra++) {
        const answers = { sells: SELL_ANSWERS.filter((_, i) => mask & (1 << i)), extras: extras.filter((_, i) => extra & (1 << i)) };
        const result = featuresForAnswers(answers);
        if (result.ok) {
          expect(targetProblems(result.features), JSON.stringify(answers)).toEqual([]);
          for (const id of result.features) expect(QUESTION_FEATURES).toContain(id);
        }
      }
    }
  });

  it("reads a form's answers, known values only, each once", () => {
    expect(readAnswers({ sells: ["goods", "goods", "nonsense", 3, "website"], extras: ["business", "bonus"] })).toEqual({ sells: ["goods", "website"], extras: ["business"] });
  });

  it("keeps the programs the question does not ask about, and decides the rest", () => {
    expect(targetFeatures(["shop", "bonus", "referrals", "appointments", "countries"], ["shop", "bookings"])).toEqual(["shop", "bookings", "bonus", "referrals"]);
    // A website keeps the programs' switches, asleep with the shop off.
    expect(targetFeatures(["shop", "bonus"], [])).toEqual(["bonus"]);
  });

  it("is pre-filled from what is on, and the pre-filled answers give the same features back", () => {
    expect(answersForFeatures(["shop"])).toEqual({ sells: ["goods"], extras: [] });
    expect(answersForFeatures([])).toEqual({ sells: ["website"], extras: [] });
    expect(answersForFeatures(["shop", "appointments", "countries", "business"])).toEqual({ sells: ["appointments"], extras: ["countries", "business"] });
    // A feature asleep (its need off) is not on: a website with a sleeping business switch is a website.
    expect(answersForFeatures(["business", "languages"])).toEqual({ sells: ["website"], extras: ["languages"] });
    for (const kept of [["shop"], ["shop", "bookings", "subscriptions"], ["countries"], ["shop", "countries", "languages", "currencies", "business"]]) {
      expect(features(answersForFeatures(kept)), kept.join()).toEqual(normaliseFeatures(kept));
    }
  });

  it("plans the switches so each can be made: off from the dependents up, then on from the shop down", () => {
    expect(planFeatureChanges(["shop", "bonus", "referrals"], [])).toEqual([
      { id: "referrals", on: false },
      { id: "bonus", on: false },
      { id: "shop", on: false },
    ]);
    expect(planFeatureChanges([], ["shop", "bonus", "referrals"])).toEqual([
      { id: "shop", on: true },
      { id: "bonus", on: true },
      { id: "referrals", on: true },
    ]);
    expect(planFeatureChanges(["shop", "appointments"], ["shop", "bookings"])).toEqual([
      { id: "appointments", on: false },
      { id: "bookings", on: true },
    ]);
    expect(planFeatureChanges(["shop"], ["shop"])).toEqual([]);
    // At every step the state holds together, for any start and end.
    const sets = [[], ["shop"], ["shop", "bonus", "referrals"], ["shop", "business", "currencies"], ["countries", "languages"]];
    for (const from of sets) {
      for (const to of sets) {
        let state: string[] = [...from];
        for (const change of planFeatureChanges(from, to)) {
          state = change.on ? [...state, change.id] : state.filter((f) => f !== change.id);
          if (change.on) for (const id of state) expect(FEATURE_IDS).toContain(id);
          // Switching on: everything it needs is already kept.
          if (change.on) expect(featureOn(state, change.id), `${from} -> ${to}: ${change.id}`).toBe(true);
        }
        expect(normaliseFeatures(state)).toEqual(normaliseFeatures(to));
      }
    }
  });

  it("says what a set lacks", () => {
    expect(targetProblems(["referrals", "shop"])).toEqual(["Referral program needs Bonus program."]);
    expect(targetProblems(["shop", "bonus", "referrals"])).toEqual([]);
  });

  it("says in a few words what a template switches on", () => {
    expect(featureSummary(["shop"])).toBe("Online shop");
    expect(featureSummary(["shop", "appointments", "countries"])).toBe("Online shop with Appointments and Several countries");
    expect(featureSummary(["shop", "appointments", "bonus", "countries"])).toBe("Online shop with Appointments, Several countries and Bonus program");
    expect(featureSummary([])).toBe("Website (no online shop)");
    // A switch asleep is not counted.
    expect(featureSummary(["languages", "business"])).toBe("Website (no online shop) with Several languages");
  });
});
