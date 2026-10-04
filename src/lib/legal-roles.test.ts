import { describe, expect, it } from "vitest";

import { LEGAL_ROLES, LEGAL_ROLE_COPY, CHECKOUT_TERMS_ROLES, isLegalRole } from "./legal-roles";
import { PAGE_ROLES } from "./page-roles";

describe("the linked legal roles (wave 1, 1e)", () => {
  it("are seven, none of them a D112 role, so no page of theirs is a 404 at its own address", () => {
    expect(LEGAL_ROLES).toEqual(["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint", "accessibility"]);
    for (const role of LEGAL_ROLES) expect(PAGE_ROLES as readonly string[]).not.toContain(role);
  });

  it("have a name and a hint for the admin", () => {
    for (const role of LEGAL_ROLES) {
      expect(LEGAL_ROLE_COPY[role].name.length).toBeGreaterThan(3);
      expect(LEGAL_ROLE_COPY[role].hint.length).toBeGreaterThan(20);
    }
    expect(Object.keys(LEGAL_ROLE_COPY).sort()).toEqual([...LEGAL_ROLES].sort());
  });

  it("are told from other roles, and checkout names the terms and then the privacy statement", () => {
    expect(isLegalRole("terms")).toBe(true);
    expect(isLegalRole("cart")).toBe(false);
    expect(isLegalRole(undefined)).toBe(false);
    expect(CHECKOUT_TERMS_ROLES).toEqual(["terms", "privacy"]);
  });
});
