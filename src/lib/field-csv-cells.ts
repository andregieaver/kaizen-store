/** Small helpers the product and customer files share for custom fields in cells (D165): which fields have a column, and a field's cell. */
import type { FieldDef } from "./custom-fields";
import type { Cell } from "./csv";
import { isNumberCell, isPlainField } from "./field-csv";

/** The plain fields with a name no other field of the list has: the ones a column can name. */
export function addressableFieldsOf(fields: readonly FieldDef[]): FieldDef[] {
  const plain = fields.filter((d) => isPlainField(d));
  const count = new Map<string, number>();
  for (const d of plain) count.set(d.name, (count.get(d.name) ?? 0) + 1);
  return plain.filter((d) => count.get(d.name) === 1);
}

/** A field's cell from its text: empty is nothing, a plain number is a number cell (so a spreadsheet reads it, and `-5` is not made text). */
export function fieldCell(def: FieldDef, value: string): Cell {
  if (value === "") return null;
  return isNumberCell(def, value) ? { num: value } : value;
}
