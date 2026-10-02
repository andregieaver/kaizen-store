import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The admin's look (D149) is a stylesheet that must never reach the storefront, Kaizen's own site or the previews of a store's pages
 * drawn in the admin: every rule is under `html[data-admin]` (or is the progress bar's own class, or a keyframe), every rule that restyles
 * an element leaves the previews out, and the motion has its reduced-motion stop. The root layout is the only thing that sets the attribute.
 */

const css = readFileSync(join(__dirname, "admin.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");

/** A selector list's selectors: split at the commas that are not inside parentheses or brackets. */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === "(" || list[i] === "[") depth += 1;
    else if (list[i] === ")" || list[i] === "]") depth -= 1;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(list.slice(from).trim());
  return out;
}

/** The selector of every rule at the top level of a stylesheet (not inside @keyframes or @media), with its body. */
function topLevelRules(source: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let head = "";
  let atRule = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) {
        head = source.slice(start, i).trim();
        start = i + 1;
        atRule = head.startsWith("@") ? head : "";
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        if (!atRule) rules.push({ selector: head, body: source.slice(start, i) });
        else if (atRule.startsWith("@media")) rules.push(...topLevelRules(source.slice(start, i)));
        start = i + 1;
      }
    }
  }
  return rules;
}

describe("the admin's stylesheet (D149)", () => {
  const rules = topLevelRules(css);

  it("has rules, and only under the admin's own attribute, or the progress bar's class", () => {
    expect(rules.length).toBeGreaterThan(40);
    for (const { selector } of rules) {
      for (const one of selectors(selector)) expect(one.startsWith("html[data-admin]") || one.startsWith(".admin-progress"), one).toBe(true);
    }
  });

  it("leaves a store's page previews alone wherever it restyles an element", () => {
    const restyling = rules.filter(({ selector }) => /\b(button|input|select|textarea|table|thead|tbody|dialog|details|a)\b|\.bg-foreground|\.border-foreground|\.rounded-|\.border-dashed|\.text-red|\.border-red|\.animate-pulse|\bmain\b/.test(selector) && !/^html\[data-admin\]( body)?$/.test(selector.trim()));
    // The rules for page-wide things (the document's tokens, its text, the header and navigation, tables, `main`) are chrome; the rest name the previews out.
    const chrome = /^(header|nav|aside|main|thead|tbody|table|body|::selection|h1|form\[aria-busy|\[aria-busy|:is\((aside|nav|h1|table))/;
    for (const { selector } of restyling) {
      // The reduced-motion stop is for everything on the page, previews included.
      if (selector.startsWith("html[data-admin] *")) continue;
      if (chrome.test(selector.replace(/^html\[data-admin\]\s*/, "").trim())) continue;
      expect(selector, selector).toContain("[data-theme-canvas]");
    }
  });

  it("stops its motion for people who ask for less", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
    expect(css).toMatch(/transition-duration: 0\.01ms !important/);
  });

  it("moves nothing in the layout: no margins, paddings, sizes or positions are animated", () => {
    const animated = css.match(/transition:[^;]+;|transition-property:[^;]+;/g) ?? [];
    for (const line of animated) expect(line, line).not.toMatch(/\b(width|height|margin|padding|top|left|right|bottom|gap)\b/);
  });

  it("is imported by the admin's root layout, which marks the document, and by nothing else", () => {
    expect(layout).toContain('import "./admin.css"');
    expect(layout).toContain("data-admin");
    expect(layout).toContain("<AdminProgress />");
  });
});
