import { blend } from "./colour";
import { CLAIM_LABELS, findClaims } from "./claims";
import { DESIGN_LAYOUT_KINDS, LAYOUT_PAGE_TYPE, designSnapshotSchema, layoutForStore, type DesignLayoutKind, type DesignSnapshot } from "./design-presets";
import { pageIssues, themeSetsOf } from "./page-a11y";
import { pageInput, type PageContent, type PageType, type ThemeElement } from "./page-content";
import { mapTexts } from "./page-translation";
import { CORE_SECTION_STYLES, sectionStyleLabel } from "./section-styles";
import { contrastRatio, type PaletteKey, type ThemeSettings } from "./theme";
import type { ThemeElementKey, ThemeElements } from "./theme-elements";

/**
 * The checks every theme passes before a version is published (`docs/theme-store.md` 7, D246, `docs/theme-phase-2.md` step 5), Kaizena's
 * own included. Pure: given a snapshot as stored, every finding with where it is and whether it blocks publishing. What the checks of the
 * plan's 7 cover here: the package and its layouts as a save is checked (1), accessibility of the layouts in each colour set the theme
 * shows (2), contrast of the palette and of every section style (3), the core section styles (4), what the checkout's pages must not hold
 * in the header and footer drawn on them (5), and words and links (6). Speed and phones (7, 8) are held for Kaizena's themes by the
 * switch e2e, which draws them in a browser.
 */

export const THEME_CHECKS = {
  package: "The theme's files",
  accessibility: "Accessibility",
  contrast: "Contrast",
  sections: "Section styles",
  pay: "Checkout pages",
  words: "Words and links",
} as const;
export type ThemeCheckKind = keyof typeof THEME_CHECKS;

export type ThemeFinding = { check: ThemeCheckKind; blocking: boolean; where: string; message: string };
export type ThemeCheckResult = { findings: ThemeFinding[]; blocking: number };

/** The page rules a save asks beyond `pageInput` (`pageRulesProblem()`, server-only), passed in by the server. */
export type RulesProblem = (type: PageType, content: PageContent) => string | null;

const LAYOUT_WORDS: Record<DesignLayoutKind, string> = { header: "Header", footer: "Footer", productLayout: "Product page" };

/** Normal text needs 4.5:1 and large text (headings) 3:1 (WCAG 2.2 AA, 1.4.3). */
const NORMAL = 4.5;
const LARGE = 3;

/** The palette pairs a visitor reads: the first two block publishing, the others are warnings the editor already gives. */
const PALETTE_PAIRS: { fg: PaletteKey; bg: PaletteKey; what: string; blocking: boolean }[] = [
  { fg: "text", bg: "background", what: "Text on the background", blocking: true },
  { fg: "accentText", bg: "accent", what: "Text on the accent colour (buttons)", blocking: true },
  { fg: "text", bg: "surface", what: "Text on the surface colour", blocking: false },
  { fg: "muted", bg: "background", what: "Secondary text on the background", blocking: false },
];

const TEXT_KEYS: { key: ThemeElementKey; large: boolean }[] = [
  { key: "h1", large: true },
  { key: "h2", large: true },
  { key: "h3", large: true },
  { key: "h4", large: false },
  { key: "h5", large: false },
  { key: "h6", large: false },
  { key: "p", large: false },
  { key: "list", large: false },
];

/** The colour an element's text is given, and how solid: its first kind of text that has one (a theme element sets one look per element). */
function inkOf(element: ThemeElement | undefined): { color: string; opacity?: number } | null {
  for (const typography of Object.values(element?.typography ?? {})) {
    if (typography?.color) return { color: typography.color, ...(typography.opacity !== undefined && { opacity: typography.opacity }) };
  }
  return null;
}

/** A row element's solid colour behind its text, over the page's background; null where it sets none. */
function backgroundOf(row: ThemeElement | undefined, page: string): string | null {
  const background = row?.background;
  if (!background || background.type !== "color" || !/^#[0-9a-f]{6}$/i.test(background.color)) return null;
  return blend(background.color, background.opacity, page);
}

/** Contrast of the texts a set of elements draws, over the row's background: each kind of text against what is behind it. */
function elementContrast(elements: ThemeElements | undefined, under: ThemeElements | undefined, set: { name: string; text: string; background: string }, where: string): ThemeFinding[] {
  const row = elements?.row ?? under?.row;
  const behind = backgroundOf(row, set.background) ?? set.background;
  const rowInk = inkOf(elements?.row) ?? inkOf(under?.row);
  const findings: ThemeFinding[] = [];
  for (const { key, large } of TEXT_KEYS) {
    const ink = inkOf(elements?.[key]) ?? inkOf(under?.[key]) ?? rowInk ?? { color: set.text };
    const shown = blend(ink.color, ink.opacity, behind);
    const ratio = contrastRatio(shown, behind);
    const need = large ? LARGE : NORMAL;
    if (ratio < need) {
      findings.push({
        check: "contrast",
        blocking: true,
        where,
        message: `${key === "list" ? "Lists" : key.toUpperCase()} on this section's background in the ${set.name} colours is hard to read (${ratio.toFixed(1)}:1; it needs ${need}:1).`,
      });
    }
  }
  return findings;
}

/** Every link a layout's parts hold that leaves the site (a full address, an email or a phone number): a theme brings none of its own. */
function offSiteLinks(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) offSiteLinks(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if ((key === "href" || key === "link") && typeof item === "string" && /^(?:https?:|mailto:|tel:|\/\/)/i.test(item.trim())) found.push(item.trim());
      else offSiteLinks(item, found);
    }
  }
  return found;
}

/** Runs every check on a stored snapshot. */
export function themeCheck(stored: unknown, options: { rulesProblem?: RulesProblem } = {}): ThemeCheckResult {
  const findings: ThemeFinding[] = [];
  const parsed = designSnapshotSchema.safeParse(stored);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 5)) {
      findings.push({ check: "package", blocking: true, where: issue.path.join(".") || "Theme", message: issue.message });
    }
    return { findings, blocking: findings.length };
  }
  const snapshot = parsed.data as DesignSnapshot;
  const settings: ThemeSettings = snapshot.theme.settings;
  const sets = themeSetsOf(settings);

  // 3: the palette, in each set the site shows.
  for (const set of sets) {
    const palette = settings[set.name as "light" | "dark"];
    for (const pair of PALETTE_PAIRS) {
      const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
      if (ratio < NORMAL) {
        findings.push({ check: "contrast", blocking: pair.blocking, where: `Colours (${set.name})`, message: `${pair.what} is hard to read (${ratio.toFixed(1)}:1; it needs ${NORMAL}:1).` });
      }
    }
    // The site-wide elements, then each section style laid over them.
    findings.push(...elementContrast(settings.elements, undefined, set, "Text and spacing"));
    for (const [name, style] of Object.entries(settings.sectionStyles ?? {})) {
      findings.push(...elementContrast(style, settings.elements, set, `Section style ${sectionStyleLabel(name)}`));
    }
  }

  // 4: the core section styles, so a switch between Kaizena themes always lands.
  for (const name of CORE_SECTION_STYLES) {
    if (!settings.sectionStyles?.[name]) {
      findings.push({ check: "sections", blocking: true, where: `Section style ${sectionStyleLabel(name)}`, message: "Every theme has the core section styles; this one is missing." });
    }
  }

  // 1, 2, 5, 6: each layout as a store would get it.
  for (const kind of DESIGN_LAYOUT_KINDS) {
    const layout = snapshot[kind];
    if (!layout) continue;
    const where = LAYOUT_WORDS[kind];
    const content = layoutForStore(layout, { header: null, footer: null }, { title: where, slug: `theme-${kind.toLowerCase()}` });
    const input = pageInput.safeParse(content);
    if (!input.success) {
      findings.push({ check: "package", blocking: true, where, message: input.error.issues[0]?.message ?? "It cannot be read as a page." });
      continue;
    }
    const type = LAYOUT_PAGE_TYPE[kind];
    const problem = options.rulesProblem?.(type, input.data);
    if (problem) findings.push({ check: "package", blocking: true, where, message: problem });

    // The header and footer are drawn on the checkout's pages too.
    const issues = pageIssues(input.data, {
      theme: { sets },
      ...(kind !== "productLayout" && { checkout: true }),
      ...(kind === "footer" && { footer: { storeId: "theme" } }),
    });
    for (const issue of issues) {
      findings.push({
        check: issue.rule === "pay_page_block" ? "pay" : "accessibility",
        blocking: issue.severity === "blocking",
        where: `${where}: ${issue.where}`,
        message: issue.message,
      });
    }

    mapTexts(input.data, (_key, value) => {
      if (typeof value !== "string") return value;
      for (const claim of findClaims(value)) {
        findings.push({ check: "words", blocking: true, where, message: `“${claim.phrase}”: ${CLAIM_LABELS[claim.kind].toLowerCase()}, which a theme cannot say for every store.` });
      }
      return value;
    });
    for (const link of [...new Set(offSiteLinks(layout.rows))]) {
      findings.push({ check: "words", blocking: true, where, message: `It links off the site (${link}); a theme links only to the store's own pages, by its menus.` });
    }
  }

  return { findings, blocking: findings.filter((finding) => finding.blocking).length };
}

/** The findings that block, as one sentence each, for a refusal. */
export const blockingLines = (result: ThemeCheckResult): string[] =>
  result.findings.filter((finding) => finding.blocking).map((finding) => `${THEME_CHECKS[finding.check]}, ${finding.where}: ${finding.message}`);
