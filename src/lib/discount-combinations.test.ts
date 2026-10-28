import { describe, expect, it } from "vitest";

import { campaignsThatGave, codeAllowed, codeRuleFor, codesWin, savingOf } from "./discount-combinations";

describe("campaigns and codes on one basket (D367)", () => {
  it("lets every code in while no campaign gives the basket anything", () => {
    expect(codeRuleFor([])).toBe("any");
    expect(codeAllowed("any", { combinesWithCampaigns: false })).toBe(true);
    expect(codeAllowed(undefined, { combinesWithCampaigns: false })).toBe(true);
    expect(codeAllowed(null, { combinesWithCampaigns: false })).toBe(true);
  });

  it("lets in only codes that combine with campaigns while every campaign that gave combines with codes", () => {
    const rule = codeRuleFor([{ combinesWithCodes: true }, { combinesWithCodes: true }]);
    expect(rule).toBe("combining");
    expect(codeAllowed(rule, { combinesWithCampaigns: true })).toBe(true);
    expect(codeAllowed(rule, { combinesWithCampaigns: false })).toBe(false);
  });

  it("lets no code in once a campaign that gave does not combine with codes", () => {
    const rule = codeRuleFor([{ combinesWithCodes: true }, { combinesWithCodes: false }]);
    expect(rule).toBe("none");
    expect(codeAllowed(rule, { combinesWithCampaigns: true })).toBe(false);
    expect(codeAllowed(rule, { combinesWithCampaigns: false })).toBe(false);
  });

  it("counts a campaign as giving for a reduction, a free product, or shipping made free only where the basket can have it", () => {
    const result = { applied: [{ campaignId: "a" }], freeShipping: { campaignId: "s" } };
    expect(campaignsThatGave(result, [{ campaignId: "g" }, { campaignId: "a" }], true)).toEqual(["a", "g", "s"]);
    expect(campaignsThatGave(result, [], false)).toEqual(["a"]);
    expect(campaignsThatGave({ applied: [], freeShipping: null }, [], true)).toEqual([]);
  });

  it("adds every part of a saving: the campaigns' lines, free products and shipping, the codes, and the group's and welcome discounts after them", () => {
    expect(savingOf({ campaignsMinor: 1_000, codesMinor: 250, otherMinor: 75 })).toBe(1_325);
  });

  it("gives the basket to the codes only when they save strictly more, and a tie to the campaigns", () => {
    const campaigns = { campaignsMinor: 2_000, codesMinor: 0, otherMinor: 180 };
    expect(codesWin(campaigns, { campaignsMinor: 0, codesMinor: 2_500, otherMinor: 0, codesUsed: 1 })).toBe(true);
    expect(codesWin(campaigns, { campaignsMinor: 0, codesMinor: 2_180, otherMinor: 0, codesUsed: 1 })).toBe(false);
    expect(codesWin(campaigns, { campaignsMinor: 0, codesMinor: 2_179, otherMinor: 0, codesUsed: 1 })).toBe(false);
    // The group's discount counts: more of it after the code than after the campaign can tip it.
    expect(codesWin(campaigns, { campaignsMinor: 0, codesMinor: 2_000, otherMinor: 200, codesUsed: 1 })).toBe(true);
    // A combining campaign kept beside the code counts on the code's side.
    expect(codesWin(campaigns, { campaignsMinor: 500, codesMinor: 1_700, otherMinor: 0, codesUsed: 1 })).toBe(true);
  });

  it("never gives the basket to codes that take nothing off", () => {
    expect(codesWin({ campaignsMinor: 0, codesMinor: 0, otherMinor: 0 }, { campaignsMinor: 100, codesMinor: 0, otherMinor: 0, codesUsed: 0 })).toBe(false);
  });
});
