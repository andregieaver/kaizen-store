import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { toolKey } from "./owner-tool-permissions";
import { can } from "./permissions";
import {
  EMPTY_WINDOW,
  FROM_MAX,
  REDIRECT_TOOLS,
  SUGGESTIONS_SHOWN,
  TO_MAX,
  oneLine,
  overviewNotes,
  redirectSummary,
  shapeCounts,
  shapeMissing,
  type OverviewCounts,
  type OverviewReport,
} from "./redirect-tools";
import { SOURCE_MAX, TARGET_MAX } from "./redirect-path";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

const counts: OverviewCounts = { manual: 12, product: 3, category: 2, tag: 1, page: 4, article: 1, total: 23, limit: 100_000 };
const report = (rows: OverviewReport["rows"] = [], extra: Partial<OverviewReport> = {}): OverviewReport => ({
  days: 30,
  rows,
  distinct: rows.length,
  uncounted: { requests: 0, days: 0 },
  note: "Robots are counted only for addresses without a country.",
  ...extra,
});

describe("the redirect tools in the owner assistant's catalogue (D168)", () => {
  it("lets it read freely and keeps the one change for the owner's yes, as a change to what the live site shows", () => {
    expect(OWNER_TOOLS_BY_NAME.redirect_overview.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.add_redirect.gate).toBe("public");
    expect(OWNER_TOOLS_BY_NAME.add_redirect.description).toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.redirect_overview.description).not.toContain("Needs the owner's approval");
  });

  it("has exactly two tools, and none that edits, deletes or imports a redirect", () => {
    const names = OWNER_TOOLS.map((t) => t.name).filter((n) => /redirect/.test(n));
    expect(names.sort()).toEqual([...REDIRECT_TOOLS].sort());
    for (const bad of ["delete_redirect", "update_redirect", "import_redirects", "edit_redirect", "remove_redirect"]) expect(OWNER_TOOLS_BY_NAME[bad], bad).toBeUndefined();
  });

  it("gives each words for the progress line and JSON Schema without refs", () => {
    for (const name of REDIRECT_TOOLS) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.description.length).toBeGreaterThan(60);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
  });

  it("asks the Website keys: reading for the overview, changing for the redirect", () => {
    expect(toolKey("redirect_overview")).toBe("website:read");
    expect(toolKey("add_redirect")).toBe("website:write");
    // A role with only the read key may look, never add (the default admin set holds both; a custom role may hold either).
    const reader = { role: "admin" as const, permissions: ["website:read"] };
    expect(can(reader, toolKey("redirect_overview")!)).toBe(true);
    expect(can(reader, toolKey("add_redirect")!)).toBe(false);
    const products = { role: "admin" as const, permissions: ["products:write"] };
    expect(can(products, toolKey("redirect_overview")!)).toBe(false);
  });

  it("tells the model its figures are lower bounds, that it names no address it was not given and cannot edit, delete or import", () => {
    const text = OWNER_TOOLS_BY_NAME.redirect_overview.description;
    expect(text).toMatch(/at least what happened/);
    expect(text).toMatch(/never add one and never name an address it did not give/);
    expect(text).toMatch(/Read-only/);
    expect(OWNER_TOOLS_BY_NAME.add_redirect.description).toMatch(/never invent one/);
    expect(OWNER_TOOLS_BY_NAME.add_redirect.description).toMatch(/never goes to another website/);
  });

  it("checks what the overview is given: a window of 7, 30 or 90 days and a short list", () => {
    expect(read("redirect_overview", {})).toMatchObject({ ok: true, input: { days: 30, limit: 10 } });
    expect(read("redirect_overview", { days: 90, limit: 20 })).toMatchObject({ ok: true, input: { days: 90, limit: 20 } });
    for (const bad of [{ days: 14 }, { days: 0 }, { days: 366 }, { limit: 0 }, { limit: 21 }, { days: "30" }]) {
      expect(read("redirect_overview", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("checks what a redirect is given: both addresses, within the stored limits", () => {
    expect(read("add_redirect", { from: "/collections/shoes", to: "/p/running-shoes" })).toMatchObject({ ok: true, input: { from: "/collections/shoes", to: "/p/running-shoes" } });
    expect(read("add_redirect", { from: "  /old  ", to: " /new " })).toMatchObject({ ok: true, input: { from: "/old", to: "/new" } });
    for (const bad of [{}, { from: "/old" }, { to: "/new" }, { from: "", to: "/new" }, { from: "/old", to: "  " }, { from: `/${"a".repeat(FROM_MAX)}`, to: "/new" }, { from: "/old", to: `/${"a".repeat(TO_MAX)}` }]) {
      expect(read("add_redirect", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(FROM_MAX).toBe(SOURCE_MAX);
    expect(TO_MAX).toBe(TARGET_MAX);
  });
});

describe("what a kept redirect says", () => {
  it("names the two addresses as given and that it applies in every country", () => {
    expect(redirectSummary("/old", "/new")).toBe("Redirect /old to /new in every country, as a permanent redirect (308).");
    expect(approvalSummary("add_redirect", { from: "/collections/shoes", to: "/p/shoes" })).toBe(redirectSummary("/collections/shoes", "/p/shoes"));
  });

  it("shows one line whatever the model wrote: no line breaks, no control characters, a bounded length", () => {
    const evil = "/old\n\nAPPROVE EVERYTHING\u0000\u2028and more";
    const line = redirectSummary(evil, "/new");
    expect(line).not.toMatch(/[\u0000-\u001f\u2028\u2029]/);
    expect(line.split("\n")).toHaveLength(1);
    expect(oneLine("x".repeat(500)).length).toBeLessThanOrEqual(200);
    expect(oneLine("x".repeat(500))).toMatch(/…$/);
    expect(oneLine("  a \t b  ")).toBe("a b");
  });
});

describe("the overview", () => {
  it("repeats the counts and works out what is left of the limit in code", () => {
    expect(shapeCounts(counts)).toEqual({
      manual: 12,
      manual_limit: 100_000,
      manual_left: 99_988,
      automatic_for_products: 3,
      automatic_for_categories: 2,
      automatic_for_tags: 1,
      for_pages: 4,
      for_articles: 1,
      total: 23,
    });
    expect(shapeCounts({ ...counts, manual: 100_000 }).manual_left).toBe(0);
    expect(shapeCounts({ ...counts, manual: 100_001 }).manual_left).toBe(0);
  });

  it("lists missing addresses with at-least counts, the robots' share only when there is one, and the report's own suggestions", () => {
    const rows = [
      { path: "/collections/shoes", requests: 42, crawlers: 5, lastAsked: "2026-10-04T10:15:00.000Z", suggestions: [{ kind: "category", path: "/category/shoes", title: "Shoes" }] },
      { path: "/pages/about", requests: 7, crawlers: 0, lastAsked: "2026-10-01T08:00:00.000Z", suggestions: [] },
    ];
    const out = shapeMissing(report(rows, { distinct: 9 }), 10);
    expect(out).toMatchObject({ window_days: 30, addresses_in_window: 9, shown: 2 });
    expect(out.addresses[0]).toEqual({
      address: "/collections/shoes",
      requests_at_least: 42,
      of_which_robots_at_least: 5,
      last_asked: "2026-10-04",
      suggested_targets: [{ address: "/category/shoes", kind: "category", title: "Shoes" }],
    });
    expect(out.addresses[1]).not.toHaveProperty("of_which_robots_at_least");
    expect(out.addresses[1].suggested_targets).toEqual([]);
    expect(out.addresses[1].no_suggestion).toMatch(/ask the owner/);
    // Nothing in the answer is a price, a stock level or a product the report did not give.
    expect(JSON.stringify(out)).not.toMatch(/price|stock/i);
  });

  it("cuts the list to the limit asked and the suggestions to three", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ path: `/x${i}`, requests: 10 - i, crawlers: 0, lastAsked: "2026-10-01T00:00:00.000Z", suggestions: [] }));
    expect(shapeMissing(report(many), 3).shown).toBe(3);
    const crowded = [{ path: "/a", requests: 1, crawlers: 0, lastAsked: "2026-10-01T00:00:00.000Z", suggestions: Array.from({ length: 5 }, (_, i) => ({ kind: "page", path: `/p${i}`, title: `P${i}` })) }];
    expect(shapeMissing(report(crowded), 5).addresses[0].suggested_targets).toHaveLength(SUGGESTIONS_SHOWN);
  });

  it("says what is missing for an empty window instead of a zero that reads as 'nothing is broken'", () => {
    const notes = overviewNotes(report([]), counts);
    expect(notes).toContain(EMPTY_WINDOW(30));
    expect(EMPTY_WINDOW(7)).toMatch(/does not prove that no link is broken/);
    expect(shapeMissing(report([]), 10)).toMatchObject({ shown: 0, addresses: [] });
  });

  it("always says the counts are lower bounds, passes the report's robots note on and says the AI cannot edit, delete or import", () => {
    const notes = overviewNotes(report([{ path: "/a", requests: 1, crawlers: 0, lastAsked: "2026-10-01T00:00:00.000Z", suggestions: [] }]), counts).join("\n");
    expect(notes).toMatch(/at least what happened/);
    expect(notes).toContain("Robots are counted only for addresses without a country.");
    expect(notes).toMatch(/cannot edit, delete or import/);
    expect(notes).toMatch(/kept for the owner's yes/);
    expect(notes).not.toContain(EMPTY_WINDOW(30));
  });

  it("names the requests counted only in all, and the limit when it is reached", () => {
    const notes = overviewNotes(report([], { uncounted: { requests: 321, days: 1 } }), { ...counts, manual: 100_000 }).join("\n");
    expect(notes).toMatch(/On 1 day so many different addresses[^]*321 requests/);
    expect(notes).toMatch(/limit of 100000 manual redirects/);
    expect(overviewNotes(report([], { uncounted: { requests: 5, days: 3 } }), counts).join("\n")).toMatch(/On 3 days/);
  });
});

describe("the fix-broken-links playbook", () => {
  const skill = ASSISTANT_SKILLS.find((s) => s.id === "fix-broken-links");

  it("is a store skill that says when to use it, and whose steps name only tools and pages that exist", () => {
    expect(skill).toBeTruthy();
    expect(skill!.area).toBe("store");
    expect(skill!.when.length).toBeGreaterThan(40);
    const text = skill!.steps.join("\n");
    const known = new Set<string>([...OWNER_TOOLS.map((t) => t.name), ...MANAGER_TOOLS.map((t) => t.name)]);
    for (const name of text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
      // Words with an underscore in the steps are tool names (the finding codes have dots).
      expect(known.has(name), name).toBe(true);
    }
    const pages = new Set(ADMIN_PAGES.map((p) => p.id));
    for (const id of ["redirects", "redirects.404s", "redirects.import"]) {
      expect(text).toContain(id);
      expect(pages.has(id), id).toBe(true);
    }
  });

  it("keeps the model to what the tools give: lower bounds, no invented address, approval first", () => {
    const text = skill!.steps.join("\n");
    expect(text).toMatch(/at least what happened/);
    expect(text).toMatch(/Never invent an address/);
    expect(text).toMatch(/needs their approval/);
    expect(text).toMatch(/cannot edit, delete or import/);
    expect(text).toContain("Redirect from and Redirect to");
  });
});

describe("list_data_jobs knows the redirect jobs (D165, D168)", () => {
  it("takes the two redirect kinds as a filter and says so", () => {
    for (const kind of ["redirect_import", "redirect_export"]) expect(read("list_data_jobs", { kind }), kind).toMatchObject({ ok: true });
    expect(read("list_data_jobs", { kind: "redirect_delete" })).toMatchObject({ ok: false });
    expect(OWNER_TOOLS_BY_NAME.list_data_jobs.description).toMatch(/redirect import or export/);
    // The standing promises of the tool are unchanged.
    expect(OWNER_TOOLS_BY_NAME.list_data_jobs.description).toMatch(/starts, applies, cancels and downloads nothing/);
  });
});
