/**
 * Unit price rules (D160, `docs/wave-1d-unit-price.md` 4.3 and 2.2): which comparison base a market shows, and which
 * variants of a product still need their content. Pure and shared with the browser (the product editor and the
 * server's save ask the same functions). Every rule that comes from a law is written with its source and the date it
 * was read, is flagged `verified: false` where it was not read, and needs review by a lawyer.
 */
import {
  baseFits,
  defaultBase,
  isBase,
  isSmallBase,
  measureFromColumns,
  type Base,
  type Measure,
  type ShownMeasure,
  type Unit,
} from "./unit-price";

export type CountryRule = {
  /** Whether a market in this country may compare packaged goods per 100 g or 100 ml instead of per kg or l. */
  smallBaseAllowed: boolean;
  /** Whether the rule was read in a source (true) or is a choice made without reading it (false: needs review). */
  verified: boolean;
  /** Where it was read, and when; or that nothing was read. */
  source: string;
};

/**
 * Where the small base (100 g, 100 ml) is allowed. Every country that is not here is `smallBaseAllowed: false`:
 * unknown means the large base (1 kg, 1 l), which is lawful everywhere the sources were read. No country in the table
 * allows the small base today: each rule that was read names kg, l, m, m2 and piece units only. A row becomes `true`
 * only when a person has read a source that allows it (and the test says which), never on a guess.
 */
export const UNIT_PRICE_COUNTRY_RULES: Record<string, CountryRule> = {
  DE: {
    smallBaseAllowed: false,
    verified: true,
    source:
      "Preisangabenverordnung 2022 section 5(1), read 2026-10-04 at https://lxgesetze.de/pangv/5 (a mirror): 1 kg, 1 l, 1 m3, 1 m or 1 m2 for packaged goods; 100 g and 100 ml only for loose goods (section 5(2)).",
  },
  NO: {
    smallBaseAllowed: false,
    verified: true,
    source:
      "Forskrift om prisopplysninger mv. for varer og tjenester (FOR-2012-11-14-1066), read 2026-10-04 at https://lovdata.no/dokument/SF/forskrift/2012-11-14-1066: section 4 defines the unit price (enhetspris) per litre or cubic metre, per kilogram, per metre or per square metre; section 7 allows only per piece, per 100 m of paper rolls and per standard wash. 100 g and 100 ml do not appear.",
  },
  SE: {
    smallBaseAllowed: false,
    verified: true,
    source:
      "Konsumentverkets foreskrifter KOVFS 2012:1, read verbatim 2026-10-04 at https://lagen.nu/kovfs/2012:1: section 6 lists the units a comparison price (jamforpris) on goods may use: kr/kg, kr/ton; kr/l, kr/m3; kr/m, kr/km; kr/m2; kr/st or kr/100 st; kr/dos. Per 100 g and per 100 ml are not on the list.",
  },
  DK: {
    smallBaseAllowed: false,
    verified: false,
    source:
      "Not read in full: the bekendtgorelse on price and unit price for consumer goods (BEK 1696 of 14 December 2017; the text could not be fetched on 2026-10-04). A search summary defines the unit price per kilogram, litre, metre, square metre or cubic metre, or another unit named in its section 5, which gives no reason to allow 100 g or 100 ml. Kept closed until the text is read: check before opening it.",
  },
};

/** Whether a market's country may use the small base (100 g, 100 ml). Unknown countries may not. */
export function smallBaseAllowed(country: string | null | undefined): boolean {
  if (!country) return false;
  return UNIT_PRICE_COUNTRY_RULES[country.toUpperCase()]?.smallBaseAllowed === true;
}

/** The country's rule, or null where nothing is written down (which means the large base). */
export function countryRule(country: string | null | undefined): CountryRule | null {
  if (!country) return null;
  return UNIT_PRICE_COUNTRY_RULES[country.toUpperCase()] ?? null;
}

/**
 * The base a market shows: the owner's choice (`measure_base`, null for the family's default) when it is the default
 * or when the market's country allows the small one, else the family's default (`100g` becomes `kg`, `100ml`
 * becomes `l`). A base that cannot compare the unit is ignored. The market's COUNTRY decides, never the language or
 * the currency shown (D109): `no-en-eur` is Norway. What is shown, what the order line snapshots and what the
 * structured data says.
 */
export function effectiveBase(unit: Unit, ownerBase: Base | null | undefined, country: string | null | undefined): Base {
  const fallback = defaultBase(unit);
  if (!ownerBase || !baseFits(unit, ownerBase)) return fallback;
  if (!isSmallBase(ownerBase)) return ownerBase;
  return smallBaseAllowed(country) ? ownerBase : fallback;
}

/** A variant's measure as a market shows it. */
export function shownMeasureFor(measure: Measure, ownerBase: Base | null | undefined, country: string | null | undefined): ShownMeasure {
  return { ...measure, base: effectiveBase(measure.unit, ownerBase, country) };
}

/**
 * What a variant's columns (or an order line's snapshot) say as a market shows it: the measure with the base in effect
 * in the market's country, or null when there is no measure. `base` is `measure_base` (the owner's preference, null for
 * the default); a value that is not a base is ignored. The one reader the server's catalogue, cart, checkout and order
 * reads use, so none of them decides the base on its own.
 */
export function shownMeasureFromColumns(
  amount: unknown,
  unit: unknown,
  base: unknown,
  country: string | null | undefined,
): ShownMeasure | null {
  const measure = measureFromColumns(amount, unit);
  if (!measure) return null;
  return shownMeasureFor(measure, isBase(base) ? base : null, country);
}

/**
 * An order line's snapshot as it was sold: the base is the one that was in effect then and is NOT worked out again
 * (a change to the country table never rewrites an old order). Null when the line had no measure or its columns do not
 * agree (a base that cannot compare the unit).
 */
export function snapshotMeasureFromColumns(amount: unknown, unit: unknown, base: unknown): ShownMeasure | null {
  const measure = measureFromColumns(amount, unit);
  if (!measure || !isBase(base) || !baseFits(measure.unit, base)) return null;
  return { ...measure, base };
}

/** Whether any of the markets' countries may use the small base (100 g, 100 ml): what the editor offers. */
export function anySmallBaseAllowed(countries: readonly (string | null | undefined)[]): boolean {
  return countries.some((country) => smallBaseAllowed(country));
}

/** The note the editor shows beside the choice of base, for the countries of the store's markets. */
export function smallBaseNote(countries: readonly (string | null | undefined)[]): string {
  if (anySmallBaseAllowed(countries)) {
    return "100 g and 100 ml are shown only in the markets whose country's rule allows it; the others compare per kg or l.";
  }
  return "A packaged product is compared per kg or l in every market: the rules of Germany, Norway and Sweden allow no other base for it, and no other country's rule has been checked.";
}

// --- What a product needs ---------------------------------------------------------------------------------------------

export type UnitPriceVariantFacts = {
  sku: string;
  /** What the owner calls it, for the sentence: the product's title and the variant's options. */
  title: string;
  active: boolean;
  delivery: string;
  measure: Measure | null;
};

export type UnitPriceCategory = {
  name: string;
  requiresUnitPrice: boolean;
};

export type UnitPriceFacts = {
  /** The product's status as it will be saved. */
  status: string;
  kind: string;
  soldByMeasure: boolean;
  /**
   * The product's categories and every ancestor of each (the same chain `commerce.unit_price_required()` walks), with
   * their marks. Tags and other kinds of term do not belong here.
   */
  categories: readonly UnitPriceCategory[];
  variants: readonly UnitPriceVariantFacts[];
};

export type UnitPriceNeed = { required: false } | { required: true; reason: "flag" } | { required: true; reason: "category"; category: string };

/** Why a product needs a measure, as `commerce.unit_price_required()` decides it: the flag first, else a marked category. */
export function unitPriceNeed(facts: Pick<UnitPriceFacts, "soldByMeasure" | "categories">): UnitPriceNeed {
  if (facts.soldByMeasure) return { required: true, reason: "flag" };
  const marked = facts.categories.find((c) => c.requiresUnitPrice);
  return marked ? { required: true, reason: "category", category: marked.name } : { required: false };
}

export type UnitPriceProblem = {
  code: "unit_price.measure_required" | "unit_price.not_applicable";
  sku: string;
  /** In the admin's English, one sentence. */
  message: string;
};

/**
 * What stops a product from being saved (2.2): an ACTIVE goods product that needs a measure while an active physical
 * variant has none, and a measure on a variant that is not physical goods (whatever the status). A draft may be saved
 * incomplete. The database refuses the same states (`check_unit_price()`).
 */
export function unitPriceProblems(facts: UnitPriceFacts): UnitPriceProblem[] {
  const problems: UnitPriceProblem[] = [];
  for (const v of facts.variants) {
    if (v.measure && (facts.kind !== "goods" || v.delivery !== "physical")) {
      problems.push({
        code: "unit_price.not_applicable",
        sku: v.sku,
        message: `Remove the content of ${v.title} (SKU ${v.sku}): content can only be given for physical goods, not for appointments, stays, rentals or downloads.`,
      });
    }
  }
  if (facts.status === "active" && facts.kind === "goods") {
    const need = unitPriceNeed(facts);
    if (need.required) {
      const because =
        need.reason === "flag"
          ? "it is sold by measure"
          : `its category ${need.category} is marked as needing one`;
      for (const v of facts.variants) {
        if (v.active && v.delivery === "physical" && !v.measure) {
          problems.push({
            code: "unit_price.measure_required",
            sku: v.sku,
            message: `Add the content of ${v.title} (SKU ${v.sku}): this product needs a price per kg or litre because ${because}.`,
          });
        }
      }
    }
  }
  return problems;
}

/**
 * The nudge the editor shows while no variant has a measure: food is usually sold with a price per kg or litre. A
 * nudge only; the product saves and sells. Not shown once the product is required (it is then a refusal's job) or has
 * any measure. `vatCategory` is the product's VAT category (a row of `vat_categories`, D157).
 */
export function unitPriceNudge(facts: { vatCategory: string; kind: string; variants: readonly { measure: Measure | null }[] }): string | null {
  if (facts.kind !== "goods" || facts.vatCategory !== "food") return null;
  if (facts.variants.some((v) => v.measure)) return null;
  return "Food is usually sold with a price per kg or litre. Add the content of each variant.";
}

