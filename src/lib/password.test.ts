import { describe, expect, it } from "vitest";

import { passwordProblem, safeNext } from "./password";

describe("passwordProblem", () => {
  it("accepts a long password", () => {
    expect(passwordProblem("blue kettle river stone", "kari@example.com")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(passwordProblem("short", "kari@example.com")).toMatch(/at least 12/);
    expect(passwordProblem("kari@example.com", "kari@example.com")).toMatch(/email/);
    expect(passwordProblem("karinordmann2026!", "karinordmann@example.com")).toMatch(/email/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa", "kari@example.com")).toMatch(/repetitive/);
    expect(passwordProblem("æ".repeat(40), "kari@example.com")).toMatch(/at most 72/);
  });
});

describe("safeNext", () => {
  it("keeps paths inside the admin", () => {
    expect(safeNext("/admin/account")).toBe("/admin/account");
    expect(safeNext("/admin/demo/orders?show=unpaid")).toBe("/admin/demo/orders?show=unpaid");
  });

  it("refuses anything that could leave the admin", () => {
    for (const next of [null, "", "https://evil.example", "//evil.example", "/s/demo", "/admin\\@evil", "/admin/../s/demo"]) {
      expect(safeNext(next)).toBe("/admin");
    }
  });
});
