import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Kaizena Flow's site in dark mode (D472), against real Postgres (PGlite): the migration turns D408's dark-mode colour, set to the site's
 * navy itself, into a light tint of it, adds the *Colour* text style's words to the rule, keeps each CSS's version first, and leaves CSS
 * without the rule as it is. Run again, it changes nothing.
 */

const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261106140451_platform_dark_navy.sql"), "utf8");

/** The site's CSS as production held it (D408's rule, its colour changed to the navy on 4 November 2026). */
const BEFORE = `.white-bg div{background:#fff}

/* Dark mode: the green words where no light row is behind them (D408). */
:root[data-color-mode="dark"] .green-text:not(.kz-on-light .green-text),
:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;
}

@media (prefers-color-scheme: dark){
:root:not([data-color-mode="light"]) .green-text:not(.kz-on-light .green-text),
:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;
}
}`;

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

const css = async (where: "platform" | "house") =>
  (await db.query<{ css: string }>(where === "platform" ? "select custom_css as css from commerce.platform_settings" : "select custom_css as css from commerce.stores where house")).rows[0].css;
const versions = async () => (await db.query<{ n: number }>("select count(*)::int as n from commerce.css_versions")).rows[0].n;

describe("Kaizena Flow's site in dark mode (D472)", () => {
  it("makes the highlighted words a light tint of the navy in dark mode, the Colour style's too, keeping the versions", async () => {
    await db.query("update commerce.platform_settings set custom_css = $1", [BEFORE]);
    await db.query("update commerce.stores set custom_css = $1 where house", [BEFORE]);
    const before = await versions();
    await db.exec(MIGRATION);
    for (const where of ["platform", "house"] as const) {
      const after = await css(where);
      expect(after).not.toContain("#2A2A72");
      expect(after.match(/color:#9E9EDB;/g)).toHaveLength(2);
      expect(after).toContain(':root[data-color-mode="dark"] .ts-colour:not(.kz-on-light .ts-colour){');
      expect(after).toContain(':root:not([data-color-mode="light"]) .ts-colour:not(.kz-on-light .ts-colour){');
      expect(after).toContain("in a light tint of the site's navy (D408, D472)");
      expect(after.startsWith(".white-bg div{background:#fff}")).toBe(true);
    }
    expect((await versions()) - before).toBe(2);
    const { rows } = await db.query<{ css: string }>("select css from commerce.css_versions where store_id is null order by created_at desc limit 1");
    expect(rows[0].css).toBe(BEFORE);
  });

  it("changes nothing when run again, nor CSS without the rule", async () => {
    const platform = await css("platform");
    const before = await versions();
    await db.exec(MIGRATION);
    expect(await css("platform")).toBe(platform);
    expect(await versions()).toBe(before);
    await db.query("update commerce.platform_settings set custom_css = '.x{color:#2A2A72}'");
    await db.exec(MIGRATION);
    expect(await css("platform")).toBe(".x{color:#2A2A72}");
  });
});
