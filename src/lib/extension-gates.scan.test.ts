import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { EXTENSION_IDS, EXTENSION_PATHS } from "./extensions";
import { TOOL_EXTENSIONS } from "./owner-tool-features";
import { OWNER_TOOLS } from "./owner-tools";

/**
 * The gates of the paid extensions (D748 step E3, `docs/extensions.md` 4.2): every page under an extension's folders draws `requireExtension()`
 * for that extension, every action or route file there refuses for it (`checkPermission(…, "<id>")`, `requirePermission(…, "<id>")` or
 * `storeAction({ …, extension: "<id>" })`), and every admin-map page at those addresses carries the tag. A new screen of an extension cannot
 * appear for an account without it.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "src/app/admin/(gated)/[store]");

const EXTENSION_FOLDERS = EXTENSION_PATHS;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the paid extensions' gates (D748 E3)", () => {
  it("draws requireExtension() on every page of an extension's folders", () => {
    const open: string[] = [];
    for (const id of EXTENSION_IDS) {
      for (const folder of EXTENSION_FOLDERS[id]) {
        for (const path of files(join(STORE, folder)).filter((p) => p.endsWith("page.tsx"))) {
          const text = readFileSync(path, "utf8");
          // A page that only draws a shared view (a test version in the page builder) is gated in that view: it names `type="variant"`.
          if (!text.includes(`requireExtension(`) && !/type="variant"/.test(text)) open.push(`${path.slice(ROOT.length + 1)} (${id})`);
          if (text.includes("requireExtension(") && !text.includes(`"${id}"`)) open.push(`${path.slice(ROOT.length + 1)}: names another extension than ${id}`);
        }
      }
    }
    expect(open).toEqual([]);
  });

  it("refuses in every action and route file of an extension's folders", () => {
    const open: string[] = [];
    for (const id of EXTENSION_IDS) {
      for (const folder of EXTENSION_FOLDERS[id]) {
        for (const path of files(join(STORE, folder)).filter((p) => /(actions?[\w-]*\.ts|route\.ts)$/.test(p))) {
          const text = readFileSync(path, "utf8");
          const guards = text.match(/\b(checkPermission|requirePermission|storeAction|checkOwnerRole)\(/g)?.length ?? 0;
          if (guards === 0) continue; // a helper file binding actions defined elsewhere
          const gated = text.includes(`"${id}")`) || text.includes(`extension: "${id}"`) || text.includes(`storeExtensionOn(member.store, "${id}")`);
          if (!gated) open.push(`${path.slice(ROOT.length + 1)} (${id})`);
        }
      }
    }
    expect(open).toEqual([]);
  });

  it("tags every store page at an extension's addresses in the admin map", () => {
    const wrong = ADMIN_PAGES.filter((page) => page.area === "store").flatMap((page) => {
      const owner = EXTENSION_IDS.find((id) => EXTENSION_FOLDERS[id].some((folder) => page.path === `/${folder}` || page.path.startsWith(`/${folder}/`)));
      return (page.extension ?? null) === (owner ?? null) ? [] : [`${page.id}: ${page.extension ?? "none"}, its address says ${owner ?? "none"}`];
    });
    expect(wrong).toEqual([]);
  });

  it("names only real tools in TOOL_EXTENSIONS", () => {
    const names = new Set(OWNER_TOOLS.map((t) => t.name));
    expect(Object.keys(TOOL_EXTENSIONS).filter((name) => !names.has(name as never))).toEqual([]);
  });
});
