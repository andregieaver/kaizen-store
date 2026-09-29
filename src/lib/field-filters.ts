import { FILTER_TYPES, type FieldDef, type FieldGroup } from "./custom-fields";

/**
 * Custom fields as listing filters (D118, D78): which of a store's fields the
 * listings offer, and which values of them an address may ask for. Shared by
 * the server (facets and the query) and pure.
 */

/** The fields listings can be filtered by: public, flagged `filter`, of a type that holds a choice or a yes or no, at the top of an active group that can be on a product. The first of a name wins, so an address names one field. */
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
