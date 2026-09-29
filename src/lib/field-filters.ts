import { FILTER_TYPES, type FieldDef, type FieldGroup } from "./custom-fields";

/**
 * Custom fields as listing filters (D118, D78): which of a store's fields the
 * listings offer, and which values of them an address may ask for. Shared by
 * the server (facets and the query) and pure.
 */

/** The fields listings can be filtered by: public, flagged `filter`, of a type that holds a choice, a yes or no, or a number (a range), at the top of an active group that can be on a product. The first of a name wins, so an address names one field. */
export function filterableFields(groups: readonly FieldGroup[]): FieldDef[] {
  const found = new Map<string, FieldDef>();
  for (const group of groups) {
    if (!group.active || !group.entities.includes("product")) continue;
    for (const def of group.fields) {
      if (def.access === "public" && def.filter && FILTER_TYPES.includes(def.type) && !found.has(def.name))
        found.set(def.name, def);
    }
  }
  return [...found.values()];
}

/** The value a yes or no filter asks for in an address. */
export const YES = "1";

/** What an address asked of a field, kept to what the field can hold: a choice's keys, or `1` for a yes or no. */
export function fieldFilterValues(def: FieldDef, values: readonly string[]): string[] {
  if (def.type === "boolean") return values.includes(YES) ? [YES] : [];
  const keys = new Set((def.choices ?? []).map((choice) => choice.key));
  return [...new Set(values.filter((value) => keys.has(value)))];
}

/**
 * Number and measurement fields are filtered as a range (`f.weight.min=100&f.weight.max=500`,
 * in the field's own numbers). A number field's `unit` is only shown after
 * it. A measurement's value is `{ value, unit }` in any of the field's units
 * and nothing converts between units, so the range compares the values
 * entered in the field's first unit (its default) and says which.
 */
export type RangeField = { def: FieldDef; kind: "number" | "measurement"; unit: string };

export const isRangeField = (def: FieldDef): boolean => def.type === "number" || def.type === "measurement";

/** The range filters among filterable fields, each with the unit it compares in (empty for a number without one). */
export function rangeFields(defs: readonly FieldDef[]): RangeField[] {
  return defs.filter(isRangeField).map((def) =>
    def.type === "measurement"
      ? { def, kind: "measurement" as const, unit: def.units?.[0] ?? "" }
      : { def, kind: "number" as const, unit: def.unit ?? "" },
  );
}

/** The fields offered as a choice or a yes or no: the filterable ones that are not ranges. */
export const choiceFields = (defs: readonly FieldDef[]): FieldDef[] => defs.filter((def) => !isRangeField(def));

/** A range as a shopper reads it: `100–500 g`, `≥ 100 g`, `≤ 500 g`; numbers in the market's way of writing them. */
export function rangeText(min: number | null, max: number | null, unit: string, locale: string): string {
  const format = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n);
  const suffix = unit ? ` ${unit}` : "";
  if (min !== null && max !== null) return `${format(min)}–${format(max)}${suffix}`;
  if (min !== null) return `≥ ${format(min)}${suffix}`;
  return `≤ ${format(max ?? 0)}${suffix}`;
}
