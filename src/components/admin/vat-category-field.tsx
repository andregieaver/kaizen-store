import { categoriesFor, describeRate, isBuiltInVatCategory, ratePercent, VAT_CATEGORIES, VAT_CATEGORY_LABELS, type VatCategoryRow } from "@/lib/vat";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

/** The field's words (D312 A5): English unless the editor hands in the admin's catalogue (`product.vatCategory`). */
const ENGLISH = {
  label: "VAT category",
  inactive: " (inactive)",
  switchedOff: "This category has been switched off. The product keeps it, but it cannot be chosen for other products.",
  /** The built-in categories' names and what they are for; the platform's own categories keep the words it gave them. */
  builtIn: VAT_CATEGORY_LABELS as Record<string, { label: string; hint: string }>,
  noVat: "no VAT",
  fallback: "no reduced rate known here: the standard rate ({rate}) applies",
};

export type VatCategoryWords = typeof ENGLISH;

/** The categories to offer when the editor's context carries none: the three that are always there. */
const BUILT_IN_ROWS: VatCategoryRow[] = VAT_CATEGORIES.map((code, sort) => ({
  code,
  nameEn: VAT_CATEGORY_LABELS[code].label,
  description: VAT_CATEGORY_LABELS[code].hint,
  sort,
  active: true,
  builtIn: true,
}));

/**
 * The product editor's VAT category (D65, D157): a select of the platform's active categories (`categoriesFor()`: accommodation only
 * for stays and rentals; a product keeps a category that was switched off, marked inactive), with what the category is for and, for each of
 * the store's markets, the rate now, or that no reduced rate is known there and the standard rate applies (`describeRate()`). Saving checks
 * the category again on the server.
 */
export function VatCategoryField({
  category,
  kind,
  categories,
  markets,
  onChange,
  words = ENGLISH,
}: {
  category: string;
  kind: string;
  categories: VatCategoryRow[];
  markets: { code: string; name: string; vatRates: Record<string, number>; vatRows: Record<string, boolean> }[];
  onChange: (category: string) => void;
  words?: VatCategoryWords;
}) {
  const translated = words !== ENGLISH;
  // A built-in category in the admin's language; any other in the words the platform gave it.
  const nameOf = (c: VatCategoryRow) => (translated && isBuiltInVatCategory(c.code) ? words.builtIn[c.code]?.label ?? c.nameEn : c.nameEn);
  const options = categoriesFor(categories.length > 0 ? categories : BUILT_IN_ROWS, { kind, current: category });
  const chosen = options.find((c) => c.code === category);
  const description =
    chosen &&
    (translated && isBuiltInVatCategory(chosen.code)
      ? words.builtIn[chosen.code]?.hint ?? chosen.description
      : chosen.description || (chosen.code in VAT_CATEGORY_LABELS ? VAT_CATEGORY_LABELS[chosen.code as keyof typeof VAT_CATEGORY_LABELS].hint : ""));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className={label}>
        {words.label}
        <select value={category} onChange={(e) => onChange(e.target.value)} className={`${input} sm:max-w-sm`}>
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {nameOf(c)}
              {c.inactive ? words.inactive : ""}
            </option>
          ))}
        </select>
      </label>
      {description && <p className="text-muted">{description}</p>}
      {chosen?.inactive && <p className="text-muted">{words.switchedOff}</p>}
      {category !== "exempt" && (
        <ul className="flex flex-col gap-0.5 text-muted">
          {markets.map((m) => {
            const standard = m.vatRates.standard ?? 0;
            const described = describeRate({ category, rate: m.vatRates[category] ?? standard, standardRate: standard, hasRow: m.vatRows[category] ?? false });
            // `describeRate()`'s words are English; only its two sentences need others (a rate is a figure).
            const text = !translated
              ? described.text
              : described.fallback
                ? words.fallback.replace("{rate}", ratePercent(standard))
                : category === "exempt"
                  ? words.noVat
                  : described.text;
            return (
              <li key={m.code}>
                {m.name}: {text}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
