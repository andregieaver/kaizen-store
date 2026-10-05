/**
 * Custom fields as one cell of a CSV (D165, `docs/wave-2-data.md` 4.1.4), pure.
 *
 * Only a field whose value is plain text in a cell has a column; the rest (a group, a repeater, flexible content, a gallery, a
 * picture, a video, a file, rich text, a link, and the relations to products, pages and terms) are neither read nor written, so an
 * import leaves them as they are. The exact set is `PLAIN_FIELD_TYPES`. A value goes out as `plainFieldText()` and comes back through
 * `parsePlainField()`, which is the field's own `parseValue()` (so a file can never put in what the form would refuse); a blank cell
 * is `null`, which takes the value away. Choices are written by their KEY (stable), a measurement as "250 g", money as "12.50 NOK",
 * a checkbox list as "a | b".
 */
import { amountText, isMoney, parseAmount } from "./field-money";
import { isCurrency } from "./money";
import { parseValue, type FieldDef, type FieldMeasurement, type FieldType, type FieldValue } from "./custom-fields";

/** The types a CSV column can hold. Group, repeater, flexible, gallery, image, video, file, richText, link, product, page and term are not here. */
export const PLAIN_FIELD_TYPES = [
  "text", "textarea", "number", "measurement", "email", "url", "phone", "select", "radio", "buttons", "checkbox", "boolean", "date", "datetime", "time", "color", "money",
] as const satisfies readonly FieldType[];
export type PlainFieldType = (typeof PLAIN_FIELD_TYPES)[number];

export const isPlainFieldType = (type: string): type is PlainFieldType => (PLAIN_FIELD_TYPES as readonly string[]).includes(type);
export const isPlainField = (def: Pick<FieldDef, "type">): boolean => isPlainFieldType(def.type);

/** The separator of a list in one cell (categories, tags, a checkbox's keys). */
export const LIST_SEPARATOR = " | ";

/** The cell text for a stored value. Empty for no value. */
export function plainFieldText(def: FieldDef, value: FieldValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  switch (def.type) {
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "measurement": {
      const m = value as FieldMeasurement;
      return typeof m === "object" && m && typeof m.value === "number" ? `${m.value} ${m.unit}`.trim() : "";
    }
    case "money":
      return isMoney(value) && isCurrency(value.currency) ? `${amountText(value.amountMinor, value.currency)} ${value.currency}` : "";
    case "boolean":
      return value === true ? "true" : value === false ? "false" : "";
    case "checkbox":
      return Array.isArray(value) ? (value as string[]).join(LIST_SEPARATOR) : "";
    default:
      return typeof value === "string" ? value : "";
  }
}

/** Whether the cell text of a field can be written as a number cell (so a spreadsheet reads a number, and `-5` is not made text). */
export const isNumberCell = (def: Pick<FieldDef, "type">, text: string): boolean => def.type === "number" && /^-?\d+(\.\d+)?$/.test(text);

export type PlainParsed = { ok: true; value: FieldValue | null } | { ok: false; problem: string };

/** The value a cell's text stands for, checked by the field's own rules. A blank cell is `null` (take the value away). */
export function parsePlainField(def: FieldDef, text: string): PlainParsed {
  if (!isPlainField(def)) return { ok: false, problem: "This kind of field is not in the file." };
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  switch (def.type) {
    case "number":
      return parseValue(def, t);
    case "measurement": {
      const match = /^(-?[\d.,]+)\s*(\S*)$/.exec(t);
      if (!match) return { ok: false, problem: "Write a number and a unit." };
      return parseValue(def, { value: match[1], unit: match[2] });
    }
    case "money": {
      const match = /^([\d.,]+)\s+([A-Za-z]{3})$/.exec(t);
      if (!match) return { ok: false, problem: "Write an amount and a currency, like 12.50 NOK." };
      const code = match[2].toUpperCase();
      const minor = parseAmount(match[1], code);
      if (minor === null) return { ok: false, problem: "That is not an amount in that currency." };
      return parseValue(def, { amountMinor: minor, currency: code });
    }
    case "boolean": {
      const v = t.toLowerCase();
      if (["true", "yes", "1", "ja"].includes(v)) return parseValue(def, true);
      if (["false", "no", "0", "nei", "nej"].includes(v)) return parseValue(def, false);
      return { ok: false, problem: "Write true or false." };
    }
    case "checkbox":
      return parseValue(def, t.split("|").map((k) => k.trim()).filter((k) => k !== ""));
    default:
      return parseValue(def, t);
  }
}
