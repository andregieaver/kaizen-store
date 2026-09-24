import { describe, expect, it } from "vitest";

import { slugProblem, suggestSlug } from "./slug";

describe("suggestSlug", () => {
  it("turns a store name into an address", () => {
    expect(suggestSlug("Kari's Kopper & Kanner")).toBe("karis-kopper-kanner");
    expect(suggestSlug("Blåbær Økologisk")).toBe("blabaer-okologisk");
    expect(suggestSlug("Café Crème")).toBe("cafe-creme");
    expect(suggestSlug("  --Hei--  ")).toBe("hei");
  });

  it("keeps within 40 characters and never ends on a hyphen", () => {
    const slug = suggestSlug("a".repeat(39) + " b");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("gives up when too little is left", () => {
    expect(suggestSlug("!!")).toBe("");
    expect(suggestSlug("Øy")).toBe("");
  });
});

describe("slugProblem", () => {
  it("accepts a well-formed address", () => {
    expect(slugProblem("karis-kopper")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(slugProblem("ab")).toMatch(/3 to 40/);
    expect(slugProblem("Karis")).toMatch(/lowercase/);
    expect(slugProblem("-karis")).toMatch(/Start and end/);
    expect(slugProblem("admin")).toMatch(/reserved/);
  });
});
