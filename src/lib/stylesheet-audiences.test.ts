import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { audienceTable, classAudience, overLine } from "../../docs/audits/bloat-review-2026-11/scripts/stylesheet-audiences.mjs";

/** Step 1.23: the audience of a class, the two lines the script fails above, and the byte counts of a planted sheet. */
describe("classAudience", () => {
  it("decides by who names the class", () => {
    expect(classAudience(new Set(["store"]))).toBe("store");
    expect(classAudience(new Set(["store", "admin"]))).toBe("store");
    expect(classAudience(new Set(["admin"]))).toBe("admin-only");
    expect(classAudience(new Set(["platform"]))).toBe("platform-only");
    expect(classAudience(new Set(["platform", "other"]))).toBe("platform-only");
    expect(classAudience(new Set(["editor"]))).toBe("editor-only");
    expect(classAudience(new Set(["editor", "admin"]))).toBe("editor-only");
    expect(classAudience(new Set(["platform", "editor"]))).toBe("platform+editor");
    expect(classAudience(undefined)).toBe("unknown");
  });
});

describe("overLine", () => {
  it("fails above 25,000 bytes raw or 4,200 Brotli, and on the admin's share only once the sheet is split", () => {
    expect(overLine({ noStoreRaw: 24000, noStoreBrotli: 4100, adminOnlyRaw: 50000 }, false)).toBeNull();
    expect(typeof overLine({ noStoreRaw: 25001, noStoreBrotli: 4100, adminOnlyRaw: 0 }, false)).toBe("string");
    expect(typeof overLine({ noStoreRaw: 24000, noStoreBrotli: 4201, adminOnlyRaw: 0 }, false)).toBe("string");
    expect(overLine({ noStoreRaw: 25000, noStoreBrotli: 4200, adminOnlyRaw: 0 }, true)).toBeNull();
    expect(overLine({ noStoreRaw: 0, noStoreBrotli: 0, adminOnlyRaw: 1 }, true)).toMatch(/admin/);
  });
});

describe("audienceTable", () => {
  const sheet =
    "@layer utilities{.a{color:red}.b{color:blue}.c{color:green}@media (min-width:40rem){.sm\\:a{color:red}}.d{color:black}}";
  const tokens = new Map([
    ["a", new Set(["store"])],
    ["b", new Set(["admin"])],
    ["c", new Set(["platform"])],
    ["sm:a", new Set(["editor"])],
  ]);
  const table = audienceTable(sheet, tokens);
  const rule = (css: string) => (postcss.parse(css).first as postcss.Rule).toString();

  it("counts the rules of each audience", () => {
    const rules = Object.fromEntries(table.rows.map((r: { audience: string; rules: number }) => [r.audience, r.rules]));
    expect(rules).toMatchObject({ store: 1, "admin-only": 1, "platform-only": 1, "editor-only": 1, unknown: 1 });
  });

  it("counts the bytes of the admin's share, and of what no store page can draw with a media rule wrapped", () => {
    expect(table.adminOnlyRaw).toBe(rule(".b{color:blue}").length);
    const wrapped = `@media (min-width:40rem){${rule(".sm\\:a{color:red}")}}`;
    expect(table.noStoreRaw).toBe(rule(".c{color:green}").length + wrapped.length);
    expect(table.noStoreBrotli).toBeGreaterThan(0);
  });
});
