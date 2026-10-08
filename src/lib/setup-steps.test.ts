import { describe, expect, it } from "vitest";

import { firstOpenStep, isSetupStep, nextSetupStep, setupStepsFor, stepApplies } from "./setup-steps";

const ids = (features: string[]) => setupStepsFor(features).map((s) => s.id);

describe("the setup wizard's steps follow the store's features (D178 step 6)", () => {
  it("asks what the store sells first, and gives a shop its payments and products", () => {
    expect(ids(["shop"])).toEqual(["features", "details", "countries", "payments", "products", "launch"]);
  });

  it("leaves the shop's steps out of a website, and calls its country its country", () => {
    expect(ids([])).toEqual(["features", "details", "countries", "launch"]);
    expect(setupStepsFor([]).find((s) => s.id === "countries")?.title).toBe("Your country");
    expect(setupStepsFor(["shop"]).find((s) => s.id === "countries")?.title).toBe("Where you sell");
    // A booking feature kept on while the shop is off is asleep: no bookings step either.
    expect(ids(["appointments", "bookings"])).toEqual(["features", "details", "countries", "launch"]);
  });

  it("adds the bookings step while appointments or stays and rentals are on", () => {
    expect(ids(["shop", "appointments"])).toEqual(["features", "details", "countries", "bookings", "payments", "products", "launch"]);
    expect(stepApplies("bookings", ["shop", "bookings"])).toBe(true);
    expect(stepApplies("bookings", ["shop", "boxes"])).toBe(false);
  });

  it("moves on through the store's own steps", () => {
    expect(nextSetupStep("features", [])).toBe("details");
    expect(nextSetupStep("countries", [])).toBe("launch");
    expect(nextSetupStep("countries", ["shop"])).toBe("payments");
    expect(nextSetupStep("countries", ["shop", "appointments"])).toBe("bookings");
    expect(nextSetupStep("bookings", ["shop", "appointments"])).toBe("payments");
    // A step the store does not have goes to the end.
    expect(nextSetupStep("payments", [])).toBe("launch");
  });

  it("resumes at the first step not done, skipping the ones the store does not have", () => {
    expect(firstOpenStep(["shop"], {})).toBe("features");
    expect(firstOpenStep([], { features: true, details: true, countries: true, payments: false, products: false })).toBe("launch");
    expect(firstOpenStep(["shop"], { features: true, details: true, countries: true, payments: false })).toBe("payments");
    expect(firstOpenStep(["shop", "bookings"], { features: true, details: true, countries: true, bookings: false })).toBe("bookings");
  });

  it("knows its step names", () => {
    expect(isSetupStep("features")).toBe(true);
    expect(isSetupStep("bookings")).toBe(true);
    expect(isSetupStep("shipping")).toBe(false);
  });
});
