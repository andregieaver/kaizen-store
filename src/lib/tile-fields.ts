import type { FieldDef, FieldEntity, FieldGroup, ShownField, ShownGroup } from "./custom-fields";
import { TILE_FIELDS_MAX, type ContentGridBlock } from "./page-content";

/**
 * Custom fields on a content grid's tiles (D120): a tile shows up to three
 * of the items' public fields under its title, one line each ("Label: value"),
 * as plain words in the shopper's language. Only the types that have plain
 * text qualify: pictures, files, links, relations and structures are left to
 * the components that draw them. Pure, so the builder's picker and the
 * server's batch read (`src/server/field-tiles.ts`) agree on which fields
 * these are.
 */

/** A field on a tile: its label and its value as words. */
export type TileField = { label: string; text: string };

/** The types whose value is plain text on a tile. */
export const TILE_FIELD_TYPES: readonly string[] = [
  "text",
  "number",
  "measurement",
  "money",
  "select",
  "radio",
  "buttons",
  "checkbox",
  "boolean",
  "date",
  "datetime",
  "time",
];

export const isTileFieldType = (type: string): boolean => TILE_FIELD_TYPES.includes(type);

/** The longest a line on a tile is. */
export const TILE_TEXT_MAX = 120;

/** The kind of thing a grid's tiles are, for the fields that can be on them. */
export const tileEntity = (source: ContentGridBlock["source"]): Extract<FieldEntity, "product" | "page" | "article"> =>
  source.type === "products" ? "product" : source.type === "articles" ? "article" : "page";

/** The plain top-level fields of the groups that can be on the tiles' kind of thing, by group, for choosing. */
export function tileFieldOptions(groups: readonly FieldGroup[]): { group: FieldGroup; fields: FieldDef[] }[] {
  return groups
    .map((group) => ({ group, fields: group.fields.filter((def) => isTileFieldType(def.type)) }))
    .filter((option) => option.fields.length > 0);
}

/** The ids a grid asks for: known, once each, at most three. */
export const tileFieldIds = (block: Pick<ContentGridBlock, "tileFields">): string[] =>
  [...new Set(block.tileFields ?? [])].slice(0, TILE_FIELDS_MAX);

/**
 * The lines a tile shows for an item, in the order the grid names them, from the
 * item's public fields by group: those of a plain type with something to say.
 */
export function tileLines(groups: readonly ShownGroup[], ids: readonly string[]): TileField[] {
  const found = new Map<string, ShownField>();
  for (const group of groups) for (const field of group.fields) if (!found.has(field.id)) found.set(field.id, field);
  return ids.flatMap((id): TileField[] => {
    const field = found.get(id);
    const text = field && isTileFieldType(field.type) ? field.text.trim().slice(0, TILE_TEXT_MAX) : "";
    return field && text ? [{ label: field.label, text }] : [];
  });
}
