import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_ROLES, ADMIN_SCHEMES, adminScheme, adminSchemeScript, CONTRAST_RULES, DEFAULT_ADMIN_SCHEME, isOfferedScheme, SHADOW_ROLES } from "@/lib/admin-schemes";
import { contrastRatio } from "@/lib/theme";

/**
 * The admin's colour schemes (docs/admin-style.md, section 7.1): every registered scheme is a stylesheet the admin's root layout
 * imports, sets every colour role in light and in dark (the two dark blocks the same), writes colours as plain hex, and keeps every
 * pair of `CONTRAST_RULES` readable in both modes. And `admin.css`, which reads the roles, holds no colour of its own.
 */

const dir = join(__dirname, "schemes");
const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
const adminCss = readFileSync(join(__dirname, "admin.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Block = { selector: string; dark: boolean; props: Map<string, string> };

/** The rule blocks of a scheme's stylesheet, with whether each is for dark colours and its custom properties. */
function blocks(source: string): Block[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Block[] = [];
  const walk = (text: string, inDarkMedia: boolean) => {
    let depth = 0;
    let start = 0;
    let head = "";
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "{") {
        if (depth === 0) {
          head = text.slice(start, i).trim();
          start = i + 1;
        }
        depth += 1;
      } else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const body = text.slice(start, i);
          if (head.startsWith("@media")) walk(body, inDarkMedia || /prefers-color-scheme:\s*dark/.test(head));
          else {
            const props = new Map<string, string>();
            for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) props.set(m[1], m[2].trim());
            out.push({ selector: head, dark: inDarkMedia || /\[data-color-mode="dark"\]/.test(head), props });
          }
          start = i + 1;
        }
      }
    }
  };
  walk(css, false);
  return out;
}

const HEX = /^#[0-9a-f]{6}$/;

describe.each(ADMIN_SCHEMES.map((s) => [s.id, s] as const))("the admin's colour scheme %s", (id) => {
  const file = join(dir, `${id}.css`);

  it("is a stylesheet the admin's root layout imports before admin.css", () => {
    expect(existsSync(file), file).toBe(true);
    const at = layout.indexOf(`import "./schemes/${id}.css"`);
    expect(at, `the layout imports ./schemes/${id}.css`).toBeGreaterThan(-1);
    expect(at).toBeLessThan(layout.indexOf('import "./admin.css"'));
  });

  const all = existsSync(file) ? blocks(readFileSync(file, "utf8")) : [];
  const light = all.filter((b) => !b.dark);
  const dark = all.filter((b) => b.dark);

  it("has one light block and two dark ones (the device's and the person's choice), each scoped to the admin and to this scheme", () => {
    expect(light).toHaveLength(1);
    expect(dark).toHaveLength(2);
    for (const block of all) {
      expect(block.selector.startsWith("html[data-admin]"), block.selector).toBe(true);
      expect(block.selector).toContain(`[data-admin-scheme="${id}"]`);
      // Only the default scheme also answers an <html> that names none.
      expect(block.selector.includes(":not([data-admin-scheme])")).toBe(id === DEFAULT_ADMIN_SCHEME);
    }
    expect(Object.fromEntries(dark[0].props)).toEqual(Object.fromEntries(dark[1].props));
  });

  it("also applies to a preview element, in light and in dark, so the Appearance page can draw it (D222)", () => {
    expect(light[0].selector).toContain(`[data-scheme-preview="${id}"]`);
    expect(dark.some((b) => b.selector.includes(`[data-scheme-preview="${id}"][data-preview-mode="dark"]`))).toBe(true);
    // The device's dark never reaches a preview: a preview is light or dark by its own mark only.
    expect(dark.find((b) => b.selector.includes("@media") || !b.selector.includes("[data-color-mode=\"dark\"]"))?.selector ?? "").not.toContain("data-scheme-preview");
  });

  it.each([
    ["light", () => light[0]],
    ["dark", () => dark[0]],
  ] as const)("sets every colour role and shadow in %s, colours as plain hex", (_, block) => {
    const props = block()?.props ?? new Map<string, string>();
    for (const role of ADMIN_ROLES) {
      expect(props.has(role), `--${role}`).toBe(true);
      expect(props.get(role), `--${role}`).toMatch(HEX);
    }
    for (const shadow of SHADOW_ROLES) expect(props.has(shadow), `--${shadow}`).toBe(true);
  });

  it.each([
    ["light", () => light[0]],
    ["dark", () => dark[0]],
  ] as const)("keeps every text and mark readable in %s", (_, block) => {
    const props = block()?.props ?? new Map<string, string>();
    for (const [fg, bg, min, what] of CONTRAST_RULES) {
      const a = props.get(fg);
      const b = props.get(bg);
      if (!a || !b) throw new Error(`${what}: --${fg} or --${bg} is not set`);
      const ratio = contrastRatio(a, b);
      expect(ratio, `${what}: ${a} on ${b} is ${ratio.toFixed(2)}:1, under ${min}:1`).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("the admin's colour schemes together", () => {
  it("have distinct ids, and the default is the first", () => {
    expect(new Set(ADMIN_SCHEMES.map((s) => s.id)).size).toBe(ADMIN_SCHEMES.length);
    expect(DEFAULT_ADMIN_SCHEME).toBe(ADMIN_SCHEMES[0].id);
  });

  it("leave admin.css without a colour of its own: it reads the roles only", () => {
    expect(adminCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(adminCss).not.toMatch(/\brgba?\(/);
    expect(adminCss).not.toMatch(/\bhsla?\(/);
  });

  it("give the admin's older names their roles, above the site's own light and dark values", () => {
    for (const [legacy, role] of [
      ["background", "card"],
      ["foreground", "ink"],
      ["surface", "sunken"],
      ["border", "line"],
      ["brand-solid", "brand"],
      ["accent", "brand"],
      ["accent-foreground", "brand-ink"],
      ["admin-canvas", "canvas"],
    ]) {
      expect(adminCss).toContain(`--${legacy}: var(--${role});`);
    }
    // `globals.css` sets these on `:root` and `:root:not([data-color-mode="light"])` (0,2,0): `html[data-admin]:root` (0,2,1) outranks both.
    expect(adminCss).toMatch(/html\[data-admin\]:root \{/);
  });
});

describe("choosing a scheme (D221)", () => {
  it("keeps the account's check in step with the registry: every scheme can be saved, nothing else", () => {
    const schema = readFileSync(join(__dirname, "../../db/schema.ts"), "utf8");
    const check = schema.match(/accounts_admin_scheme", sql`\$\{t\.adminScheme\} in \(([^)]*)\)/)?.[1] ?? "";
    expect(check.split(",").map((v) => v.trim().replace(/'/g, "")).sort()).toEqual(ADMIN_SCHEMES.map((s) => s.id).sort());
  });

  it("offers indigo beside meadow, and falls back to the default for an id it does not know", () => {
    expect(isOfferedScheme("indigo")).toBe(true);
    expect(isOfferedScheme("sepia")).toBe(false);
    expect(isOfferedScheme(null)).toBe(false);
    expect(adminScheme("sepia").id).toBe(DEFAULT_ADMIN_SCHEME);
    expect(adminScheme("indigo").id).toBe("indigo");
  });

  it("writes only an offered scheme's id on <html> before the page is drawn", () => {
    const run = (saved: string | null) => {
      const attrs: Record<string, string> = {};
      const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      const localStorage = { getItem: () => saved };
      new Function("document", "localStorage", adminSchemeScript())(document, localStorage);
      return attrs["data-admin-scheme"];
    };
    expect(run("indigo")).toBe("indigo");
    expect(run("sepia")).toBeUndefined();
    expect(run('"><script>')).toBeUndefined();
    expect(run(null)).toBeUndefined();
  });
});
