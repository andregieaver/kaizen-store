import { describe, expect, it } from "vitest";

import type { PageBlock, PageRow } from "./page-content";
import { whatChanges, type LookFacts } from "./theme-changes";

/** *What changes* (D244): what switching to an installed theme does to the store's pages, in sentences from facts. */

const heading = (extra: Record<string, unknown> = {}): PageBlock => ({ id: "h", type: "heading", text: "Hello", level: 2, ...extra }) as PageBlock;
const row = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }], ...extra });
const none = { id: null, title: null };

const look = (title: string, extra: Partial<LookFacts> = {}): LookFacts => ({
  title,
  elements: undefined,
  sections: undefined,
  fonts: [],
  css: "",
  layouts: { header: none, footer: none, productLayout: none },
  ...extra,
});

describe("whatChanges()", () => {
  it("says nothing when the two looks agree on everything it can know", () => {
    const result = whatChanges(look("Custom"), look("Calm"), [{ title: "Home", rows: [row([heading()])] }]);
    expect(result.lines).toEqual([]);
    expect(result.layouts).toEqual([]);
  });

  it("names the layouts that change, by title or as the standard one", () => {
    const live = look("Custom", { layouts: { header: { id: "a", title: "Old header" }, footer: none, productLayout: none } });
    const target = look("Calm", { layouts: { header: none, footer: { id: "f", title: "Calm footer" }, productLayout: none } });
    const result = whatChanges(live, target, []);
    expect(result.lines).toEqual([
      "The header changes from “Old header” to the standard header.",
      "The footer changes from the standard footer to “Calm footer”.",
    ]);
  });

  it("counts the pages naming each section style and says what the other theme gives them", () => {
    const pages = [
      { title: "A", rows: [row([heading()], { sectionStyle: "hero" }), row([heading()], { id: "r2", sectionStyle: "quote" })] },
      { title: "B", rows: [row([heading()], { sectionStyle: "hero" })] },
      { title: "C", rows: [row([heading()], { sectionStyle: "promo" })] },
    ];
    const withPlain = whatChanges(look("Custom"), look("Calm", { sections: { hero: {}, plain: {} } }), pages);
    expect(withPlain.styles.map((s) => [s.name, s.pages, s.has])).toEqual([
      ["hero", 2, true],
      ["promo", 1, false],
      ["quote", 1, false],
    ]);
    expect(withPlain.lines).toContain("2 pages use the section style Hero; “Calm” has it.");
    expect(withPlain.lines).toContain("1 page uses the section style Promo; “Calm” does not have it, so those rows take its Plain style.");
    const withoutPlain = whatChanges(look("Custom"), look("Calm", { sections: { hero: {} } }), pages);
    expect(withoutPlain.lines).toContain("1 page uses the section style Quote; “Calm” has neither it nor a Plain style, so those rows take its site-wide elements.");
  });

  it("counts settings that are the owner's own against the other theme, and settings that only repeat the live one", () => {
    const size = (value: number) => ({ typography: { text: { size: { value, unit: "rem" as const } } } });
    const live = look("Custom", { elements: { h2: size(2) } });
    const target = look("Calm", { elements: { h2: size(3) } });
    // 2rem repeats the live theme (it will not follow Calm); 5rem is the owner's own against both.
    const pages = [{ title: "Home", rows: [row([heading(size(2)), heading({ id: "h2", ...size(5) })])] }];
    const result = whatChanges(live, target, pages);
    expect(result.repeating).toEqual({ settings: 1, pages: 1 });
    expect(result.own).toEqual({ settings: 2, pages: 1 });
    expect(result.lines).toContain("2 settings on 1 page are your own and stay as they are.");
    expect(result.lines.some((line) => line.startsWith("1 setting on 1 page only repeats your current theme") && line.includes("Let pages follow the theme"))).toBe(true);
  });

  it("names the fonts that come in and warns about CSS", () => {
    const result = whatChanges(look("Custom", { fonts: ["Inter"], css: ".a{color:red}" }), look("Calm", { fonts: ["Inter", "Lora"] }), []);
    expect(result.fontsAdded).toEqual(["Lora"]);
    expect(result.lines).toEqual([
      "“Calm” uses a font your current theme does not: Lora.",
      "Your current CSS stays with “Custom”; “Calm” has none.",
      "CSS written for one layout may not fit another: look at the preview before you switch.",
    ]);
  });
});
