import { describe, expect, it } from "vitest";

import { parseFrontMatter, parseValue, readFrontMatter } from "./docs-front-matter";

describe("the docs' front matter (D442)", () => {
  it("reads the spec's example: scalars, numbers, dates, lists and comments", () => {
    const source = [
      "---",
      "title: Price a product on request",
      "summary: Show no price and let shoppers ask for a quote instead.",
      "track: owners            # owners | developers",
      "section: products",
      "kind: how-to             # tutorial | how-to",
      "areas: [products, orders, quotes]",
      "features: []             # D178 features the page needs, if any",
      "admin: /admin/{store}/products/{id}   # where in the admin",
      "order: 40",
      "checked: 2026-11-03      # when it was last checked",
      "sources: [D431, D433]    # internal",
      "---",
      "",
      "## Body",
    ].join("\n");
    const front = readFrontMatter(source);
    expect(front.problems).toEqual([]);
    expect(front.data).toEqual({
      title: "Price a product on request",
      summary: "Show no price and let shoppers ask for a quote instead.",
      track: "owners",
      section: "products",
      kind: "how-to",
      areas: ["products", "orders", "quotes"],
      features: [],
      admin: "/admin/{store}/products/{id}",
      order: 40,
      checked: "2026-11-03",
      sources: ["D431", "D433"],
    });
    expect(front.body).toBe("\n## Body");
    expect(front.bodyLine).toBe(14);
  });

  it("reads quoted values, with their escapes, and keeps a # inside them", () => {
    expect(parseValue('"a: b # not a comment"')).toBe("a: b # not a comment");
    expect(parseValue("'it''s'")).toBe("it's");
    expect(parseValue('"say \\"hi\\" \\\\ there"   # comment')).toBe('say "hi" \\ there');
    expect(parseValue('["a, b", c, \'d\']')).toEqual(["a, b", "c", "d"]);
    expect(parseValue("C#")).toBe("C#");
    expect(parseValue("404 errors")).toBe("404 errors");
    expect(parseValue("007")).toBe(7);
  });

  it("refuses what it does not read, naming the line", () => {
    const { problems } = parseFrontMatter(["title: x", "title: y", "areas:", "  - a", "not a key line", "kind: |", "tags: [a, [b]]", "x: [a, b", 'y: "open', "z: {a: 1}"], 2);
    expect(problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(problems[0].message).toMatch(/twice/);
    expect(problems[1].message).toMatch(/no value/);
    expect(problems[2].message).toMatch(/indented/);
  });

  it("treats a file without front matter as body alone, and an unclosed one as a problem", () => {
    expect(readFrontMatter("## Just a body")).toMatchObject({ data: null, body: "## Just a body", problems: [] });
    expect(readFrontMatter("---\ntitle: x\n").problems[0].message).toMatch(/not closed/);
    expect(readFrontMatter("﻿---\r\ntitle: x\r\n---\r\nbody").data).toEqual({ title: "x" });
  });
});
