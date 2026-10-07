import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Design profiles (D176, docs/design-profiles.md section 6): held by reading the source. A profile's layouts are made safe for another
 * store the same way a template is (D125/D127: `sanitizeTemplate()`) when the snapshot is taken; applying checks every page as the builder
 * does and leaves no other store's file in it; the preview places the layouts exactly as applying does; and only
 * `src/server/design-presets.ts` writes a profile or a use of one.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The body of a function declared in a file, up to the next top-level declaration. */
function body(source: string, name: string): string {
  const start = source.search(new RegExp(`export (async )?function ${name}\\b`));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + 10);
  const end = rest.search(/\n(export |async function |function |class |const |type )/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("design profiles go through the template's cleaning (D176)", () => {
  const lib = read("src/lib/design-presets.ts");
  const server = read("src/server/design-presets.ts");

  it("cleans a layout with sanitizeTemplate() when the snapshot is taken", () => {
    expect(body(lib, "snapshotLayout")).toContain("sanitizeTemplate(");
    expect(body(server, "takeSnapshot")).toContain("snapshotLayout(");
  });

  it("checks every page and file when applying, and places the layouts with layoutForStore()", () => {
    const apply = body(server, "applyDesignPreset");
    for (const call of ["parseDesignSnapshot(", "layoutForStore(", "pageInput.safeParse(", "pageRulesProblem(", "mapSnapshotMedia(", "leftoverStorageUrls(", "cssProblem(", "copyToLibrary("]) {
      expect(apply, call).toContain(call);
    }
  });

  it("draws the preview as applying places it, never by applying it", () => {
    const preview = read("src/app/admin/account/design-profiles/[presetId]/preview/page.tsx");
    expect(preview).toContain("layoutForStore(");
    expect(preview).not.toMatch(/import [^;]*\b(applyDesignPreset|saveStoreTheme|savePage)\b/);
  });

  it("writes profiles and their uses only in src/server/design-presets.ts", () => {
    const writers = sources("src").filter((path) =>
      /(insert\s+into|update|delete\s+from)\s+commerce\.design_preset(s|_uses)\b/i.test(read(path)),
    );
    expect(writers).toEqual(["src/server/design-presets.ts"]);
  });
});
