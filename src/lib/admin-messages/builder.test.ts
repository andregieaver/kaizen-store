import { describe, expect, it } from "vitest";

import { SIZE_LABELS } from "../breakpoints";
import { INLINE_HINT } from "../inline-text";
import { BORDER_STYLES, COLUMN_JUSTIFY, GRID_CONTENT, GRID_ELEMENTS, GRID_SORTS, IMAGE_SHAPES, PRODUCT_PARTS, ROW_LAYOUTS, SHADOWS, SITE_PARTS } from "../page-content";
import { LAYOUT_TYPE_LABELS } from "../page-layout";
import { VERSION_KIND_WORDS } from "../page-versions";
import { SAVED_KIND_LABELS } from "../saved-parts";
import { KIND_LABELS, SHARING_LABELS, TEMPLATE_SOURCE_LABELS } from "../templates";
import { THEME_ELEMENT_LABELS } from "../theme-elements";
import { builderEn } from "./builder.en";

/**
 * The builder's English catalogue repeats the names its libraries keep for their other readers (D312 A7): they must stay the same, so the
 * builder in English says exactly what it said before it read a catalogue.
 */
describe("the builder catalogue's English", () => {
  it("names the row layouts, screen sizes and theme elements as their libraries do", () => {
    expect(builderEn.layouts).toEqual(Object.fromEntries(Object.entries(ROW_LAYOUTS).map(([key, layout]) => [key, layout.label])));
    expect(builderEn.sizes).toEqual(SIZE_LABELS);
    expect(builderEn.elements).toEqual(THEME_ELEMENT_LABELS);
  });

  it("names the product and site parts as the page content does", () => {
    expect(builderEn.productParts).toEqual(PRODUCT_PARTS);
    expect(builderEn.siteParts).toEqual(SITE_PARTS);
  });

  it("names saved parts, grids, shapes, borders, shadows and alignments as their libraries do", () => {
    expect(builderEn.savedKinds).toEqual(SAVED_KIND_LABELS);
    expect(builderEn.grid.content).toEqual(GRID_CONTENT);
    expect(builderEn.grid.sorts).toEqual(GRID_SORTS);
    expect(builderEn.grid.elements).toEqual(GRID_ELEMENTS);
    expect(builderEn.fields.shapes).toEqual({ original: "Original", ...IMAGE_SHAPES });
    expect(builderEn.frameFields.borderStyles).toEqual(BORDER_STYLES);
    expect(builderEn.frameFields.shadows).toEqual(Object.fromEntries(Object.entries(SHADOWS).map(([key, shadow]) => [key, shadow.label])));
    expect(builderEn.dialogs.justify).toEqual(COLUMN_JUSTIFY);
    expect(builderEn.inlineHint).toBe(INLINE_HINT);
  });

  it("names templates, page types and versions as their libraries do", () => {
    expect(builderEn.templates.kinds).toEqual(KIND_LABELS);
    expect(builderEn.templates.sharing).toEqual(SHARING_LABELS);
    expect(builderEn.templates.sources).toEqual(TEMPLATE_SOURCE_LABELS);
    expect(builderEn.templates.layoutTypes).toEqual(LAYOUT_TYPE_LABELS);
    expect(builderEn.versions.kinds).toEqual(VERSION_KIND_WORDS);
  });
});
