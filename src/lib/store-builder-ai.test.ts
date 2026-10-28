import { describe, expect, it } from "vitest";

import { pageInput } from "./page-content";
import { siteBlocks, siteLayoutProblem } from "./site-layout";
import { draftedLayout } from "./site-tools";
import { draftStoreInput, readThemeChoice } from "./store-drafts";

/** A header or footer drafted for the site and a store drafted from a description (D351): the pure parts. */
describe("a drafted header or footer (D351)", () => {
  it("keeps the standard parts, arranged as asked, showing the menu and the section style given", () => {
    const standard = draftedLayout("store-1", "header", { menuId: "8a1c2e4f-1b2c-4d3e-8f90-1a2b3c4d5e6f" });
    const centred = draftedLayout("store-1", "header", { look: "centred", menuId: "8a1c2e4f-1b2c-4d3e-8f90-1a2b3c4d5e6f", sectionStyle: "contrast", title: "Our header" });
    expect(siteBlocks(centred).map((b) => b.part).sort()).toEqual(siteBlocks(standard).map((b) => b.part).sort());
    expect(centred.title).toBe("Our header");
    expect(centred.rows[0].sectionStyle).toBe("contrast");
    expect(centred.rows[0].columns.map((c) => c.id)).toEqual(["header-nav", "header-brand", "header-tools"]);
    expect(centred.rows[0].columns[1].justify).toBe("center");
    expect(JSON.stringify(centred)).toContain('"menuId":"8a1c2e4f-1b2c-4d3e-8f90-1a2b3c4d5e6f"');
    expect(draftedLayout("store-1", "header", { menuId: null, sectionStyle: "plain" }).rows[0].sectionStyle).toBeUndefined();
    for (const content of [standard, centred]) {
      expect(siteLayoutProblem("store-1", "header", content)).toBeNull();
      expect(pageInput.safeParse(content).success).toBe(true);
    }
  });

  it("keeps a footer's business details, cookies and withdrawal links in either look", () => {
    for (const look of ["columns", "simple"]) {
      const footer = draftedLayout("store-1", "footer", { look, menuId: null });
      expect(siteLayoutProblem("store-1", "footer", footer)).toBeNull();
      expect(siteBlocks(footer).map((b) => b.part)).toEqual(expect.arrayContaining(["business", "cookies", "withdrawal"]));
      expect(pageInput.safeParse(footer).success).toBe(true);
    }
    expect(draftedLayout("store-1", "footer", { look: "simple", menuId: null }).rows[0].columns).toHaveLength(1);
  });
});

describe("a store drafted from one description (D351)", () => {
  it("takes a description, a front page and at most three more pages", () => {
    const ok = draftStoreInput.safeParse({ description: "We roast coffee in Bergen.", front: { purpose: "Welcome visitors" }, pages: [{ title: "About us", purpose: "Who we are" }] });
    expect(ok.success).toBe(true);
    expect(draftStoreInput.safeParse({ description: "Too short", front: { purpose: "x" } }).success).toBe(false);
    const many = Array.from({ length: 4 }, (_, i) => ({ title: `Page ${i}`, purpose: "x" }));
    expect(draftStoreInput.safeParse({ description: "We roast coffee in Bergen.", front: { purpose: "x" }, pages: many }).success).toBe(false);
  });

  it("takes the model's theme only by an id offered, and a preset only that theme's", () => {
    const options = [
      { id: "11111111-1111-4111-8111-111111111111", title: "Calm", summary: null, presets: [{ key: "coast", name: "Coast" }] },
      { id: "22222222-2222-4222-8222-222222222222", title: "Bold", summary: "Loud", presets: [] },
    ];
    expect(readThemeChoice('Sure: {"theme":"11111111-1111-4111-8111-111111111111","preset":"coast"}', options)).toEqual({ theme: options[0].id, preset: "coast" });
    expect(readThemeChoice('{"theme":"22222222-2222-4222-8222-222222222222","preset":"coast"}', options)).toEqual({ theme: options[1].id, preset: null });
    expect(readThemeChoice('{"theme":"33333333-3333-4333-8333-333333333333"}', options)).toBeNull();
    expect(readThemeChoice("Calm", options)).toBeNull();
  });
});
