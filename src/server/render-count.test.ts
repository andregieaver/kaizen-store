import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { renderFields } = await import("./render-count");

/** The admin.render line carries counts only (bloat review step 1.9, D400): no path, account, store or statement text. */
describe("admin.render", () => {
  it("passes only the fields statements and ms", () => {
    const layout = readFileSync("src/app/admin/(gated)/layout.tsx", "utf8");
    expect(layout).toContain('log("info", "admin.render", renderFields(counted))');
    const source = readFileSync("src/server/render-count.ts", "utf8");
    const body = source.slice(source.indexOf("export function renderFields"));
    expect(body).toContain("return { statements: counted.statements, ms: Math.round(performance.now() - counted.started) };");
    expect(renderFields({ statements: 3, started: performance.now() })).toEqual({ statements: 3, ms: expect.any(Number) });
  });

  it("keeps the counter itself free of logging", () => {
    const counter = readFileSync("src/db/statement-count.ts", "utf8");
    expect(counter).not.toMatch(/\blog\(/);
    expect(counter).not.toMatch(/console\./);
  });
});
