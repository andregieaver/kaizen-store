import { describe, expect, it } from "vitest";

import { BREAKPOINT_WORDS } from "../breakpoints";
import { PRESET_LINE_WORDS } from "../design-variations";
import { FONT_CATEGORIES } from "../fonts";
import {
  BUTTON_CORNERS,
  BUTTON_STYLES,
  CARD_ALIGNS,
  CARD_CORNERS,
  CARD_IMAGES,
  CARD_STYLES,
  CHECKOUT_BACKGROUNDS,
  CHECKOUT_FIELDS,
  COLOR_MODES,
  CONTENT_WIDTHS,
  FIELD_CORNERS,
  HEADER_ALIGNS,
  HEADER_BACKGROUNDS,
  HEADING_CASES,
  PALETTE_LABELS,
  READABILITY_WORDS,
  THEME_TEMPLATES,
  THEME_TEMPLATE_KEYS,
} from "../theme";
import { CHANGES_WORDS } from "../theme-changes";
import { CHARGE_WORDS } from "../theme-prices";
import { WHATS_NEW_WORDS } from "../theme-update";
import { CORE_SECTION_LABELS, CORE_SECTION_STYLES } from "../section-styles";

import { designEn } from "./design.en";
import { designNb } from "./design.nb";

/**
 * The design catalogue's English (D312 A7) is the libraries' own words, copied so the admin's browser loads the catalogue without the
 * libraries: an English admin reads exactly what it read before.
 */
describe("the design catalogue's English is the libraries'", () => {
  it("says what the libraries' sentences say", () => {
    expect(designEn.charge).toEqual(CHARGE_WORDS);
    expect(designEn.changes).toEqual({ ...CHANGES_WORDS, title: designEn.changes.title, description: designEn.changes.description, nothing: designEn.changes.nothing });
    expect(designEn.whatsNew).toEqual(WHATS_NEW_WORDS);
    expect(designEn.presetLine).toEqual(PRESET_LINE_WORDS);
    expect(designEn.readability).toEqual(READABILITY_WORDS);
    expect(designEn.breakpoints).toEqual(BREAKPOINT_WORDS);
    expect(designEn.fonts.categories).toEqual(FONT_CATEGORIES);
  });

  it("names the theme's settings as the theme module does", () => {
    const o = designEn.editor.options;
    expect(o.colorModes).toEqual(COLOR_MODES);
    expect(o.headingCases).toEqual(HEADING_CASES);
    expect(o.buttonCorners).toEqual(BUTTON_CORNERS);
    expect(o.cardCorners).toEqual(CARD_CORNERS);
    expect(o.fieldCorners).toEqual(FIELD_CORNERS);
    expect(o.buttonStyles).toEqual(BUTTON_STYLES);
    expect(o.contentWidths).toEqual(CONTENT_WIDTHS);
    expect(o.headerAligns).toEqual(HEADER_ALIGNS);
    expect(o.headerBackgrounds).toEqual(HEADER_BACKGROUNDS);
    expect(o.cardImages).toEqual(CARD_IMAGES);
    expect(o.cardStyles).toEqual(CARD_STYLES);
    expect(o.cardAligns).toEqual(CARD_ALIGNS);
    expect(o.checkoutBackgrounds).toEqual(CHECKOUT_BACKGROUNDS);
    expect(o.checkoutFields).toEqual(CHECKOUT_FIELDS);
    expect(designEn.editor.palette).toEqual(PALETTE_LABELS);
    for (const key of THEME_TEMPLATE_KEYS) expect(designEn.editor.templates[key]).toBe(THEME_TEMPLATES[key].description);
  });

  it("names every core section style in Norwegian, and the English falls back to the module's own names", () => {
    for (const name of CORE_SECTION_STYLES) {
      expect(designNb.changes.styles[name]).toBeTruthy();
      expect(designNb.whatsNew.styles[name]).toBe(designNb.changes.styles[name]);
      expect(designEn.changes.styles[name] ?? CORE_SECTION_LABELS[name].name).toBe(CORE_SECTION_LABELS[name].name);
    }
  });

  it("keeps every placeholder of the English in the Norwegian", () => {
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const walk = (en: unknown, nb: unknown, path: string) => {
      if (typeof en === "string") {
        expect(typeof nb, path).toBe("string");
        expect(holes(nb as string), path).toEqual(holes(en));
        return;
      }
      if (en && typeof en === "object" && !Array.isArray(en)) {
        for (const key of Object.keys(en)) walk((en as Record<string, unknown>)[key], (nb as Record<string, unknown>)?.[key], `${path}.${key}`);
      }
    };
    walk(designEn, designNb, "design");
  });
});
