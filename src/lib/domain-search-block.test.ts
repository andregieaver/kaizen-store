import { describe, expect, it } from "vitest";

import { newPageContent, pageInput } from "./page-content";
import { newBlock } from "./page-rows";
import { mapBlockTexts } from "./page-translation";
import { textRoles } from "./typography";

const page = (block: unknown) => ({
  ...newPageContent(),
  title: "Domains",
  slug: "domains",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
});

describe("the domain search component (D315 16)", () => {
  it("starts empty, so the page's language gives its words", () => {
    expect(newBlock("domainSearch", () => "d")).toEqual({ id: "d", type: "domainSearch", buttonLabel: "", ctaLabel: "", ctaHref: "" });
  });

  it("keeps the endings it is given as endings, and refuses anything else", () => {
    const parsed = pageInput.parse(page({ ...newBlock("domainSearch", () => "d"), tlds: [".COM", "shop"], currency: "NOK", heading: "Find your domain" }));
    expect(parsed.rows[0].columns[0].blocks[0]).toMatchObject({ type: "domainSearch", tlds: ["com", "shop"], currency: "NOK", heading: "Find your domain" });
    expect(pageInput.safeParse(page({ ...newBlock("domainSearch", () => "d"), tlds: ["not an ending"] })).success).toBe(false);
    expect(pageInput.safeParse(page({ ...newBlock("domainSearch", () => "d"), tlds: Array.from({ length: 9 }, (_, i) => `t${"abcdefghi"[i]}x`) })).success).toBe(false);
    expect(pageInput.safeParse(page({ ...newBlock("domainSearch", () => "d"), ctaHref: "javascript:alert(1)" })).success).toBe(false);
  });

  it("has its words translated, and every one of its texts styled", () => {
    const seen: string[] = [];
    mapBlockTexts({ id: "d", type: "domainSearch", heading: "Find it", buttonLabel: "Search", ctaLabel: "Get it", ctaHref: "" }, (key, value) => (seen.push(key), value));
    expect(seen).toEqual(["block.d.heading", "block.d.buttonLabel", "block.d.ctaLabel"]);
    expect(textRoles({ id: "d", type: "domainSearch", buttonLabel: "", ctaLabel: "", ctaHref: "" }).map((r) => r.role)).toEqual(["text", "title", "input", "button", "name", "price"]);
  });
});
