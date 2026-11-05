import { describe, expect, it } from "vitest";

import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";

import {
  SANDBOX_KINDS,
  daysLeft,
  formatPass,
  isSandboxSegment,
  nextExpiry,
  readPass,
  sandboxBase,
  sandboxHome,
  sandboxSlug,
  segmentOf,
} from "./sandbox";

const ID = "0b8f6a2e-5c1d-4f7a-9e3b-2a6c8d0e1f42";
const SECRET = "A".repeat(43);
const DAY = 24 * 60 * 60 * 1000;

describe("the sandbox's pass (D457)", () => {
  it("reads back what it wrote", () => {
    expect(readPass(formatPass({ id: ID, secret: SECRET }))).toEqual({ id: ID, secret: SECRET });
  });

  it("refuses anything that is not a pass's shape", () => {
    for (const value of [null, undefined, "", ID, `${ID}.`, `${ID}.short`, `not-an-id.${SECRET}`, `${ID}.${SECRET}x`, `${ID}.${"A".repeat(42)}=`, "x".repeat(200)]) {
      expect(readPass(value)).toBeNull();
    }
  });
});

describe("a sandbox's address", () => {
  it("is try- and eight letters or digits, as make_sandbox() requires", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      expect(sandboxSlug(bytes)).toMatch(/^try-[a-z0-9]{8}$/);
    }
    expect(() => sandboxSlug(new Uint8Array(4))).toThrow();
  });
});

describe("a sandbox's time", () => {
  const made = new Date("2026-11-01T10:00:00Z");

  it("is 7 days after the last visit", () => {
    const visit = new Date(made.getTime() + 3 * DAY);
    expect(nextExpiry(made, visit).getTime()).toBe(visit.getTime() + 7 * DAY);
  });

  it("is never past 30 days after it was made", () => {
    expect(nextExpiry(made, new Date(made.getTime() + 28 * DAY)).getTime()).toBe(made.getTime() + 30 * DAY);
  });

  it("counts whole days left, never below none", () => {
    expect(daysLeft(new Date(made.getTime() + 7 * DAY), made)).toBe(7);
    expect(daysLeft(new Date(made.getTime() + 6.2 * DAY), made)).toBe(7);
    expect(daysLeft(new Date(made.getTime() - DAY), made)).toBe(0);
  });
});

describe("what the sandbox offers", () => {
  it("is pages, headers and footers (S1), articles and product layouts (S3), each under its store admin's segment", () => {
    expect(SANDBOX_KINDS).toEqual({ pages: "page", headers: "header", footers: "footer", articles: "article", "product-layouts": "product_layout" });
    expect(segmentOf("header")).toBe("headers");
    expect(segmentOf("product_layout")).toBe("product-layouts");
    for (const kind of Object.values(SANDBOX_KINDS)) expect(segmentOf(kind)).toBe(PAGE_TYPE_COPY[kind].segment);
    expect(isSandboxSegment("pages")).toBe(true);
    expect(isSandboxSegment("articles")).toBe(true);
    expect(isSandboxSegment("variants")).toBe(false);
    expect(isSandboxSegment("ai")).toBe(false);
    expect(isSandboxSegment("toString")).toBe(false);
    expect(sandboxHome(ID)).toBe(`/admin/try/${ID}`);
    expect(sandboxBase(ID, "footer")).toBe(`/admin/try/${ID}/footers`);
  });
});
