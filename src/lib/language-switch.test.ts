import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { flagOf, FLAG_COUNTRIES, languageCode } from "./language-flags";
import { sizesWhere, switcherAt } from "./language-switch";
import { pageBlockSchema, type SiteBlock } from "./page-content";
import { languageSwitchStyle, renderPartCss } from "./part-css";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const block = (extra: Partial<SiteBlock> = {}): SiteBlock => ({ id: "ls1", type: "site", part: "languages", ...extra });

describe("the language switcher's look by screen size (D474)", () => {
  it("is side by side, by name, without flags until set", () => {
    expect(switcherAt(block(), "xl")).toEqual({ layout: "row", text: "name", flag: false });
    expect(switcherAt(block(), "sm")).toEqual({ layout: "row", text: "name", flag: false });
  });

  it("passes a larger size's look down until a smaller one sets its own", () => {
    const b = block({ switcher: "row", langFlag: true, at: { md: { switcher: "dropdown", langText: "code" } } });
    expect(switcherAt(b, "lg")).toEqual({ layout: "row", text: "name", flag: true });
    expect(switcherAt(b, "md")).toEqual({ layout: "dropdown", text: "code", flag: true });
    expect(switcherAt(b, "sm")).toEqual({ layout: "dropdown", text: "code", flag: true });
    expect(sizesWhere(b, (look) => look.layout === "dropdown")).toEqual(["md", "sm"]);
  });

  it("shows a language's short code where it would have neither words nor a flag", () => {
    expect(switcherAt(block({ langText: "none", langFlag: true }), "xl").text).toBe("none");
    expect(switcherAt(block({ langText: "none" }), "xl").text).toBe("code");
    expect(switcherAt(block({ langText: "none", langFlag: true, at: { sm: { langFlag: false } } }), "sm").text).toBe("code");
  });

  it("is kept through the page's schema, by size", () => {
    const parsed = pageBlockSchema.parse(block({ switcher: "column", langText: "code", langFlag: true, at: { sm: { switcher: "dropdown", langText: "none" } } }));
    expect(parsed).toMatchObject({ switcher: "column", langText: "code", langFlag: true, at: { sm: { switcher: "dropdown", langText: "none" } } });
    expect(pageBlockSchema.safeParse(block({ switcher: "grid" as never })).success).toBe(false);
  });
});

describe("the language switcher's stylesheet (D474)", () => {
  it("shows the list at every size until a drop-down list is asked for", () => {
    const style = languageSwitchStyle(block());
    const css = renderPartCss(style.rules, DEFAULT_BREAKPOINTS);
    expect(style.className).toMatch(/^kzr-[a-z0-9]+-s$/);
    // The menu is never shown, the codes and flags never; the list and the names always.
    expect(css).toContain(`.${style.className} [data-ls-menu]{display:none}`);
    expect(css).toContain(`.${style.className} [data-ls-flag]{display:none}`);
    expect(css).not.toContain(`.${style.className} [data-ls-list]{display:none}`);
    expect(css).not.toContain("@media");
  });

  it("switches to the drop-down list on phones only, with flags and codes there", () => {
    const style = languageSwitchStyle(block({ at: { sm: { switcher: "dropdown", langText: "code", langFlag: true } } }));
    const css = renderPartCss(style.rules, DEFAULT_BREAKPOINTS);
    const phones = css.slice(css.indexOf("@media (width < 768px)"));
    expect(phones).toContain(`.${style.className} [data-ls-list]{display:none}`);
    expect(phones).toContain(`.${style.className} [data-ls-list] [data-ls-name]{position:absolute`);
    // Above phones: the list by name, no menu, no flags.
    const above = css.slice(css.indexOf("@media (width >= 768px)"));
    expect(above).toContain(`.${style.className} [data-ls-menu]{display:none}`);
    expect(above).toContain(`.${style.className} [data-ls-flag]{display:none}`);
  });

  it("lays the list one under another where asked", () => {
    const style = languageSwitchStyle(block({ switcher: "column" }));
    expect(renderPartCss(style.rules, DEFAULT_BREAKPOINTS)).toContain(`.${style.className} [data-ls-list]{flex-direction:column;align-items:flex-start}`);
  });
});

describe("a language's flag and code (D474)", () => {
  it("is the country its variant names, else where most of its readers are", () => {
    expect(flagOf("en-IE")).toBe("/flags/ie.svg");
    expect(flagOf("en-GB")).toBe("/flags/gb.svg");
    expect(flagOf("en")).toBe("/flags/gb.svg");
    expect(flagOf("nb-NO")).toBe("/flags/no.svg");
    expect(flagOf("sv-FI")).toBe("/flags/fi.svg");
    expect(flagOf("sl")).toBe("/flags/si.svg");
    expect(flagOf("ar")).toBeNull();
    expect(flagOf("es-MX")).toBeNull();
    expect(languageCode("nb-NO")).toBe("NB");
  });

  it("has a file for every flag it names, and names every file it has", () => {
    const files = readdirSync(join(process.cwd(), "public", "flags")).filter((file) => file.endsWith(".svg"));
    expect(files.map((file) => file.replace(/\.svg$/, "")).sort()).toEqual([...FLAG_COUNTRIES].sort());
  });
});
