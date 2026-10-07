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
  const start = source.search(new RegExp(`^(export )?(async )?function ${name}\\b`, "m"));
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
    // The placing is shared by applying and by writing a profile's workspace (D177): both go through placeSnapshot().
    const place = body(server, "placeSnapshot");
    for (const call of ["layoutForStore(", "pageInput.safeParse(", "pageRulesProblem(", "mapSnapshotMedia(", "leftoverStorageUrls(", "cssProblem(", "copyToLibrary("]) {
      expect(place, call).toContain(call);
    }
    const apply = body(server, "applyDesignPreset");
    for (const call of ["parseDesignSnapshot(", "placeSnapshot("]) expect(apply, call).toContain(call);
    expect(body(server, "writeWorkspaceLook")).toContain("placeSnapshot(");
  });

  it("publishes a profile's workspace through the same snapshot, cleaned as ever (D177)", () => {
    expect(body(server, "publishDesign")).toContain("takeSnapshot(");
    expect(body(server, "createDesign")).toContain("takeSnapshot(");
  });

  it("checks the platform admin and the profile's workspace in every action of the profile's editor (D177)", () => {
    const dir = "src/app/admin/(gated)/platform/design-profiles/[presetId]";
    const actions = read(`${dir}/workspace-actions.ts`);
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(10);
    for (const name of exported) {
      const fn = body(actions, name);
      // Either it checks (the admin and the workspace, or the admin before the server function checks the workspace), or it only refuses.
      const checks = /\bworkspace\(presetId\)|requirePlatformAdmin\(|saveWorkspaceCssAction\(presetId/.test(fn);
      const refusesOnly = !/\bawait\b/.test(fn);
      expect(checks || refusesOnly, name).toBe(true);
    }
    // Never a store's own actions: the builder's context binds the profile's.
    for (const file of [`${dir}/context.ts`, `${dir}/workspace-actions.ts`, `${dir}/layout-tab.tsx`]) {
      expect(read(file), file).not.toMatch(/from "[^"]*\[store\][^"]*"/);
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
