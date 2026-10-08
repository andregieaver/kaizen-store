/**
 * For tests: what the part stylesheet (D179, `part-css.ts`) gives an element at a window width, read from the CSS as the
 * browser would (rules in order, a condition held or not, important declarations over normal ones). Only the shapes
 * `renderPartCss()` writes are read: `:where(.class…){…}`, `.class…{…}` and `@media (…){…}` around them.
 */

type Rule = { selectors: string[]; body: string; condition: string | null };

function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  const read = (until: number, condition: string | null) => {
    while (i < until) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= until) break;
      const head = css.slice(i, open).trim();
      if (head.startsWith("@media") || head.startsWith("@container")) {
        // The block's end: the brace that closes it.
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === "{") depth += 1;
          else if (css[j] === "}") depth -= 1;
          j += 1;
        }
        i = open + 1;
        read(j - 1, head.replace(/^@(media|container)( kz-page)?\s*/, ""));
        i = j;
        continue;
      }
      const close = css.indexOf("}", open);
      out.push({ selectors: head.split(/,(?![^(]*\))/).map((s) => s.trim()), body: css.slice(open + 1, close), condition });
      i = close + 1;
    }
  };
  read(css.length, null);
  return out;
}

/** Whether a condition such as `(width < 768px)` or `(768px <= width < 1024px)` holds at a width. */
function holds(condition: string | null, width: number): boolean {
  if (condition === null) return true;
  let m = /^\(width < (\d+)px\)$/.exec(condition);
  if (m) return width < Number(m[1]);
  m = /^\(width >= (\d+)px\)$/.exec(condition);
  if (m) return width >= Number(m[1]);
  m = /^\((\d+)px <= width < (\d+)px\)$/.exec(condition);
  if (m) return width >= Number(m[1]) && width < Number(m[2]);
  throw new Error(`Cannot read the condition ${condition}`);
}

/** The selector without `:where()`, as written for the element itself (`.kzr-x`), or null for one about another element. */
const own = (selector: string, classes: string[]): boolean => {
  const bare = selector.replace(/^:where\((.*)\)$/, "$1");
  return /^\.[\w-]+$/.test(bare) && classes.includes(bare.slice(1));
};

/** The declarations the element with these classes gets from the stylesheet at a window width. */
export function partStyleAt(css: string, classes: string[], width: number, selector?: (s: string) => boolean): Record<string, string> {
  const normal: Record<string, string> = {};
  const important: Record<string, string> = {};
  for (const rule of rulesOf(css)) {
    if (!holds(rule.condition, width)) continue;
    if (!rule.selectors.some((s) => (selector ? selector(s) : own(s, classes)))) continue;
    for (const declaration of rule.body.split(";")) {
      const at = declaration.indexOf(":");
      if (at <= 0) continue;
      const property = declaration.slice(0, at).trim();
      let value = declaration.slice(at + 1).trim();
      const isImportant = /!important$/.test(value);
      value = value.replace(/\s*!important$/, "");
      if (value === "revert-layer") {
        delete (isImportant ? important : normal)[property];
        continue;
      }
      (isImportant ? important : normal)[property] = value;
    }
  }
  return { ...normal, ...important };
}

/** Every stylesheet the markup holds (`<style …>…</style>`), as one. */
export const cssOfMarkup = (html: string): string => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

/** The window widths the parity check and the tests draw at, one inside each default size. */
export const WIDTHS = { sm: 375, md: 800, lg: 1100, xl: 1400 } as const;
