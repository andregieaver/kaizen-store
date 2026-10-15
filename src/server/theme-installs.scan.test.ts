import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Themes as one thing (D241, docs/theme-phase-1.md): held by reading the source. A store's installed themes are written only by
 * `src/server/theme-installs.ts` and `applyDesignPreset()`, a theme's versions only by `publishDesign()`; and the store's look columns
 * (`stores.theme`, `custom_css`, `header_id`, `footer_id`, `product_layout_id`), which are the live install's look, are written only by the
 * modules listed here, so phase 2 knows every writer it has to move. A new writer of the look is added to the list on purpose, with what it
 * writes, and must keep the live install in step (it writes the live look, never another install's).
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/test-support|fixture/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sources("src");

/**
 * The writers of Kaizena Flow's look columns: updating an installed theme and undoing it (D253), its fonts, switching, its CSS, its header and
 * footer, and the Theme tab and saved colours.
 */
const PLATFORM_LOOK_WRITERS = [
  "src/server/design-presets.ts",
  "src/server/fonts.ts",
  "src/server/platform-theme-installs.ts",
  "src/server/site-css.ts",
  "src/server/site-layouts.ts",
  "src/server/themes.ts",
];

/** What each writer of the store's look columns writes: everything else must not. */
const LOOK_WRITERS: Record<string, string> = {
  "src/server/design-presets.ts": "applying a theme, updating an installed theme to a new version (D245), putting the look back, and a theme's own workspace",
  "src/server/theme-installs.ts": "switching to an installed theme",
  "src/server/themes.ts": "the live theme's settings and saved themes (D60, D182, D183)",
  "src/server/fonts.ts": "the live theme's fonts (D59)",
  "src/server/site-css.ts": "the site's own CSS (D100)",
  "src/server/site-layouts.ts": "the chosen header and footer (D80)",
  "src/server/product-layouts.ts": "the store's standard product layout (D79)",
  "src/server/media-compress.ts": "addresses of compressed files (D213)",
};

/** The text of every `update commerce.stores … where` in a source, from `set` to `where`. */
function storeUpdates(source: string): string[] {
  return [...source.matchAll(/update\s+commerce\.stores\b([\s\S]*?)\bwhere\b/gi)].map((m) => m[1]);
}

const LOOK_COLUMN = /\b(theme|custom_css|header_id|footer_id|product_layout_id)\s*=|\$\{column\}\s*=/;

describe("who writes a store's look (D241)", () => {
  it("is only the modules that are listed", () => {
    const found = FILES.filter((file) => storeUpdates(read(file)).some((set) => LOOK_COLUMN.test(set)));
    expect(found.sort()).toEqual(Object.keys(LOOK_WRITERS).filter((file) => found.includes(file)).sort());
    for (const file of found) expect(LOOK_WRITERS[file], file).toBeDefined();
  });

  it("writes a store's installed themes only from the install code and applying", () => {
    const writes = /(insert\s+into|update|delete\s+from)\s+commerce\.store_theme_installs\b/i;
    const found = FILES.filter((file) => writes.test(read(file))).sort();
    expect(found).toEqual(["src/server/design-presets.ts", "src/server/theme-installs.ts"]);
  });

  it("writes Kaizena Flow's installed themes only from its install code and adding a theme to it (docs/theme-phase-4.md)", () => {
    const writes = /(insert\s+into|update|delete\s+from)\s+commerce\.platform_theme_installs\b/i;
    const found = FILES.filter((file) => writes.test(read(file))).sort();
    // Compressing a library file moves its address in the kept looks too (`rewriteAddresses()`), changing nothing else of them.
    expect(found).toEqual(["src/server/design-presets.ts", "src/server/media-compress.ts", "src/server/platform-theme-installs.ts"]);
  });

  it("writes Kaizena Flow's look columns only from the modules listed, so a new writer is a decision (docs/theme-phase-4.md)", () => {
    // The live install's look is `platform_settings`' theme, fonts, CSS, header and footer: switching keeps them, each writer writes the live look.
    const look = /update\s+commerce\.platform_settings\s+set\s+([^`]*)/gi;
    // A column chosen at run time (`set ${column} = …`, the header or footer choice) counts as a look column.
    const columns = /\b(theme|fonts|custom_css|header_id|footer_id)\s*=|^\s*\$\{/;
    const found = FILES.filter((file) => [...read(file).matchAll(look)].some((m) => columns.test(m[1]))).sort();
    expect(found).toEqual(PLATFORM_LOOK_WRITERS);
  });

  it("writes the updates of Kaizena Flow's installed themes only where they are made and undone (D253)", () => {
    const writes = /(insert\s+into|update|delete\s+from)\s+commerce\.platform_theme_install_updates\b/i;
    expect(FILES.filter((file) => writes.test(read(file))).sort()).toEqual(["src/server/design-presets.ts"]);
  });

  it("adds a theme's versions only when it is published", () => {
    const found = FILES.filter((file) => /insert\s+into\s+commerce\.design_preset_versions\b/i.test(read(file)));
    expect(found).toEqual(["src/server/design-presets.ts"]);
    const server = read("src/server/design-presets.ts");
    const publish = server.slice(server.indexOf("export async function publishDesign"), server.indexOf("export async function unpublishDesign"));
    expect(publish).toContain("insert into commerce.design_preset_versions");
    expect(server.match(/insert into commerce\.design_preset_versions/g)).toHaveLength(1);
  });

  it("keeps the look before when applying: the live install is put away before the new one is made live", () => {
    const server = read("src/server/design-presets.ts");
    const apply = server.slice(server.indexOf("export async function applyDesignPreset"), server.indexOf("class Refused"));
    const put = apply.indexOf("putAwayLive(");
    expect(put).toBeGreaterThan(0);
    expect(put).toBeLessThan(apply.indexOf("insert into commerce.store_theme_installs"));
    expect(put).toBeLessThan(apply.indexOf("update commerce.stores set theme"));
  });
});
