import { describe, expect, it } from "vitest";

import { companyInput, companyPercent, discountParts, memberDiscount, memberLineOff, parseInviteEmails, percentText, tierInput } from "./customer-tiers";

describe("discount groups and company accounts (D108)", () => {
  it("reads a group's and a company's settings, with whole percentages", () => {
    expect(tierInput.parse({ name: " Wholesale ", percent: "10" })).toMatchObject({ name: "Wholesale", percent: 10, active: true });
    expect(tierInput.safeParse({ name: "x", percent: 0 }).success).toBe(false);
    expect(tierInput.safeParse({ name: "x", percent: 101 }).success).toBe(false);
    expect(tierInput.safeParse({ name: "x", percent: "7,5" }).success).toBe(false);
    expect(companyInput.parse({ name: "Acme AS", tierId: "" })).toMatchObject({ tierId: null, employeeSharePercent: 100, maxMembers: 25 });
    expect(companyInput.safeParse({ name: "Acme", employeeSharePercent: 120 }).success).toBe(false);
  });

  it("gives a company's employees the share of the discount the store set", () => {
    expect(companyPercent(10, 100, "employee")).toBe(10);
    expect(companyPercent(10, 50, "employee")).toBe(5);
    expect(companyPercent(15, 50, "employee")).toBe(7.5);
    expect(companyPercent(10, 0, "employee")).toBe(0);
    // The main account always gets the whole discount.
    expect(companyPercent(10, 50, "owner")).toBe(10);
  });

  it("takes the better of a customer's own group and their company's, and nothing for a company that is off", () => {
    const company = (over = {}) => ({ name: "Acme AS", active: true, tier: { percent: 10 }, sharePercent: 50, role: "employee" as const, ...over });
    expect(memberDiscount({ own: null, company: null })).toBeNull();
    expect(memberDiscount({ own: null, company: company() })).toEqual({ percent: 5, label: "Acme AS", via: "company" });
    expect(memberDiscount({ own: { name: "VIP", percent: 8 }, company: company() })).toEqual({ percent: 8, label: "VIP", via: "tier" });
    expect(memberDiscount({ own: { name: "VIP", percent: 3 }, company: company() })?.via).toBe("company");
    expect(memberDiscount({ own: null, company: company({ active: false }) })).toBeNull();
    expect(memberDiscount({ own: null, company: company({ tier: null }) })).toBeNull();
    expect(memberDiscount({ own: null, company: company({ sharePercent: 0 }) })).toBeNull();
  });

  it("takes a percentage off a unit as a subscription's price is lowered, times the quantity", () => {
    expect(memberLineOff(10_000, 3, 10)).toBe(3_000);
    expect(memberLineOff(999, 1, 10)).toBe(100);
    expect(memberLineOff(1_000, 2, 7.5)).toBe(150);
    expect(percentText(7.5)).toBe("7.5");
    expect(percentText(10)).toBe("10");
  });

  it("reads the addresses of an invitation, without repeats or mistakes", () => {
    expect(parseInviteEmails("Ane@Acme.no, bo@acme.no;\nane@acme.no  <cy@acme.no>")).toEqual({ emails: ["ane@acme.no", "bo@acme.no", "cy@acme.no"], invalid: [] });
    expect(parseInviteEmails("ane@acme.no, nope, @x")).toEqual({ emails: ["ane@acme.no"], invalid: ["nope", "@x"] });
    expect(parseInviteEmails("  ")).toEqual({ emails: [], invalid: [] });
  });

  it("splits an order's discount into the group's and the code's", () => {
    expect(discountParts({ discountMinor: 1_500, memberDiscountMinor: 1_000, memberLabel: "Acme AS", memberPercent: 10, discountCode: "SUMMER" })).toEqual({
      memberMinor: 1_000,
      memberLabel: "Acme AS",
      memberPercent: 10,
      codeMinor: 500,
      code: "SUMMER",
    });
  });
});
