import {
  FIELD_ENTITIES,
  LOCATION_CHOICES,
  LOCATION_PARAMS,
  displayText,
  fieldGroupInput,
  hasChoices,
  isFieldEntity,
  isStructural,
  newField,
  nameOf,
  slugOf,
  subFieldsOf,
  uniqueName,
  type FieldAccess,
  type FieldDef,
  type FieldEntity,
  type FieldGroup,
  type FieldGroupInput,
  type FieldType,
  type FieldValue,
  type FieldWords,
  type LocationRule,
} from "./custom-fields";
import { richTextPlain, type BlockNode, type InlineNode, type RichTextDoc } from "./page-content";

/**
 * What the AI manager's custom-fields tools may do (D118, phase 2): read
 * every kind of field, but fill in and create only the simple ones (words,
 * numbers, yes or no, choices, dates). Pictures, files, links, things that
 * point at other things, money (its currency and amount are the owner's to
 * choose, and never guessed from words) and groups, repeaters and flexible
 * content take the admin's editor.
 * Pure, so the tool catalogue (`owner-tools.ts`), the server handlers and the
 * tests share it.
 */

/** The kinds of thing the tools can fill in and make groups for. */
export const TOOL_FIELD_ENTITIES = ["product", "page", "article", "store"] as const satisfies readonly FieldEntity[];
export type ToolFieldEntity = (typeof TOOL_FIELD_ENTITIES)[number];

/** The types the tools can fill in and create: plain text, numbers, choices and dates. */
export const SIMPLE_FIELD_TYPES = [
  "text",
  "textarea",
  "richText",
  "number",
  "measurement",
  "email",
  "url",
  "phone",
  "select",
  "radio",
  "buttons",
  "checkbox",
  "boolean",
  "date",
  "datetime",
  "time",
  "color",
] as const satisfies readonly FieldType[];

export const isSimpleType = (type: FieldType): boolean => (SIMPLE_FIELD_TYPES as readonly string[]).includes(type);

/** Types whose value is free text a person wrote, which passes the claims filter. */
export const isWordsType = (type: FieldType): boolean => type === "text" || type === "textarea" || type === "richText";

/** The words a refused field type gets, pointing at the admin's editor. */
export function structuralRefusal(def: Pick<FieldDef, "label" | "type">, editor: string): string {
  return `${def.label} is a "${def.type}" field, which cannot be filled in from here: use ${editor}.`;
}

// ---------------------------------------------------------------------------
// Location rules in words
// ---------------------------------------------------------------------------

/** A group's location rules for the kinds it is on, in words: "Category is Mugs and Kind of product is Goods, or Tag is New". */
export function describeLocation(
  group: Pick<FieldGroup, "location" | "entities">,
  termNames: ReadonlyMap<string, string>,
): string {
  if (group.location.length === 0) return "all of them";
  const label = (param: string) =>
    group.entities.flatMap((e) => LOCATION_PARAMS[e]).find((p) => p.param === param)?.label ?? param;
  const valueWords = (rule: LocationRule) =>
    rule.param === "category" || rule.param === "tag"
      ? (termNames.get(rule.value) ?? "a removed one")
      : (LOCATION_CHOICES[rule.param]?.find((c) => c.value === rule.value)?.label ?? rule.value);
  const rule = (r: LocationRule) => `${label(r.param)} ${r.operator === "==" ? "is" : "is not"} ${valueWords(r)}`;
  return group.location.map((all) => all.map(rule).join(" and ")).join(", or ");
}

/** The ids of the categories and tags a group's rules name, to look their names up. */
export const termIdsInRules = (group: Pick<FieldGroup, "location">): string[] =>
  group.location
    .flat()
    .filter((r) => r.param === "category" || r.param === "tag")
    .map((r) => r.value);

export const entityWords = (entities: readonly FieldEntity[]): string[] =>
  entities.filter(isFieldEntity).map((e) => FIELD_ENTITIES[e].toLowerCase());

// ---------------------------------------------------------------------------
// Reading a value
// ---------------------------------------------------------------------------

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A field's value as a short readable text (long ones cut); structural and linked values say what they hold, never their internals. */
export function fieldValueText(
  def: FieldDef,
  value: FieldValue,
  locale: string,
  words: FieldWords,
  max = 400,
): string {
  if (def.type === "group") return "a group of fields that is filled in (change it in the admin)";
  if (def.type === "repeater" || def.type === "flexible") {
    const rows = Array.isArray(value) ? value.length : 0;
    return `${rows} ${rows === 1 ? "row" : "rows"} (change them in the admin)`;
  }
  if (def.type === "product" || def.type === "page" || def.type === "term") {
    const n = Array.isArray(value) ? value.length : 1;
    return `${n} ${n === 1 ? "item" : "items"} chosen (change them in the admin)`;
  }
  if (def.type === "gallery") return `${Array.isArray(value) ? value.length : 1} pictures`;
  if (def.type === "richText") return cut(richTextPlain(value as RichTextDoc), max);
  return cut(displayText(def, value, locale, words), max);
}

// ---------------------------------------------------------------------------
// Writing a value: what the model says, as what the field takes
// ---------------------------------------------------------------------------

/** Plain words as a rich text: blank lines between paragraphs, "- " lines as a list, other line breaks kept. */
export function plainToRich(text: string): RichTextDoc {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const inline = (line: string): InlineNode[] => (line === "" ? [] : [{ type: "text", text: line }]);
  const content: BlockNode[] = blocks.map((block): BlockNode => {
    const lines = block.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^[-*] +\S/.test(l))) {
      return {
        type: "bulletList",
        content: lines.map((l) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: inline(l.replace(/^[-*] +/, "")) }],
        })),
      };
    }
    const nodes: InlineNode[] = lines.flatMap((l, index): InlineNode[] =>
      index === 0 ? inline(l) : [{ type: "hardBreak" }, ...inline(l)],
    );
    return { type: "paragraph", ...(nodes.length > 0 && { content: nodes }) };
  });
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

const YES = ["yes", "true", "ja", "1", "on"];
const NO = ["no", "false", "nei", "nej", "0", "off"];

/** The key of the choice a person named by its key or its label (in any language), if it is one. */
export function choiceKey(def: FieldDef, said: string): string | null {
  const wanted = said.trim().toLowerCase();
  const choices = def.choices ?? [];
  const found =
    choices.find((c) => c.key === said.trim()) ??
    choices.find((c) => c.key.toLowerCase() === wanted) ??
    choices.find((c) => [c.label, ...Object.values(c.labels ?? {})].some((l) => l.trim().toLowerCase() === wanted));
  return found?.key ?? null;
}

export type Coerced = { ok: true; value: unknown } | { ok: false; problem: string };

/**
 * What the model gave for a field, made into what the field takes (before
 * `parseValue` checks it): a choice by its label becomes its key, "yes" a
 * true, plain words a rich text. Empty (`null`, "", a list with nothing)
 * takes the value away. Types the tools do not fill in are refused.
 */
export function coerceFieldValue(def: FieldDef, raw: unknown, editor: string): Coerced {
  const ok = (value: unknown): Coerced => ({ ok: true, value });
  const bad = (problem: string): Coerced => ({ ok: false, problem: `${def.label}: ${problem}` });
  if (!isSimpleType(def.type)) return { ok: false, problem: structuralRefusal(def, editor) };
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return ok(null);
  switch (def.type) {
    case "boolean": {
      if (typeof raw === "boolean") return ok(raw);
      const said = String(raw).trim().toLowerCase();
      if (YES.includes(said)) return ok(true);
      if (NO.includes(said)) return ok(false);
      return bad("say yes or no (true or false).");
    }
    case "select":
    case "radio":
    case "buttons": {
      if (typeof raw !== "string") return bad("give one choice.");
      const key = choiceKey(def, raw);
      return key
        ? ok(key)
        : bad(`"${raw}" is not one of the choices: ${(def.choices ?? []).map((c) => c.label).join(", ")}.`);
    }
    case "checkbox": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
      if (!list || list.some((item) => typeof item !== "string")) return bad("give the choices as a list.");
      const keys: string[] = [];
      for (const said of list as string[]) {
        if (said.trim() === "") continue;
        const key = choiceKey(def, said);
        if (!key)
          return bad(
            `"${said.trim()}" is not one of the choices: ${(def.choices ?? []).map((c) => c.label).join(", ")}.`,
          );
        keys.push(key);
      }
      return ok(keys);
    }
    case "measurement": {
      if (typeof raw === "number") return ok({ value: raw, unit: "" });
      if (typeof raw !== "string") return bad("give a number with its unit, such as 250 g.");
      const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(\S*)\s*$/.exec(raw);
      return match ? ok({ value: match[1], unit: match[2] }) : bad("give a number with its unit, such as 250 g.");
    }
    case "number":
      return typeof raw === "number" || typeof raw === "string" ? ok(raw) : bad("give a number.");
    case "richText":
      return typeof raw === "string" ? ok(plainToRich(raw)) : bad("write some text.");
    case "text":
    case "textarea":
      if (typeof raw === "number") return ok(String(raw));
      return typeof raw === "string" ? ok(raw) : bad("write some text.");
    default:
      return typeof raw === "string" ? ok(raw) : bad("write it as text.");
  }
}

/** A field the model named, with the group it is in. */
export type FieldCandidate = { group: Pick<FieldGroup, "name" | "slug">; def: FieldDef };

/**
 * The field a key means: its name, its label (in any case), or `group-slug.name`
 * when two groups have a field of the same name. Says what to use when it is
 * unknown or ambiguous.
 */
export function resolveField(
  key: string,
  candidates: readonly FieldCandidate[],
): { ok: true; candidate: FieldCandidate } | { ok: false; problem: string } {
  const said = key.trim();
  const lower = said.toLowerCase();
  const dot = said.indexOf(".");
  const exact = candidates.filter(
    (c) =>
      c.def.name === said || (dot > 0 && c.group.slug === said.slice(0, dot) && c.def.name === said.slice(dot + 1)),
  );
  const found =
    exact.length > 0
      ? exact
      : candidates.filter((c) => c.def.label.trim().toLowerCase() === lower || c.def.name === lower);
  if (found.length === 1) return { ok: true, candidate: found[0] };
  if (found.length > 1) {
    return {
      ok: false,
      problem: `"${said}" is in more than one group: use ${found.map((c) => `${c.group.slug}.${c.def.name}`).join(" or ")}.`,
    };
  }
  return {
    ok: false,
    problem: `There is no field "${said}" on this. Its fields: ${candidates.map((c) => c.def.name).join(", ") || "none"}.`,
  };
}

export type PreparedValue = { candidate: FieldCandidate; value: unknown; clears: boolean };

/**
 * What the model wants set, as the fields it means and the values they take.
 * Every problem is collected, so the model can put all of it right at once.
 */
export function prepareValues(
  values: Record<string, unknown>,
  candidates: readonly FieldCandidate[],
  editor: string,
): { ok: true; prepared: PreparedValue[] } | { ok: false; problems: string[] } {
  const prepared: PreparedValue[] = [];
  const problems: string[] = [];
  const seen = new Set<FieldDef>();
  for (const [key, raw] of Object.entries(values)) {
    const resolved = resolveField(key, candidates);
    if (!resolved.ok) {
      problems.push(resolved.problem);
      continue;
    }
    const { candidate } = resolved;
    if (seen.has(candidate.def)) {
      problems.push(`${candidate.def.label} is given twice.`);
      continue;
    }
    seen.add(candidate.def);
    const coerced = coerceFieldValue(candidate.def, raw, editor);
    if (!coerced.ok) problems.push(coerced.problem);
    else prepared.push({ candidate, value: coerced.value, clears: coerced.value === null });
  }
  // In the order the fields come in their groups, whatever order they were named in.
  const at = (p: PreparedValue) => candidates.indexOf(p.candidate);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, prepared: prepared.sort((a, b) => at(a) - at(b)) };
}

/** The free text among prepared values, for the claims filter: only what a person would read on the site. */
export function wordsIn(prepared: readonly PreparedValue[]): string[] {
  return prepared.flatMap(({ candidate, value }) => {
    if (!isWordsType(candidate.def.type) || value === null) return [];
    return [candidate.def.type === "richText" ? richTextPlain(value as RichTextDoc) : String(value)];
  });
}

// ---------------------------------------------------------------------------
// Making a group
// ---------------------------------------------------------------------------

export type NewFieldSpec = {
  label: string;
  type: (typeof SIMPLE_FIELD_TYPES)[number];
  required?: boolean;
  options?: string[];
  units?: string[];
  access?: FieldAccess;
};

export type NewGroupSpec = { name: string; entity: ToolFieldEntity; fields: NewFieldSpec[] };

/** The words of a new group that people (and the site) read, for the claims filter. */
export const groupTexts = (spec: NewGroupSpec): string[] => [
  spec.name,
  ...spec.fields.flatMap((f) => [f.label, ...(f.options ?? [])]),
];

/**
 * A group as `saveFieldGroup` takes it, built from what the model said with
 * the library's own helpers: ids, web names and choice keys made here, fields
 * private unless said, the group on every thing of its kind (rules narrowing
 * it are the admin's). `takenSlugs` are the store's groups' web names.
 */
export function buildFieldGroup(
  spec: NewGroupSpec,
  takenSlugs: readonly string[],
): { ok: true; group: FieldGroupInput } | { ok: false; problem: string } {
  const names: string[] = [];
  const fields: FieldDef[] = [];
  for (const spec_ of spec.fields) {
    const field = newField(spec_.type, names);
    field.label = spec_.label;
    field.name = uniqueName(nameOf(spec_.label), names);
    names.push(field.name);
    field.access = spec_.access ?? "private";
    if (spec_.required) field.required = true;
    if (hasChoices(spec_.type)) {
      const options = [...new Set((spec_.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (options.length === 0)
        return { ok: false, problem: `${spec_.label} is a ${spec_.type} field: give its options.` };
      const keys: string[] = [];
      field.choices = options.map((label) => {
        const key = uniqueName(slugOf(label, "option"), keys, "-");
        keys.push(key);
        return { key, label };
      });
    } else if (spec_.options && spec_.options.length > 0) {
      return { ok: false, problem: `${spec_.label} is a ${spec_.type} field, which has no options.` };
    }
    if (spec_.type === "measurement") {
      const units = [...new Set((spec_.units ?? []).map((u) => u.trim()).filter(Boolean))];
      if (units.length === 0)
        return { ok: false, problem: `${spec_.label} is a measurement: give its units, such as g and kg.` };
      field.units = units;
    }
    if (isStructural(field.type) || subFieldsOf(field).length > 0)
      return { ok: false, problem: `${spec_.label}: groups and repeaters are made in the admin.` };
    fields.push(field);
  }
  const parsed = fieldGroupInput.safeParse({
    id: null,
    name: spec.name,
    slug: uniqueName(slugOf(spec.name), takenSlugs, "-"),
    entities: [spec.entity],
    location: [],
    fields,
    position: "main",
    active: true,
  });
  if (!parsed.success) return { ok: false, problem: [...new Set(parsed.error.issues.map((i) => i.message))].join(" ") };
  return { ok: true, group: parsed.data };
}
