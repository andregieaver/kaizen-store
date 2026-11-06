import { describe, expect, it } from "vitest";

import { HOUSE_TAG, isHouseTagKey, houseTags, signupDeal, signupTitle, type PersonFacts } from "./house-customers";

/** Kaizena Flow's own customers (D467): the tags the platform keeps on a person, and where an application's deal stands. */

const none: PersonFacts = { owner: false, waiting: false, plans: [], trial: false, overdue: false, storeOpen: false };
const labels = (facts: Partial<PersonFacts>) => houseTags({ ...none, ...facts }).map((t) => t.label);

describe("the tags Kaizena Flow keeps on its own customers (D467)", () => {
  it("tags an applicant as a lead until they own a store", () => {
    expect(labels({ waiting: true })).toEqual([HOUSE_TAG.lead]);
    expect(labels({ waiting: true, owner: true })).toEqual([HOUSE_TAG.owner, HOUSE_TAG.noPlan]);
    expect(labels({})).toEqual([]);
  });

  it("tags an owner with each plan once, in order, and with no plan when there is none", () => {
    expect(labels({ owner: true, plans: ["Start", "Growth", "Start"], trial: true, overdue: true, storeOpen: true })).toEqual([
      "Owner",
      "Plan: Growth",
      "Plan: Start",
      "Trial",
      "Overdue",
      "Store open",
    ]);
    expect(labels({ owner: true })).toEqual(["Owner", "No plan"]);
  });

  it("leaves out a plan whose name cannot be a tag, and knows its own tags from staff's", () => {
    expect(labels({ owner: true, plans: ["Pro, yearly"] })).toEqual(["Owner"]);
    for (const tag of houseTags({ ...none, owner: true, plans: ["Growth"], trial: true, overdue: true, storeOpen: true })) expect(isHouseTagKey(tag.key)).toBe(true);
    expect(isHouseTagKey("lead")).toBe(true);
    expect(isHouseTagKey("vip")).toBe(false);
    expect(isHouseTagKey("planner")).toBe(false);
  });
});

describe("an application's deal (D467)", () => {
  it("goes from asked to approved to store opened, and is won when a plan is paid", () => {
    expect(signupDeal({ status: "pending", storeOpened: false, planPaid: false })).toEqual({ stage: 0, outcome: "open" });
    expect(signupDeal({ status: "approved", storeOpened: false, planPaid: false })).toEqual({ stage: 1, outcome: "open" });
    expect(signupDeal({ status: "approved", storeOpened: true, planPaid: false })).toEqual({ stage: 2, outcome: "open" });
    expect(signupDeal({ status: "approved", storeOpened: true, planPaid: true })).toEqual({ stage: 2, outcome: "won" });
    expect(signupDeal({ status: "approved", storeOpened: false, planPaid: true })).toEqual({ stage: 1, outcome: "won" });
  });

  it("is lost when the application is declined", () => {
    expect(signupDeal({ status: "declined", storeOpened: false, planPaid: false })).toEqual({ stage: 0, outcome: "lost" });
  });

  it("is named after the store asked for, or the address", () => {
    expect(signupTitle("  Ada's   Apples ", "ada@example.com")).toBe("Ada's Apples");
    expect(signupTitle("", "ada@example.com")).toBe("ada@example.com");
    expect(signupTitle(null, "ada@example.com")).toBe("ada@example.com");
    expect(signupTitle("x".repeat(300), "a@b.c")).toHaveLength(200);
  });
});
