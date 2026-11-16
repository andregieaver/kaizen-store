import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the stylesheets and the code that names their colours must agree on (bloat review step 0.34; steps 0.35 and 2.11 add their
 * rules here). Two rules hold the admin's colour roles (`bg-card`, `border-line`, `text-ink`, `bg-brand` ...), which have a value of their
 * own only under html[data-admin]:
 *  1. Shop and site files (everything outside src/app/admin and src/components/admin that no admin import reaches) write the site's
 *     colour names (`border-border`, `bg-background`), never a role.
 *  2. An admin part that a public page imports (ActionForm, the print button, the on-site editor's fields) reads only roles that the
 *     block `:where(html:not([data-admin]))` in globals.css gives a value, and a role fixed to a literal colour has a dark value too.
 * A third rule keeps that block at specificity 0, so an owner's own `:root { --brand: ... }` still wins over it.
 */

const ROOT = join(__dirname, "../..");
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const rolesFrom = css.indexOf("The admin's colour roles");
const rolesTo = css.indexOf("The admin's type scale and shapes");
const ROLES = [...css.slice(rolesFrom, rolesTo).matchAll(/--color-([a-z0-9-]+): var\(--\1\);/g)].map((m) => m[1]);

const LIGHT = ":where(html:not([data-admin]))";
const DARK_SELECTORS = [':where(html:not([data-admin]):not([data-color-mode="light"]))', ':where(html:not([data-admin])[data-color-mode="dark"])'];

/** The text of the rule that starts at `selector`, up to its closing brace. */
function ruleText(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

/** Property name and value of every declaration of a rule. */
function declarations(selector: string): Map<string, string> {
  const text = ruleText(selector);
  return new Map([...text.slice(text.indexOf("{") + 1).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const lightMap = declarations(LIGHT);
const mapped = new Set(lightMap.keys());
const darkMapped = new Set(DARK_SELECTORS.flatMap((s) => [...declarations(s).keys()]));

/** Every admin colour role a text names as a Tailwind colour class. */
export function roleClasses(text: string): string[] {
  const roles = [...ROLES].sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(`(?<![\\w-])(?:[a-z0-9\\[\\]="-]+:)*(?:bg|text|border|ring|outline|divide|fill|stroke|accent|decoration|from|via|to)-(${roles})(?![\\w-])`, "g");
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function isAdmin(file: string): boolean {
  return file.startsWith("src/app/admin/") || file.startsWith("src/components/admin/");
}

/** The files a file imports by value (not `import type`), inside src and outside src/server. */
function imports(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const specs = [
    ...[...text.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^'"`;]*?\sfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  const found: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(file), spec) : null;
    if (!base) continue;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile()) {
        if (candidate.startsWith("src/") && !candidate.startsWith("src/server/")) found.push(candidate);
        break;
      }
    }
  }
  return found;
}

const everyFile = [...sourceFiles("src/app"), ...sourceFiles("src/components")];
const shopAndSite = everyFile.filter((f) => !isAdmin(f));

/** The admin files a public page draws: a breadth-first walk of value imports from every non-admin file, going on through admin files. */
function reachedAdminFiles(): Set<string> {
  const seen = new Set<string>(shopAndSite);
  const queue = [...shopAndSite];
  while (queue.length > 0) {
    for (const next of imports(queue.shift() as string)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return new Set([...seen].filter(isAdmin));
}
const reached = reachedAdminFiles();

/** Files of `reached` that read a role the block does not give a value, for the roles in `have`. */
function unmappedReaders(have: Set<string>): string[] {
  return [...reached].flatMap((file) => {
    const missing = [...new Set(roleClasses(readFileSync(join(ROOT, file), "utf8")))].filter((role) => !have.has(role));
    return missing.length > 0 ? [`${file}: ${missing.join(", ")}`] : [];
  });
}

describe("the colour roles outside the admin", () => {
  it("reads the roles and the block", () => {
    for (const role of ["line", "card", "brand", "danger-text"]) expect(ROLES).toContain(role);
    expect([...mapped].sort()).toEqual(["brand", "brand-ink", "canvas", "card", "danger-text", "edge", "ink", "ink-2", "inverse", "inverse-ink", "line", "sunken", "warning-text"]);
  });

  it("finds a role class and nothing that only looks like one", () => {
    expect(roleClasses('<i className="border-line hover:bg-sunken" />')).toEqual(["line", "sunken"]);
    expect(roleClasses("border-border bg-background text-inline")).toEqual([]);
  });

  it("walks the real imports to the admin parts a public page draws", () => {
    expect(reached).toContain("src/components/admin/action-form.tsx");
    expect(reached).toContain("src/components/admin/text-styles.tsx");
    // Drawn on the hosted invoice by src/components/work/hosted-invoice.tsx.
    expect(reached).toContain("src/components/admin/work/print-button.tsx");
  });

  it("rule 1: shop and site files speak the site's colour names, never an admin role", () => {
    const found = shopAndSite.flatMap((file) => {
      const classes = [...new Set(roleClasses(readFileSync(join(ROOT, file), "utf8")))];
      return classes.length > 0 ? [`${relative(".", file)}: ${classes.join(", ")}`] : [];
    });
    expect(found).toEqual([]);
  });

  it("rule 2: an admin part drawn outside the admin reads only roles that have a value there, in light and in dark", () => {
    expect(unmappedReaders(mapped)).toEqual([]);
    // A role fixed to a literal colour needs a dark value; the others follow site colours that have their own dark values.
    const fixedWithoutDark = [...lightMap].filter(([role, value]) => value.startsWith("#") && !darkMapped.has(role)).map(([role]) => role);
    expect(fixedWithoutDark).toEqual([]);
  });

  it("rule 2 would notice a role without a value", () => {
    const without = new Set([...mapped].filter((role) => role !== "brand"));
    expect(unmappedReaders(without).some((line) => line.startsWith("src/components/admin/action-form.tsx"))).toBe(true);
  });

  it("rule 3: the block is at specificity 0, so an owner's :root variables of the same names win", () => {
    for (const selector of [LIGHT, ...DARK_SELECTORS]) expect(css).toContain(selector);
    expect(css.match(/(?<!:where\()html:not\(\[data-admin\]\)/g) ?? []).toHaveLength(0);
  });
});
