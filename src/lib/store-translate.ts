import type { TranslateItem } from "./page-translate-ai";
import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";
import { LABEL_MAX } from "./navigation";

/**
 * Translating a whole store with AI (D110): its products' texts, its menus'
 * link texts and its pages and articles, into one language in one go. What
 * the model answers is only ever a suggestion: staff read each one and choose
 * what to keep before anything is written, and pages are written to their
 * drafts, not published. Legal texts (a product's safety information, and
 * pages that look like terms, privacy, returns or withdrawal) are listed
 * apart and kept off until staff tick them, as a machine translation of them
 * needs human review. Pure and shared with the browser.
 */

export const TRANSLATE_SCOPES = ["products", "menus", "pages"] as const;
export type TranslateScope = (typeof TRANSLATE_SCOPES)[number];

export const SCOPE_WORDS: Record<TranslateScope, { name: string; one: string }> = {
  products: { name: "Products", one: "Product" },
  menus: { name: "Menus", one: "Menu link" },
  pages: { name: "Pages and articles", one: "Page" },
};

/** One thing to translate: a product, a menu link or a page, with its texts. */
export type Unit = {
  /** `product:{id}`, `menu:{id}:{index}` or `page:{id}`. */
  id: string;
  scope: TranslateScope;
  /** What it is called in the main language, and what kind of page it is. */
  title: string;
  kind: string;
  /** A legal text: shown apart, and off until staff tick it. */
  legal: boolean;
  /** Its texts; a key is unique within the unit. */
  items: TranslateItem[];
};

/** A text's key across all units, for one request to the model. */
export const globalKey = (unitId: string, key: string) => `${unitId}|${key}`;
export const splitKey = (key: string): { unitId: string; key: string } => {
  const i = key.indexOf("|");
  return { unitId: key.slice(0, i), key: key.slice(i + 1) };
};

/** Every item of the units, keyed by unit and key, for the model. */
export const unitItems = (units: readonly Unit[]): TranslateItem[] =>
  units.flatMap((unit) => unit.items.map((item) => ({ ...item, key: globalKey(unit.id, item.key), label: `${unit.title}: ${item.label}` })));

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const PRODUCT_FIELDS = [
  { key: "title", label: "Title", max: 200, legal: false },
  { key: "description", label: "Description", max: 10_000, legal: false },
  { key: "safetyInformation", label: "Safety information", max: 5_000, legal: true },
  { key: "seoTitle", label: "Search title", max: TITLE_MAX, legal: false },
  { key: "seoDescription", label: "Search description", max: DESCRIPTION_MAX, legal: false },
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number]["key"];
export type ProductTexts = Record<ProductField, string>;

/**
 * A product's texts to translate: the main language's that have words, and
 * with `missing` only where the language has none. Safety information is a
 * unit of its own, so it can be left off.
 */
export function productUnits(id: string, source: ProductTexts, target: ProductTexts | null, mode: "missing" | "all"): Unit[] {
  const units: Unit[] = [];
  for (const legal of [false, true]) {
    const items = PRODUCT_FIELDS.filter((f) => f.legal === legal)
      .filter((f) => source[f.key].trim() !== "" && (mode === "all" || !target || target[f.key].trim() === ""))
      .map((f) => ({ key: f.key, label: f.label, max: f.max, rich: false, runs: [source[f.key]] }));
    // A translation needs a title: without one the rest cannot be kept.
    if (items.length > 0) units.push({ id: `product:${id}${legal ? ":legal" : ""}`, scope: "products", title: source.title, kind: legal ? "Product safety information" : "Product", legal, items });
  }
  return units;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** A menu link's text, when the owner wrote one in the main language (else the link is named by what it links to, in every language). */
export function menuUnit(menuId: string, menuName: string, index: number, label: Record<string, string>, main: string, target: string, mode: "missing" | "all"): Unit | null {
  const source = label[main]?.trim();
  if (!source) return null;
  if (mode === "missing" && label[target]?.trim()) return null;
  return {
    id: `menu:${menuId}:${index}`,
    scope: "menus",
    title: source,
    kind: `Menu ${menuName}`,
    legal: false,
    items: [{ key: "label", label: "Link text", max: LABEL_MAX, rich: false, runs: [source] }],
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Pages whose address or title says they are terms, privacy, returns or withdrawal: legal texts. */
const LEGAL_PAGE = /(terms|vilk[aå]r|villkor|vilk[aå]ar|betingelser|conditions|privacy|personvern|personal-?data|integritet|persondata|databeskyttelse|cookie|retur|return|angrerett|[ãa]ngerr[äa]tt|fortrydelse|withdrawal|refund|imprint|impressum|gdpr|legal|juridisk)/i;

export const isLegalPage = (slug: string, title: string) => LEGAL_PAGE.test(slug) || LEGAL_PAGE.test(title);

// ---------------------------------------------------------------------------
// What came back
// ---------------------------------------------------------------------------

/** What staff accept of a unit: each text, a plain one as a string, a rich one as its runs. */
export type Accepted = { unitId: string; values: Record<string, string | string[]> };

/** Whether a text is as long as its place allows and in the shape it was asked for. */
export function fitsItem(item: TranslateItem, value: unknown): value is string | string[] {
  if (item.rich) return Array.isArray(value) && value.length === item.runs.length && value.every((v) => typeof v === "string" && v.length <= 10_000);
  return typeof value === "string" && value.trim() !== "" && (item.max === 0 || value.trim().length <= item.max);
}
