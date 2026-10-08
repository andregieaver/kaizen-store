import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BACKGROUND_IDS, ENTER_IDS, GRADIENT_FLOWS, GRADIENT_STYLES, HOVER_IDS, SCROLL_IDS } from "./motion";

/**
 * The catalogue (`motion.ts`) and the stylesheet (`src/app/motion.css`) are two halves of one thing: an effect an owner can
 * pick that the stylesheet does not draw would silently do nothing.
 */
const css = readFileSync(join(process.cwd(), "src/app/motion.css"), "utf8");
const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const selectorFor = (attribute: string, id: string) => new RegExp(`\\[data-fx-${attribute}="${id}"\\]`);

describe("motion.css", () => {
  it("is imported by the global stylesheet, after Tailwind", () => {
    expect(globals.indexOf('@import "./motion.css"')).toBeGreaterThan(globals.indexOf('@import "tailwindcss"'));
  });

  it.each(ENTER_IDS)("draws the entrance %s", (id) => expect(css).toMatch(selectorFor("enter", id)));
  it.each(HOVER_IDS)("draws the hover effect %s", (id) => expect(css).toMatch(selectorFor("hover", id)));
  it.each(SCROLL_IDS)("draws the scroll effect %s", (id) => expect(css).toMatch(selectorFor("scroll", id)));
  it.each(BACKGROUND_IDS)("draws the background effect %s", (id) => {
    const scrolls = ["parallax", "zoom-scroll", "blur-scroll", "fade-scroll"].includes(id);
    expect(css).toMatch(selectorFor(scrolls ? "scroll" : "bgm", scrolls ? `bg-${id}` : id));
  });
  it.each(Object.keys(GRADIENT_STYLES))("draws the gradient %s", (id) => expect(css).toMatch(selectorFor("grad", id)));
  it.each(Object.keys(GRADIENT_FLOWS).filter((f) => f !== "still"))("times the flow %s", (id) =>
    expect(css).toMatch(selectorFor("flow", id)),
  );

  it("has a keyframes rule for every animation it names", () => {
    const declared = new Set([...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const m of css.matchAll(/--fx-(?:en|sn|fn):\s*([\w-]+);/g)) used.add(m[1]);
    for (const m of css.matchAll(/animation:\s*([\w-]+)\s/g)) used.add(m[1]);
    used.delete("none");
    expect(used.size).toBeGreaterThan(15);
    for (const name of used) expect(declared, `@keyframes ${name}`).toContain(name);
  });

  it("puts every effect where 'reduce motion' turns it off, and never animates layout", () => {
    // Everything that moves is inside `prefers-reduced-motion: no-preference`; the ones outside are structure and the no-script rule.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {2}\}\n/g, "");
    expect(outside).not.toMatch(/animation-name|animation:\s*fx-(?:in|slide|turn|blob|failsafe)\b/);
    const layout = /(?:^|[\s{;])(?:width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*)\s*:[^;{}]*;/;
    for (const keyframes of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n {2,4}\}\n/g))
      expect(keyframes[1]).not.toMatch(layout);
  });

  it("shows everything without scripts, and lets the runtime stand the failsafe down", () => {
    expect(css).toContain("@media (scripting: none)");
    expect(css).toContain("html:not([data-fx-ready])");
    expect(css).toMatch(/fx-failsafe 400ms ease 4s/);
  });

  it("times an entrance by its own duration and delay (D179 phase 3), never by a parent's", () => {
    expect(css).toMatch(/@property --fx-duration \{\s*syntax: "\*";\s*inherits: false;\s*\}/);
    expect(css).toContain("--fx-dur: var(--fx-duration, 700ms);");
    expect(css).toContain("animation-delay: calc(var(--fx-delay, 0ms)");
  });

  it("uses no file of its own: colours, gradients and an inline noise only", () => {
    const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^"data:image\/svg\+xml,/);
    expect(css).not.toMatch(/@import/);
  });
});
