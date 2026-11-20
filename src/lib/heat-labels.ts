/**
 * The heatmaps' words that the AI manager's heatmap tools say in English (bloat review step 2.50): beside `heat-tools.ts`, whose
 * `pageFigures()` and `hubFigures()` speak with no language, so the `heatmaps` catalogue takes these from here and those tools bring no
 * catalogue. Imports nothing.
 */

export const HEAT_PARTS_EN = {
  header: "Header",
  footer: "Footer",
  elsewhere: "Elsewhere on the page",
  card: "Product card {n}",
  part: "A part {p} % down the page",
};

export const HEAT_BAND_EN = "{from}–{to} % down";

export const HEAT_FRONT_PAGE_EN = "Front page";

/** What `partLabel()`, `pageFigures()` and `hubFigures()` read, in English. */
export const HEAT_TOOL_WORDS = { map: { parts: HEAT_PARTS_EN, band: HEAT_BAND_EN }, hub: { frontPage: HEAT_FRONT_PAGE_EN } };
