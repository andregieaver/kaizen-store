/**
 * Postgres array literals for `= any(${…}::text[])` and `::uuid[]` (D165): every value quoted and escaped, so a value from a file or a form can
 * hold a quote, a comma or a brace and stays one element. Kept apart from the CSV modules, whose scan test refuses a hand-made `join(",")`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMA = String.fromCharCode(44);

/** A text array literal of values. */
export const pgTextArray = (values: readonly string[]): string => `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(COMMA)}}`;

/** A uuid array literal; anything that is not a uuid is left out (it could not match, and would not cast). */
export const pgUuidArray = (values: readonly string[]): string => `{${values.filter((v) => UUID.test(v)).join(COMMA)}}`;
