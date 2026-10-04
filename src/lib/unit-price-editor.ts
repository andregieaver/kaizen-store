/**
 * What the product editor and the categories screen say about a unit price (D160, `docs/wave-1d-unit-price.md` 2.2). Pure
 * and shared with the browser: the figure itself is only ever `unitPrice()` (through `unitPriceShown()`), so the live
 * preview shows what the shop will show; the rules are `unit-price-rules.ts`'s (the same ones the save and the database
 * hold). The admin is English only.
 */
import { withVat, type StoreAudience } from "./b2b";
import { formatMoney } from "./money";
import { priceVat } from "./pricing";
import { parsePrice, variantLabel, type MeasureInput, type ProductInput } from "./product-input";
import { withParents } from "./custom-fields";
import type { Term } from "./taxonomy";
import {
  basesFor,
  defaultBase,
  typedMeasure,
  unitPriceShown,
  type Base,
  type Measure,
  type Unit,
  type UnitPriceReason,
} from "./unit-price";
import {
  anySmallBaseAllowed,
  effectiveBase,
  unitPriceNeed,
  unitPriceNudge,
  unitPriceProblems,
  type UnitPriceCategory,
  type UnitPriceFacts,
  type UnitPriceNeed,
  type UnitPriceProblem,
} from "./unit-price-rules";

/** The units a content is typed in, with how the editor writes them. */
export const CONTENT_UNITS: readonly { value: Unit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "cl", label: "cl" },
  { value: "l", label: "l" },
  { value: "cm", label: "cm" },
  { value: "m", label: "m" },
  { value: "m2", label: "m²" },
  { value: "piece", label: "piece" },
];

/** What a base is called in a sentence, and (short) beside a figure. */
const BASE_WORDS: Record<Base, { choice: string; short: string }> = {
  kg: { choice: "1 kg", short: "kg" },
  "100g": { choice: "100 g", short: "100 g" },
  l: { choice: "1 l", short: "l" },
  "100ml": { choice: "100 ml", short: "100 ml" },
  m: { choice: "1 m", short: "m" },
  m2: { choice: "1 m²", short: "m²" },
  piece: { choice: "1 piece", short: "piece" },
};

export const unitLabel = (unit: Unit): string => CONTENT_UNITS.find((u) => u.value === unit)?.label ?? unit;

/**
 * What a content can be compared per: the unit's default (stored as null: the market's rule is applied when it is shown)
 * and, for a mass or a volume, the small base, offered only when one of the store's markets (`countries`) may show it
 * (`UNIT_PRICE_COUNTRY_RULES`) or when it is already chosen, so the owner can see and change it back.
 */
export function compareChoices(
  unit: Unit,
  countries: readonly (string | null | undefined)[],
  chosen: Base | null = null,
): { value: Base | null; label: string }[] {
  const fallback = defaultBase(unit);
  const offerSmall = anySmallBaseAllowed(countries);
  return basesFor(unit)
    .filter((base) => base === fallback || offerSmall || base === chosen)
    .map((base) => ({
      value: base === fallback ? null : base,
      label:
        base === fallback
          ? `${BASE_WORDS[base].choice} (usual)`
          : offerSmall
            ? BASE_WORDS[base].choice
            : `${BASE_WORDS[base].choice} (not shown in your markets: they compare per ${BASE_WORDS[fallback].short})`,
    }));
}

/** When the unit changes, the comparison stays only if it still compares the same kind of thing. */
export function baseAfterUnitChange(unit: Unit, base: Base | null): Base | null {
  return base !== null && basesFor(unit).includes(base) && base !== defaultBase(unit) ? base : null;
}

/** A variant's content with the unit it was typed in, a new one starting in grams. */
export const emptyContent = (): MeasureInput => ({ amount: "", unit: "g", base: null });

// --- Why a unit price is not shown -------------------------------------------------------------------------------------

const WHY: Record<UnitPriceReason, string> = {
  same_as_price: "the unit price is the same as the price.",
  free: "the price is 0.",
  rounds_to_zero: "the unit price would round to nothing.",
  too_large: "the unit price is too large to show.",
  family: "the content and what it is compared per do not match.",
  invalid: "the content is not valid.",
};

export type ContentPreview = { market: string; shown: boolean; text: string };

type PreviewMarket = { code: string; name: string; currency: string; vatRates: Record<string, number> };

/**
 * The live preview under a variant's content: for each market the variant has a typed price in, the unit price the shop
 * will show, from the same `unitPriceShown()` and the market's own rule for the base. A store selling only to
 * businesses types prices without VAT: they are first turned into the kept price with VAT, as saving does, then shown the
 * way the store shows prices. Nothing is returned while no content is typed.
 */
export function contentPreviews(args: {
  content: { amount: string; unit: Unit; base: Base | null } | null;
  prices: Record<string, string>;
  markets: readonly PreviewMarket[];
  audience: StoreAudience;
  vatCategory: string;
  locale: string;
}): ContentPreview[] {
  const measure: Measure | null = typedMeasure(args.content);
  if (!args.content || !measure) return [];
  const out: ContentPreview[] = [];
  for (const market of args.markets) {
    const typed = parsePrice(args.prices[market.code] ?? "", market.currency);
    if (typed === null) continue;
    const rate = market.vatRates[args.vatCategory] ?? market.vatRates.standard ?? 0;
    const kept = args.audience === "businesses" ? withVat(typed, rate) : typed;
    const base = effectiveBase(measure.unit, args.content.base, market.code);
    const vat = priceVat(args.audience, rate);
    const shown = unitPriceShown(kept, vat, measure, base);
    const parts: string[] = [];
    let reason: UnitPriceReason | null = null;
    for (const [key, suffix] of [
      ["incl", vat.shown === "choice" ? " incl. VAT" : ""],
      ["excl", " excl. VAT"],
    ] as const) {
      const result = shown[key];
      if (!result) continue;
      if (result.ok) parts.push(`${formatMoney(result.minor, market.currency, args.locale)}/${BASE_WORDS[result.base].short}${suffix}`);
      else reason = reason ?? result.reason;
    }
    if (parts.length > 0) {
      out.push({ market: market.name, shown: true, text: `Unit price in ${market.name} (${market.currency}): ${parts.join(", ")}` });
    } else {
      out.push({ market: market.name, shown: false, text: `Not shown in ${market.name}: ${WHY[reason ?? "invalid"]}` });
    }
  }
  if (out.length === 0) out.push({ market: "", shown: false, text: "Not shown: no price yet." });
  return out;
}

// --- What a product needs ---------------------------------------------------------------------------------------------

/** The product's categories and every ancestor, with their marks: the chain `commerce.unit_price_required()` walks. */
export function categoryChain(terms: readonly Term[], categoryIds: readonly string[]): UnitPriceCategory[] {
  const byId = new Map(terms.map((t) => [t.id, t]));
  return withParents(
    categoryIds.filter((id) => byId.get(id)?.kind === "category"),
    terms,
  ).flatMap((id) => {
    const term = byId.get(id);
    return term ? [{ name: term.name, requiresUnitPrice: term.requiresUnitPrice === true }] : [];
  });
}

/** The product as `unitPriceProblems()` reads it, from what is typed in the editor. */
export function editorFacts(product: ProductInput, terms: readonly Term[], primaryLocale: string): UnitPriceFacts {
  const name = product.translations.find((t) => t.locale === primaryLocale)?.title || product.handle || "This product";
  return {
    status: product.status,
    kind: product.kind,
    soldByMeasure: product.soldByMeasure,
    categories: categoryChain(terms, product.categories),
    variants: product.variants.map((v) => ({
      sku: v.sku || "no SKU yet",
      title: [name, variantLabel(v.options)].filter(Boolean).join(" "),
      active: v.active,
      delivery: v.delivery,
      measure: typedMeasure(v.measure),
    })),
  };
}

export type ContentState = {
  need: UnitPriceNeed;
  /** What stops the product from being saved now (it is on sale, or a variant has content it cannot have). */
  problems: UnitPriceProblem[];
  /** For a draft: what will stop it once it is published, so the owner can add it first. Empty for a product on sale. */
  pending: UnitPriceProblem[];
  /** The soft hint for food while nothing is required and nothing is given. */
  nudge: string | null;
};

/** What the product-level part of the editor says: whether content is needed, what is missing, the nudge. */
export function contentState(product: ProductInput, terms: readonly Term[], primaryLocale: string): ContentState {
  const facts = editorFacts(product, terms, primaryLocale);
  const need = unitPriceNeed(facts);
  const problems = unitPriceProblems(facts);
  const known = new Set(problems.map((p) => `${p.code}:${p.sku}`));
  return {
    need,
    problems,
    pending: facts.status === "active" ? [] : unitPriceProblems({ ...facts, status: "active" }).filter((p) => !known.has(`${p.code}:${p.sku}`)),
    nudge: need.required ? null : unitPriceNudge({ vatCategory: product.vatCategory, kind: product.kind, variants: facts.variants }),
  };
}

/** Why a product needs content, in words for the editor. */
export function needWords(need: UnitPriceNeed): string | null {
  if (!need.required) return null;
  return need.reason === "flag"
    ? "This product is sold by measure: every variant that is for sale and shipped needs its content."
    : `Its category ${need.category} needs a price per kg or litre: every variant that is for sale and shipped needs its content.`;
}

/**
 * The variants as they must be once they cannot have content: a variant that is not physical goods loses its content (the
 * database refuses one). Returns the same array when nothing changes.
 */
export function withoutContentWhereNotGoods<V extends { delivery: string; measure: unknown }>(kind: string, variants: V[]): V[] {
  if (!variants.some((v) => v.measure !== null && (kind !== "goods" || v.delivery !== "physical"))) return variants;
  return variants.map((v) => (v.measure !== null && (kind !== "goods" || v.delivery !== "physical") ? { ...v, measure: null } : v));
}

// --- The categories screen and the products page ----------------------------------------------------------------------

/** The sentence under a marked category: how many active products still have no content. */
export function categoryGapWords(gaps: number): string {
  if (gaps === 0) return "Every active product in this category has its content.";
  return `${gaps} active ${gaps === 1 ? "product" : "products"} in this category ${gaps === 1 ? "has" : "have"} no content yet.`;
}

/** The notice at the top of the products page. */
export function needsContentNotice(count: number): string {
  return count === 1
    ? "1 active product still needs its content for the price per kg or litre."
    : `${count} active products still need their content for the price per kg or litre.`;
}
