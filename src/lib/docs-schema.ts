import type { z } from "zod";

/**
 * JSON Schema read for the docs' generated reference (wave 14 unit E4, D442): a schema as the rows of a table (each field with its type,
 * whether it is required and its words, a union's shapes as tables of their own), and an example value valid against the operation's own
 * zod. The schemas are the published contract's (`z.toJSONSchema()`, draft 2020-12, as `jsonSchemaOf()` and the MCP catalogue write them),
 * so a new operation, topic or tool is read the same way with nothing written by hand. Pure.
 */

export type JsonSchema = { [key: string]: unknown };

const isSchema = (value: unknown): value is JsonSchema => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const SAFE = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------------------------------------------------
// Writing Markdown the docs' parser reads back exactly (`docs-markdown.ts`)
// ---------------------------------------------------------------------------------------------------------------------

const ESCAPABLE = "\\`*_{}[]()#+-.!|<>~";

/** Plain words as Markdown: only what would read as a mark is escaped (`*`, a `_` at a word's edge, `[`, a tag's `<`, a backslash before a mark). */
function escapeWords(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const before = text[i - 1] ?? " ";
    const after = text[i + 1] ?? " ";
    const word = (c: string) => /[\p{L}\p{N}]/u.test(c);
    if (char === "\\" && ESCAPABLE.includes(after)) out += "\\\\";
    else if (char === "*" || char === "[" || char === "]") out += `\\${char}`;
    else if (char === "_" && !(word(before) && word(after))) out += "\\_";
    else if (char === "<" && /[A-Za-z/!?]/.test(after)) out += "\\<";
    else out += char;
  }
  return out;
}

/** Words as Markdown text: what the parser would read as a mark is escaped, code spans (`…`) kept as they are. */
export function mdText(text: string): string {
  const parts = text.split(/(`+)/);
  // Code spans only where the backticks pair up; otherwise every backtick is a character.
  const ticks = parts.filter((part, i) => i % 2 === 1);
  const paired = ticks.length % 2 === 0;
  let inCode = false;
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        if (!paired) return "\\`".repeat(part.length);
        inCode = !inCode;
        return part;
      }
      return inCode ? part : escapeWords(part);
    })
    .join("")
    .replace(/^(\s*)([-+#>]|\d+[.)])(?=\s)/, "$1\\$2");
}

/** Words for a table's cell: one line. */
export const mdCell = (text: string): string => mdText(text.replace(/\s*\n\s*/g, " ").trim());

/** A cell's `|`s escaped, in code too (as GitHub's tables read them), unless a backslash already escapes one. */
function pipes(cell: string): string {
  let out = "";
  let slashes = 0;
  for (const char of cell) {
    if (char === "|" && slashes % 2 === 0) out += "\\|";
    else out += char;
    slashes = char === "\\" ? slashes + 1 : 0;
  }
  return out;
}

/** Text as an inline code span, with as many backticks around it as it needs. */
export function mdCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A fenced code block in a language the docs colour. */
export function mdFence(lang: string, code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/^ {0,3}(`{3,})/gm)].map((m) => m[1].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${code}\n${fence}`;
}

/** A table: its head and rows, each cell already Markdown for one line. */
export function mdTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map((c) => (c === "" ? " " : pipes(c))).join(" | ")} |`;
  return [line(head), `|${head.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

/** A heading's id from a name: `products.get` → `products-get`, `list_products` → `list-products`. */
export const anchorOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

// ---------------------------------------------------------------------------------------------------------------------
// Reading a schema
// ---------------------------------------------------------------------------------------------------------------------

/** `X or null` as zod writes it (`anyOf: [X, { type: "null" }]`): the X with the outer words kept, and whether null is allowed. */
export function unwrapNullable(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const branches = (schema.anyOf ?? schema.oneOf) as unknown;
  if (Array.isArray(branches)) {
    const others = branches.filter((b) => !(isSchema(b) && b.type === "null"));
    if (others.length < branches.length && others.length === 1 && isSchema(others[0])) {
      const outer = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "anyOf" && key !== "oneOf"));
      return { schema: { ...others[0], ...outer }, nullable: true };
    }
    if (others.length < branches.length) {
      const outer = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "anyOf" && key !== "oneOf"));
      return { schema: { ...outer, anyOf: others }, nullable: true };
    }
  }
  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const types = schema.type.filter((t) => t !== "null");
    return { schema: { ...schema, type: types.length === 1 ? types[0] : types }, nullable: true };
  }
  return { schema, nullable: false };
}

const branchesOf = (schema: JsonSchema): JsonSchema[] | null => {
  const list = (schema.anyOf ?? schema.oneOf) as unknown;
  return Array.isArray(list) && list.length > 0 ? list.filter(isSchema) : null;
};

const isObjectSchema = (schema: JsonSchema): boolean => schema.type === "object" || isSchema(schema.properties);
const propertiesOf = (schema: JsonSchema): Record<string, JsonSchema> =>
  isSchema(schema.properties) ? (Object.fromEntries(Object.entries(schema.properties).filter(([, v]) => isSchema(v))) as Record<string, JsonSchema>) : {};
const requiredOf = (schema: JsonSchema): string[] => (Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
const recordValue = (schema: JsonSchema): JsonSchema | null =>
  isObjectSchema(schema) && Object.keys(propertiesOf(schema)).length === 0 && isSchema(schema.additionalProperties) ? schema.additionalProperties : null;

/** Whether a schema, or one of its shapes, holds fields of its own (an object with properties, or a list of them). */
function hasFields(schema: JsonSchema): boolean {
  const { schema: s } = unwrapNullable(schema);
  const branches = branchesOf(s);
  if (branches) return branches.some(hasFields);
  if (Object.keys(propertiesOf(s)).length > 0) return true;
  if (isSchema(s.items)) return hasFields(s.items);
  const value = recordValue(s);
  return value ? hasFields(value) : false;
}

/** The property every shape of a union names with a constant of its own (`kind`), if there is one. */
export function discriminatorOf(branches: readonly JsonSchema[]): string | null {
  if (branches.length < 2) return null;
  const first = propertiesOf(branches[0]);
  for (const key of Object.keys(first)) {
    const values = branches.map((b) => propertiesOf(b)[key]?.const);
    if (values.every((v) => v !== undefined) && new Set(values.map((v) => JSON.stringify(v))).size === branches.length) return key;
  }
  return null;
}

const number = (n: number) => n.toLocaleString("en-US");

function range(min: unknown, max: unknown, unit: (n: number) => string): string | null {
  const lo = typeof min === "number" && min > -SAFE ? min : null;
  const hi = typeof max === "number" && max < SAFE ? max : null;
  if (lo !== null && hi !== null) return lo === hi ? unit(lo) : `${number(lo)} to ${unit(hi)}`;
  if (lo !== null) return `at least ${unit(lo)}`;
  if (hi !== null) return `at most ${unit(hi)}`;
  return null;
}

const plural = (word: string) => (n: number) => `${number(n)} ${word}${n === 1 ? "" : "s"}`;

/** A field's type in a few words, as Markdown for a table's cell: `string (uuid)`, `integer, 1 to 100`, one of `a`, `b`. */
export function typeText(schema: JsonSchema): string {
  const { schema: s, nullable } = unwrapNullable(schema);
  const text = baseType(s);
  return nullable ? `${text} or null` : text;
}

function baseType(s: JsonSchema): string {
  if (s.const !== undefined) return mdCode(JSON.stringify(s.const));
  if (Array.isArray(s.enum)) {
    const values = s.enum.map((v) => mdCode(typeof v === "string" ? v : JSON.stringify(v)));
    return values.length === 1 ? values[0] : `one of ${values.join(", ")}`;
  }
  const branches = branchesOf(s);
  if (branches) {
    if (branches.some(hasFields)) {
      const by = discriminatorOf(branches);
      return by ? `one of ${branches.length} shapes, by ${mdCode(by)}` : `one of ${branches.length} shapes`;
    }
    return [...new Set(branches.map(typeText))].join(" or ");
  }
  const type = Array.isArray(s.type) ? s.type.join(" or ") : s.type;
  if (type === "array" || isSchema(s.items)) {
    const items = isSchema(s.items) ? s.items : {};
    const inner = unwrapNullable(items);
    const word = hasFields(items) ? (branchesOf(inner.schema) ? "shapes" : "objects") : typeText(items);
    const count = range(s.minItems, s.maxItems, plural("item"));
    return `list of ${word}${count ? `, ${count}` : ""}`;
  }
  if (type === "object" || isSchema(s.properties)) {
    const value = recordValue(s);
    if (value) {
      const keys = isSchema(s.propertyNames) ? baseType({ type: "string", ...s.propertyNames }) : "string";
      return `map of ${keys} to ${hasFields(value) ? "objects" : typeText(value)}`;
    }
    return "object";
  }
  if (type === "string") {
    const format = typeof s.format === "string" ? ` (${s.format})` : "";
    const length = range(s.minLength, s.maxLength, plural("character"));
    const pattern = typeof s.pattern === "string" && !format ? `, matching ${mdCode(s.pattern)}` : "";
    return `string${format}${length ? `, ${length}` : ""}${pattern}`;
  }
  if (type === "integer" || type === "number") {
    const bounds = range(s.minimum ?? s.exclusiveMinimum, s.maximum ?? s.exclusiveMaximum, number);
    return `${type}${bounds ? `, ${bounds}` : ""}`;
  }
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  return typeof type === "string" ? type : "any";
}

// ---------------------------------------------------------------------------------------------------------------------
// A schema as tables
// ---------------------------------------------------------------------------------------------------------------------

export type SchemaRow = { name: string; type: string; required: boolean; defaultValue: unknown; description: string };
/** A table of fields; a union's shapes are tables of their own, each with its title. */
export type SchemaTable = { title: string | null; rows: SchemaRow[]; shapes: SchemaTable[] };

const join = (path: string, name: string) => (path ? `${path}.${name}` : name);
const describe = (s: JsonSchema): string => (typeof s.description === "string" ? s.description.trim() : "");

/** Every field of a schema as rows, its unions' shapes as tables of their own. An object's fields are its rows; anything else is one row. */
export function schemaTable(schema: JsonSchema, rootName = "body"): SchemaTable {
  const table: SchemaTable = { title: null, rows: [], shapes: [] };
  const { schema: s } = unwrapNullable(schema);
  const branches = branchesOf(s);
  if (branches && branches.some(hasFields)) {
    shapesOf(branches, "", table);
    return table;
  }
  if (Object.keys(propertiesOf(s)).length > 0) {
    fieldsOf(s, "", table);
    return table;
  }
  walk(schema, rootName, true, table);
  return table;
}

function fieldsOf(s: JsonSchema, path: string, table: SchemaTable): void {
  const required = new Set(requiredOf(s));
  for (const [name, inner] of Object.entries(propertiesOf(s))) walk(inner, join(path, name), required.has(name), table);
}

function walk(schema: JsonSchema, path: string, required: boolean, table: SchemaTable): void {
  const { schema: s } = unwrapNullable(schema);
  table.rows.push({ name: path, type: typeText(schema), required, defaultValue: schema.default ?? s.default, description: describe(schema) || describe(s) });
  const branches = branchesOf(s);
  if (branches && branches.some(hasFields)) {
    shapesOf(branches, path, table);
    return;
  }
  if (Object.keys(propertiesOf(s)).length > 0) {
    fieldsOf(s, path, table);
    return;
  }
  if (isSchema(s.items)) {
    const items = unwrapNullable(s.items).schema;
    const itemBranches = branchesOf(items);
    if (itemBranches && itemBranches.some(hasFields)) shapesOf(itemBranches, `${path}[]`, table);
    else if (Object.keys(propertiesOf(items)).length > 0) fieldsOf(items, `${path}[]`, table);
    return;
  }
  const value = recordValue(s);
  if (value && hasFields(value)) {
    const inner = unwrapNullable(value).schema;
    if (Object.keys(propertiesOf(inner)).length > 0) fieldsOf(inner, `${path}.{key}`, table);
  }
}

function shapesOf(branches: readonly JsonSchema[], path: string, table: SchemaTable): void {
  const by = discriminatorOf(branches);
  branches.forEach((branch, i) => {
    const constant = by ? propertiesOf(branch)[by]?.const : undefined;
    const where = path ? mdCode(path) : "The body";
    const title = by
      ? `${where} when ${mdCode(by)} is ${mdCode(typeof constant === "string" ? constant : JSON.stringify(constant))}`
      : `${where}, shape ${i + 1} of ${branches.length}`;
    const shape: SchemaTable = { title, rows: [], shapes: [] };
    const { schema: b } = unwrapNullable(branch);
    if (Object.keys(propertiesOf(b)).length > 0) fieldsOf(b, path, shape);
    else walk(branch, path || "body", true, shape);
    const words = describe(branch);
    if (words && shape.rows.length > 0 && !shape.rows[0].description) shape.title = `${title}: ${mdText(words)}`;
    table.shapes.push(shape);
  });
}

/** How many rows a table and its shapes hold. */
export const rowCount = (table: SchemaTable): number => table.rows.length + table.shapes.reduce((n, s) => n + rowCount(s), 0);

/**
 * A table as Markdown: Field, Type, (Required,) Description, then each shape's table under its title in bold. `input` adds the Required
 * column (what a caller sends); an answer's or a payload's fields are all there, so it has none.
 */
export function schemaMarkdown(table: SchemaTable, input: boolean): string {
  const out: string[] = [];
  if (table.rows.length > 0) {
    const head = input ? ["Field", "Type", "Required", "Description"] : ["Field", "Type", "Description"];
    const rows = table.rows.map((row) => {
      const cells = [mdCode(row.name), row.type, mdCell(row.description)];
      if (!input) return cells;
      const required = row.required ? "yes" : row.defaultValue !== undefined ? `no, default ${mdCode(JSON.stringify(row.defaultValue))}` : "no";
      return [cells[0], cells[1], required, cells[2]];
    });
    out.push(mdTable(head, rows));
  }
  for (const shape of table.shapes) {
    out.push(`**${shape.title}**`);
    out.push(schemaMarkdown({ ...shape, title: null }, input));
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Example values
// ---------------------------------------------------------------------------------------------------------------------

/** The id the examples give a field named `id`: a valid UUID (version 4), so any id check takes it. */
export const EXAMPLE_ID = "3f2b8c1e-6d4a-4b9e-8c7f-1a2b3c4d5e6f";

/** An example id for a field, the same for the same name and another for another (a variant's and a location's differ): a valid UUID v4. */
export function exampleId(name: string | null): string {
  if (!name || name === "id") return EXAMPLE_ID;
  let hash = 0x811c9dc5;
  let hex = "";
  for (let round = 0; hex.length < 32; round++) {
    for (const char of `${round}:${name}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    hex += hash.toString(16).padStart(8, "0");
  }
  const digits = hex.slice(0, 32).split("");
  digits[12] = "4";
  digits[16] = "89ab"[parseInt(digits[16], 16) % 4];
  const d = digits.join("");
  return `${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${d.slice(20)}`;
}
const EXAMPLE_TIME = "2026-11-03T09:30:00Z";

/** Values for fields by their name, used when they fit the field's schema: what such a field usually holds. */
const NAMED: Record<string, readonly unknown[]> = {
  title: ["Linen shirt"],
  name: ["Example"],
  email: ["ada@example.com"],
  phone: ["+47 912 34 567"],
  code: ["SPRING10"],
  tag: ["vip"],
  sku: ["SHIRT-M"],
  handle: ["linen-shirt"],
  slug: ["your-store"],
  store: ["your-store"],
  // A kept cart's key (`kfc_` and 43 characters), as the storefront API gives it.
  cart: ["kfc_q3Vx9LmT2pZr7KcW4nBf8YdH1sJe6GaUo0iXtNvQwEk"],
  currency: ["NOK", "EUR"],
  country: ["NO"],
  market: ["NO"],
  language: ["nb"],
  locale: ["nb"],
  note: ["Counted on Monday"],
  text: ["Gift message"],
  message: ["We do not deliver there yet."],
  description: ["Soft, breathable linen."],
  query: ["linen"],
  number: ["1001"],
  order_number: ["1001"],
  customer_name: ["Ada Lovelace"],
  line1: ["Storgata 1"],
  line2: [""],
  postal_code: ["0155"],
  city: ["Oslo"],
  tracking_number: ["70712345678901234"],
  tracking_url: ["https://tracking.example.com/70712345678901234"],
  url: ["https://example.com"],
  admin_url: ["https://kaizenaflow.com/admin/your-store"],
  quantity: [1],
  stock: [10],
  label: ["Gift message"],
};

/** Strings for patterns zod writes often, before the pattern is read generally. */
const PATTERNS: Record<string, string> = {
  "^[A-Z]{3}$": "NOK",
  "^[A-Z]{2}$": "NO",
  "^[A-Za-z]{2}$": "NO",
  "^[a-z]{2}(-[A-Z]{2})?$": "nb",
};

/** Ids by name: a variant's, a product's or a location's id where the field has no format of its own. */
const ID_NAME = /(?:^|_)id$|Id$/;

/** The example a field's own words give: `such as {"Size": "M"}`, `such as "120"`, `such as NOK or EUR`, `such as 199.5`. */
export function describedExample(description: string): unknown[] {
  const out: unknown[] = [];
  for (const match of description.matchAll(/such as (\{[^}]*\}|\[[^\]]*\]|"[^"]*"|[^\s,;)]+)/g)) {
    const raw = match[1];
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        out.push(JSON.parse(raw));
      } catch {
        // Not JSON: no example.
      }
      continue;
    }
    const text = raw.startsWith('"') ? raw.slice(1, -1) : raw.replace(/[.:]$/, "");
    if (text === "") continue;
    out.push(text);
    if (/^-?\d+(?:\.\d+)?$/.test(text)) out.push(Number(text));
  }
  return out;
}

/** A string a simple pattern matches (classes, groups, alternatives, counts): the shortest such, or null for one it cannot read. */
export function stringMatching(pattern: string): string | null {
  let i = 0;
  const peek = () => pattern[i];
  const classChar = (body: string, negated: boolean): string => {
    const chars: string[] = [];
    for (let j = 0; j < body.length; j++) {
      let c = body[j];
      if (c === "\\") {
        j++;
        c = body[j];
        if (c === "d") chars.push(..."0123456789");
        else if (c === "w") chars.push(..."abcdefghijklmnopqrstuvwxyz0123456789_");
        else if (c === "s") chars.push(" ");
        else chars.push(c);
        continue;
      }
      if (body[j + 1] === "-" && j + 2 < body.length) {
        const end = body[j + 2];
        for (let code = c.charCodeAt(0); code <= end.charCodeAt(0); code++) chars.push(String.fromCharCode(code));
        j += 2;
        continue;
      }
      chars.push(c);
    }
    if (negated) return ["a", "x", "0", "-"].find((c) => !chars.includes(c)) ?? "~";
    return ["a", "A", "0"].find((c) => chars.includes(c)) ?? chars[0] ?? "a";
  };
  const atom = (): string | null => {
    const c = pattern[i];
    if (c === "(") {
      i++;
      if (pattern.startsWith("?:", i)) i += 2;
      else if (pattern[i] === "?") return null;
      const inner = alternatives();
      if (inner === null || pattern[i] !== ")") return null;
      i++;
      return inner;
    }
    if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) return null;
      let body = pattern.slice(i + 1, end);
      i = end + 1;
      const negated = body.startsWith("^");
      if (negated) body = body.slice(1);
      return classChar(body, negated);
    }
    if (c === "\\") {
      const e = pattern[i + 1];
      i += 2;
      if (e === "d") return "0";
      if (e === "w") return "a";
      if (e === "s") return " ";
      if (e === "D" || e === "W" || e === "S") return "a";
      if (e === "b" || e === "B") return "";
      return e ?? null;
    }
    if (c === ".") {
      i++;
      return "a";
    }
    if (c === "^" || c === "$") {
      i++;
      return "";
    }
    i++;
    return c;
  };
  const term = (): string | null => {
    const value = atom();
    if (value === null) return null;
    let times = 1;
    const c = peek();
    if (c === "*" || c === "?") {
      times = 0;
      i++;
    } else if (c === "+") {
      i++;
    } else if (c === "{") {
      const count = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      if (!count) return null;
      times = Number(count[1]);
      i += count[0].length;
    }
    if (peek() === "?") i++;
    return value.repeat(times);
  };
  const sequence = (): string | null => {
    let out = "";
    while (i < pattern.length && peek() !== "|" && peek() !== ")") {
      const value = term();
      if (value === null) return null;
      out += value;
    }
    return out;
  };
  const alternatives = (): string | null => {
    const first = sequence();
    while (peek() === "|") {
      i++;
      if (sequence() === null) return null;
    }
    return first;
  };
  const result = alternatives();
  if (result === null || i < pattern.length) return null;
  try {
    return new RegExp(pattern, "u").test(result) ? result : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value keeps a scalar schema's own rules: its type, constant, choices, lengths, bounds, pattern and format. */
export function fitsScalar(value: unknown, schema: JsonSchema): boolean {
  const { schema: s, nullable } = unwrapNullable(schema);
  if (value === null) return nullable || s.type === "null";
  if (s.const !== undefined) return JSON.stringify(s.const) === JSON.stringify(value);
  if (Array.isArray(s.enum)) return s.enum.some((v) => JSON.stringify(v) === JSON.stringify(value));
  const branches = branchesOf(s);
  if (branches) return branches.some((b) => fitsScalar(value, b));
  const type = s.type;
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (typeof s.minLength === "number" && value.length < s.minLength) return false;
    if (typeof s.maxLength === "number" && value.length > s.maxLength) return false;
    if (typeof s.pattern === "string") {
      try {
        if (!new RegExp(s.pattern, "u").test(value)) return false;
      } catch {
        return false;
      }
    }
    if (s.format === "uuid" && !UUID.test(value)) return false;
    if (s.format === "date-time" && Number.isNaN(Date.parse(value))) return false;
    if (s.format === "email" && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value)) return false;
    if ((s.format === "uri" || s.format === "url") && !/^https?:\/\/\S+$/.test(value)) return false;
    return true;
  }
  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (type === "integer" && !Number.isInteger(value)) return false;
    if (typeof s.minimum === "number" && value < s.minimum) return false;
    if (typeof s.maximum === "number" && value > s.maximum) return false;
    if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) return false;
    if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) return false;
    if (typeof s.multipleOf === "number" && value % s.multipleOf !== 0) return false;
    return true;
  }
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

/** What an example prefers: among choices, one of these words first (a topic's own: `order.paid` prefers `paid`). */
export type ExampleHints = { words?: readonly string[] };

function numberIn(s: JsonSchema, integer: boolean): number {
  const min = typeof s.minimum === "number" ? s.minimum : typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum + (integer ? 1 : 0.5) : null;
  const max = typeof s.maximum === "number" ? s.maximum : typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum - (integer ? 1 : 0.5) : null;
  const step = typeof s.multipleOf === "number" ? s.multipleOf : 1;
  let value = step;
  if (min !== null && value < min) value = Math.ceil(min / step) * step;
  if (max !== null && value > max) value = Math.floor(max / step) * step;
  return value;
}

/** The candidates for a scalar, the best first, each fitting its schema: its own words' example, its name's, its format's, its pattern's. */
export function scalarCandidates(schema: JsonSchema, name: string | null, hints: ExampleHints = {}): unknown[] {
  const { schema: s, nullable } = unwrapNullable(schema);
  const out: unknown[] = [];
  const add = (value: unknown) => {
    if (value !== undefined && !out.some((v) => JSON.stringify(v) === JSON.stringify(value)) && fitsScalar(value, schema)) out.push(value);
  };
  if (s.const !== undefined) add(s.const);
  if (Array.isArray(s.enum)) {
    const words = new Set((hints.words ?? []).map((w) => w.toLowerCase()));
    for (const value of s.enum) if (typeof value === "string" && words.has(value.toLowerCase())) add(value);
    if (schema.default !== undefined) add(schema.default);
    for (const value of s.enum) add(value);
  }
  const branches = branchesOf(s);
  if (branches) for (const branch of branches) for (const value of scalarCandidates(branch, name, hints)) add(value);
  const words = describe(schema) || describe(s);
  for (const value of describedExample(words)) add(value);
  const key = name?.split(/[.[\]]+/).filter(Boolean).pop() ?? null;
  if (key && Object.hasOwn(NAMED, key)) for (const value of NAMED[key]) add(value);
  if (s.type === "string") {
    if (s.format === "uuid" || (key && ID_NAME.test(key))) add(exampleId(key));
    if (s.format === "date-time") add(EXAMPLE_TIME);
    if (s.format === "date") add(EXAMPLE_TIME.slice(0, 10));
    if (s.format === "email") add("ada@example.com");
    if (s.format === "uri" || s.format === "url") add("https://example.com");
    if (typeof s.pattern === "string") {
      if (Object.hasOwn(PATTERNS, s.pattern)) add(PATTERNS[s.pattern]);
      const matching = stringMatching(s.pattern);
      if (matching !== null) add(matching);
    }
    if (schema.default !== undefined) add(schema.default);
    const min = typeof s.minLength === "number" ? s.minLength : 0;
    const max = typeof s.maxLength === "number" ? s.maxLength : Infinity;
    add("example".padEnd(min, "x").slice(0, Math.max(min, Math.min(max, 7))));
  }
  if (s.type === "integer" || s.type === "number") {
    if (schema.default !== undefined) add(schema.default);
    add(numberIn(s, s.type === "integer"));
  }
  if (s.type === "boolean") {
    if (schema.default !== undefined) add(schema.default);
    add(true);
    add(false);
  }
  if (nullable) add(null);
  return out;
}

/**
 * An example of a schema: an object with its required fields (and, at the top, its first optional ones when it requires none, so an update
 * shows a change), one item in a list, a union's first shape, a scalar's best candidate. `exampleFor()` checks it against the zod and puts it
 * right.
 */
export function exampleOf(schema: JsonSchema, name: string | null = null, hints: ExampleHints = {}, top = true): unknown {
  const { schema: s, nullable } = unwrapNullable(schema);
  const branches = branchesOf(s);
  if (branches && s.const === undefined && !Array.isArray(s.enum)) {
    const preferred = branches.find((b) => hasFields(b)) ?? branches[0];
    return hasFields(preferred) ? exampleOf(preferred, name, hints, top) : (scalarCandidates(schema, name, hints)[0] ?? null);
  }
  const properties = propertiesOf(s);
  if (Object.keys(properties).length > 0 || (s.type === "object" && !recordValue(s))) {
    const required = new Set(requiredOf(s));
    const keys = Object.keys(properties).filter((key) => required.has(key));
    if (top && keys.length === 0) keys.push(...Object.keys(properties).slice(0, 1));
    return Object.fromEntries(keys.map((key) => [key, exampleOf(properties[key], join(name ?? "", key), hints, false)]));
  }
  const record = recordValue(s);
  if (record) {
    const keySchema: JsonSchema = { type: "string", ...(isSchema(s.propertyNames) ? s.propertyNames : {}) };
    const key = scalarCandidates(keySchema, null, hints).find((k): k is string => typeof k === "string") ?? "key";
    const described = describedExample(describe(schema)).find((v) => isSchema(v));
    if (described) return described;
    return { [key]: exampleOf(record, `${name ?? ""}.${key}`, hints, false) };
  }
  if (s.type === "array" || isSchema(s.items)) {
    const max = typeof s.maxItems === "number" ? s.maxItems : 1;
    const count = Math.min(Math.max(typeof s.minItems === "number" ? s.minItems : 1, 1), max);
    return Array.from({ length: count }, () => exampleOf(isSchema(s.items) ? s.items : {}, `${name ?? ""}[]`, hints, false));
  }
  const candidate = scalarCandidates(schema, name, hints)[0];
  if (candidate !== undefined) return candidate;
  return nullable ? null : "example";
}

type Path = (string | number)[];

/** The schema at a path of a value, a union read by the shape the value takes (its discriminator, else the first whose fields it has). */
function schemaAt(schema: JsonSchema, value: unknown, path: Path): JsonSchema | null {
  let s: JsonSchema = schema;
  let v: unknown = value;
  for (const step of path) {
    s = shapeFor(s, v);
    if (typeof step === "number") {
      s = unwrapNullable(s).schema;
      if (!isSchema(s.items)) return null;
      s = s.items;
    } else {
      const inner = unwrapNullable(s).schema;
      const own = propertiesOf(inner)[step];
      const record = recordValue(inner);
      if (own) s = own;
      else if (record) s = record;
      else return null;
    }
    v = isSchema(v) || Array.isArray(v) ? (v as Record<string | number, unknown>)[step] : undefined;
  }
  return s;
}

/** The shape of a union a value takes, else the schema itself. */
function shapeFor(schema: JsonSchema, value: unknown): JsonSchema {
  const { schema: s } = unwrapNullable(schema);
  const branches = branchesOf(s);
  if (!branches || !branches.some(hasFields)) return schema;
  const by = discriminatorOf(branches);
  if (by && isSchema(value)) {
    const found = branches.find((b) => JSON.stringify(propertiesOf(b)[by]?.const) === JSON.stringify(value[by]));
    if (found) return found;
  }
  if (isSchema(value)) {
    const keys = Object.keys(value);
    const found = branches.find((b) => keys.every((k) => k in propertiesOf(b)) && requiredOf(b).every((k) => keys.includes(k)));
    if (found) return found;
  }
  return branches[0];
}

const valueAt = (value: unknown, path: Path): unknown =>
  path.reduce<unknown>((v, step) => (isSchema(v) || Array.isArray(v) ? (v as Record<string | number, unknown>)[step] : undefined), value);

function withValueAt(value: unknown, path: Path, next: unknown): unknown {
  if (path.length === 0) return next;
  const [step, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, i) => (i === step ? withValueAt(item, rest, next) : item));
  const object = isSchema(value) ? value : {};
  return { ...object, [step]: withValueAt(object[step as string], rest, next) };
}

/** Other values to try at a place the zod refused: a scalar's next candidates, an object with an optional field taken out or put in, another shape. */
function variations(schema: JsonSchema, current: unknown, name: string, hints: ExampleHints): unknown[] {
  const out: unknown[] = [];
  const { schema: s } = unwrapNullable(schema);
  const branches = branchesOf(s);
  if (branches && branches.some(hasFields)) {
    for (const branch of branches) out.push(exampleOf(branch, name, hints, false));
  }
  const shape = unwrapNullable(shapeFor(schema, current)).schema;
  const properties = propertiesOf(shape);
  if (Object.keys(properties).length > 0 && isSchema(current)) {
    const required = new Set(requiredOf(shape));
    for (const key of Object.keys(current)) if (!required.has(key)) out.push(Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)));
    for (const key of Object.keys(properties)) if (!(key in current)) out.push({ ...current, [key]: exampleOf(properties[key], join(name, key), hints, false) });
    const extra = Object.keys(current).filter((key) => !(key in properties));
    if (extra.length > 0 && shape.additionalProperties === false) out.push(Object.fromEntries(Object.entries(current).filter(([k]) => k in properties)));
  }
  if (!isSchema(current) && !Array.isArray(current)) out.push(...scalarCandidates(schema, name, hints).filter((v) => JSON.stringify(v) !== JSON.stringify(current)));
  return out;
}

/** The fields of objects in a schema's own order, so an example put right reads as it was written. */
function ordered(schema: JsonSchema, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isSchema(unwrapNullable(schema).schema.items) ? (unwrapNullable(schema).schema.items as JsonSchema) : {};
    return value.map((item) => ordered(items, item));
  }
  if (!isSchema(value)) return value;
  const shape = unwrapNullable(shapeFor(schema, value)).schema;
  const properties = propertiesOf(shape);
  const record = recordValue(shape);
  const keys = [...Object.keys(properties).filter((k) => k in value), ...Object.keys(value).filter((k) => !(k in properties))];
  return Object.fromEntries(keys.map((k) => [k, ordered(properties[k] ?? record ?? {}, value[k])]));
}

/**
 * An example that the operation's own zod takes: made from its JSON Schema, then put right where the zod refuses it (a refinement the JSON
 * Schema cannot say, such as "name the variant by its id or its SKU, not both"), one place at a time. Null when none is found, which the
 * reference's tests refuse.
 */
export function exampleFor(zod: z.ZodType, schema: JsonSchema, hints: ExampleHints = {}, options: { fill?: boolean } = {}): { value: unknown } | null {
  let value = exampleOf(schema, null, hints, options.fill ?? true);
  const issuesOf = (v: unknown) => {
    const parsed = zod.safeParse(v);
    return parsed.success ? [] : parsed.error.issues;
  };
  let issues = issuesOf(value);
  for (let round = 0; round < 40 && issues.length > 0; round++) {
    const issue = issues[0];
    let path = issue.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number");
    if (issue.code === "unrecognized_keys") path = [...path];
    let fixed = false;
    // The place refused first, then each place above it.
    for (let depth = path.length; depth >= 0 && !fixed; depth--) {
      const at = path.slice(0, depth);
      const sub = schemaAt(schema, value, at);
      if (!sub) continue;
      const current = valueAt(value, at);
      for (const next of variations(sub, current, at.filter((p) => typeof p === "string").join("."), hints)) {
        const candidate = withValueAt(value, at, next);
        const left = issuesOf(candidate);
        if (left.length < issues.length || (left.length === issues.length && JSON.stringify(left[0]?.path) !== JSON.stringify(issue.path))) {
          if (left.length <= issues.length) {
            value = candidate;
            issues = left;
            fixed = true;
            break;
          }
        }
      }
    }
    if (!fixed) break;
  }
  return issues.length === 0 ? { value: ordered(schema, value) } : null;
}
