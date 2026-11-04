/**
 * Who must answer for a product in each country it is sold in (GPSR, Regulation (EU) 2023/988, Art. 16 and 19; D452,
 * `docs/product-safety-eea.md`), pure. Two classifications are kept apart and never inferred from each other: membership of the EU and
 * membership of the EEA (`commerce.country_memberships`). What a destination asks of a manufacturer established elsewhere is configured
 * per destination (`commerce.product_safety_rules`), never assumed from a country's membership:
 *
 * - `eu`: a responsible person established in the EU (the GPSR on the EU market). EEA establishment outside the EU does not satisfy it.
 * - `eea`: a responsible person established in the EEA (what an incorporation into the EEA Agreement would ask, once in force there).
 * - `none`: this regulation asks for none there (for instance while it is not part of the EEA Agreement).
 *
 * A destination without a rule is held to `eu` when it is an EU member state (so the EU's rule never lapses for want of a row), else to
 * `none`. The database's `commerce.responsible_person_areas()` works out the same and backs the save; the two are tested on the same cases.
 */

export const RESPONSIBLE_AREAS = ["eu", "eea", "none"] as const;
export type ResponsibleArea = (typeof RESPONSIBLE_AREAS)[number];
/** An area a responsible person can be established in. */
export type EstablishedArea = Exclude<ResponsibleArea, "none">;

/** Where a rule stands in law: in force there, or not (yet) part of that country's law. */
export const RULE_STATUSES = ["in_force", "not_incorporated", "incorporated_not_in_force"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** The two classifications, as sets of ISO 3166-1 alpha-2 codes, and each destination's configured rule. */
export type ProductSafety = {
  eu: ReadonlySet<string>;
  eea: ReadonlySet<string>;
  rules: ReadonlyMap<string, ResponsibleArea>;
};

/** Whether a company in `country` is established in the area, by its own classification (an EU member is in the EEA because the data says so). */
export function establishedIn(area: EstablishedArea, country: string | null, safety: ProductSafety): boolean {
  if (!country) return false;
  return area === "eu" ? safety.eu.has(country) : safety.eea.has(country);
}

/** What a destination asks for: its rule, else `eu` for an EU member state and `none` for any other. */
export function ruleFor(destination: string, safety: ProductSafety): ResponsibleArea {
  return safety.rules.get(destination) ?? (safety.eu.has(destination) ? "eu" : "none");
}

/**
 * The areas a responsible person must be established in for a manufacturer in `makerCountry` selling into `destinations`: one for each
 * destination whose rule asks for one and where the manufacturer is not itself established. Empty when none is needed. `eu` first.
 */
export function responsibleAreas(makerCountry: string, destinations: readonly string[], safety: ProductSafety): EstablishedArea[] {
  const out = new Set<EstablishedArea>();
  for (const destination of destinations) {
    const rule = ruleFor(destination, safety);
    if (rule !== "none" && !establishedIn(rule, makerCountry, safety)) out.add(rule);
  }
  return (["eu", "eea"] as const).filter((a) => out.has(a));
}

/** The areas the responsible person given does not cover; empty when the product may be sold everywhere it is offered. */
export function missingResponsible(makerCountry: string, responsibleCountry: string | null, destinations: readonly string[], safety: ProductSafety): EstablishedArea[] {
  return responsibleAreas(makerCountry, destinations, safety).filter((area) => !establishedIn(area, responsibleCountry, safety));
}

/** The safety data as plain arrays, for a page to hand to the browser. */
export type ProductSafetyData = { eu: string[]; eea: string[]; rules: Record<string, ResponsibleArea> };
export const safetyData = (s: ProductSafety): ProductSafetyData => ({ eu: [...s.eu], eea: [...s.eea], rules: Object.fromEntries(s.rules) });
export const safetyOf = (d: ProductSafetyData): ProductSafety => ({ eu: new Set(d.eu), eea: new Set(d.eea), rules: new Map(Object.entries(d.rules)) });
