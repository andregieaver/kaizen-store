import { z } from "zod";

import {
  CONDITION_OPERATORS,
  CONTENT_TYPE_KEY,
  EXPORT_VERSION,
  FIELD_ENTITY_KEYS,
  FIELD_TYPE_KEYS,
  FIELD_WIDTHS,
  FILTER_TYPES,
  LABEL_MAX,
  MAX_CHOICES,
  MAX_FIELD_GROUPS,
  MAX_GALLERY,
  MAX_GROUP_FIELDS,
  MAX_LAYOUTS,
  MAX_REPEATER_ROWS,
  MAX_RULES,
  MAX_SUB_FIELDS,
  NAME_MAX,
  SEARCH_TYPES,
  TEXTAREA_MAX,
  hasChoices,
  isStaffEntity,
  isStructural,
  newFieldId,
  staffGroupProblem,
  subFieldsOf,
  uniqueName,
  type ConditionOperator,
  type FieldDef,
  type FieldEntity,
  type FieldType,
  type FieldWidth,
  type LocationRule,
} from "./custom-fields";

/**
 * The custom fields' definition schemas (D118), apart from the helpers in `custom-fields.ts` so a screen that only shows or edits a
 * field loads no zod (bloat review step 2.46). The server checks every group it is sent with `fieldGroupInput`; `importGroups` checks a
 * file of groups the same way. Import this file only where a schema runs; `custom-fields.ts` imports it as a type alone.
 */

// ---------------------------------------------------------------------------
// Checking a definition
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const translations = z.record(z.string().min(2).max(10), text(LABEL_MAX)).optional();
const fieldId = z.string().regex(/^f_[a-z0-9]{6,24}$/, "A field has an invalid id.");
const nameRule = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "A name starts with a lowercase letter and uses lowercase letters, digits and underscores.",
  )
  .max(NAME_MAX);

const condition = z.object({
  field: fieldId,
  operator: z.enum(Object.keys(CONDITION_OPERATORS) as [ConditionOperator, ...ConditionOperator[]]),
  value: text(200).optional(),
});

const choice = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "A choice's key uses lowercase letters, digits, hyphens and underscores.")
    .max(NAME_MAX),
  label: text(LABEL_MAX).min(1, "Give each choice a label."),
  labels: translations,
});

const leafField = z.object({
  id: fieldId,
  name: nameRule,
  label: text(LABEL_MAX).min(1, "Give each field a label."),
  labels: translations,
  instructions: text(300).optional(),
  type: z.enum(FIELD_TYPE_KEYS),
  required: z.boolean().optional(),
  width: z.custom<FieldWidth>((w) => FIELD_WIDTHS.includes(w as FieldWidth), "Choose one of the widths.").optional(),
  access: z.enum(["private", "public"]).default("private"),
  when: z.array(z.array(condition).min(1).max(MAX_RULES)).max(MAX_RULES).optional(),
  placeholder: text(100).optional(),
  maxLength: z.number().int().min(1).max(TEXTAREA_MAX).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  unit: text(12).optional(),
  units: z.array(text(12).min(1)).max(20).optional(),
  choices: z.array(choice).max(MAX_CHOICES, `Use at most ${MAX_CHOICES} choices.`).optional(),
  maxItems: z.number().int().min(1).max(MAX_GALLERY).optional(),
  filter: z.boolean().optional(),
  search: z.boolean().optional(),
  chat: z.boolean().optional(),
  // A customer's field the store may use in segments (email plan M2.4): only where the owner marks it, and only of `MARKETING_FIELD_TYPES`.
  marketing: z.boolean().optional(),
  multiple: z.boolean().optional(),
  contentType: z.string().regex(CONTENT_TYPE_KEY).optional(),
  termKinds: z.array(z.enum(["category", "tag"])).min(1).max(2).optional(),
  minRows: z.number().int().min(0).max(MAX_REPEATER_ROWS).optional(),
  maxRows: z.number().int().min(1).max(MAX_REPEATER_ROWS).optional(),
  buttonLabel: text(40).optional(),
  rowLayout: z.enum(["table", "block"]).optional(),
});

const layoutDef = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "A layout's key uses lowercase letters, digits, hyphens and underscores.")
    .max(NAME_MAX),
  label: text(LABEL_MAX).min(1, "Give each layout a label."),
  labels: translations,
  subFields: z.array(leafField).max(MAX_SUB_FIELDS, `Use at most ${MAX_SUB_FIELDS} fields in a layout.`),
});

const fieldDef = leafField.extend({
  subFields: z.array(leafField).max(MAX_SUB_FIELDS, `Use at most ${MAX_SUB_FIELDS} fields in a group or repeater.`).optional(),
  layouts: z.array(layoutDef).max(MAX_LAYOUTS, `Use at most ${MAX_LAYOUTS} layouts.`).optional(),
});
type LeafInput = z.infer<typeof leafField>;

const locationRule = z.object({
  param: z.string().min(1).max(20),
  operator: z.enum(["==", "!="]),
  value: text(100).min(1, "Choose what each rule compares with."),
});

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "The web name may use lowercase letters, digits and single hyphens.")
  .max(60);

/**
 * A list of field definitions as every holder of fields checks it: a group's (D118) and a content type's (D326). Ids and names unique,
 * choices and units where a type needs them, filters, search and the chat only where they can work, a group, repeater or flexible
 * content holding what it may, and a field shown only by fields above it.
 */
export const fieldDefsSchema = z
  .array(fieldDef)
  .max(MAX_GROUP_FIELDS, `Use at most ${MAX_GROUP_FIELDS} fields in a group.`)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    fields.forEach((field, index) => {
      const at = [index];
      if (ids.has(field.id)) ctx.addIssue({ code: "custom", path: at, message: "Two fields share an id." });
      ids.add(field.id);
      if (names.has(field.name))
        ctx.addIssue({ code: "custom", path: [...at, "name"], message: `Two fields are named ${field.name}.` });
      names.add(field.name);
      if (hasChoices(field.type) && (field.choices ?? []).length === 0) {
        ctx.addIssue({ code: "custom", path: [...at, "choices"], message: `Add choices to ${field.label}.` });
      }
      if (
        hasChoices(field.type) &&
        new Set((field.choices ?? []).map((c) => c.key)).size !== (field.choices ?? []).length
      ) {
        ctx.addIssue({
          code: "custom",
          path: [...at, "choices"],
          message: `${field.label} has two choices with the same key.`,
        });
      }
      if (field.type === "measurement" && (field.units ?? []).length === 0) {
        ctx.addIssue({ code: "custom", path: [...at, "units"], message: `Add units to ${field.label}.` });
      }
      if (field.filter && !FILTER_TYPES.includes(field.type)) {
        ctx.addIssue({ code: "custom", path: [...at, "filter"], message: `${field.label} cannot be a filter: only choices, yes or no and numbers can.` });
      }
      if (field.search && !SEARCH_TYPES.includes(field.type)) {
        ctx.addIssue({ code: "custom", path: [...at, "search"], message: `${field.label} cannot be searched: only texts and choices can.` });
      }
      const entryWithout = (def: { type: FieldType; contentType?: string }) => def.type === "entry" && !def.contentType;
      if (entryWithout(field) || subFieldsOf(field).some(entryWithout)) {
        ctx.addIssue({ code: "custom", path: [...at, "contentType"], message: `Choose the content type whose entries ${field.label} takes.` });
      }
      if (field.type === "money" && field.chat) {
        ctx.addIssue({ code: "custom", path: [...at, "chat"], message: `${field.label} cannot be told by the chat: the assistant states no amount from a field.` });
      }
      if ((field.filter || field.search || field.chat) && field.access !== "public") {
        ctx.addIssue({ code: "custom", path: [...at, "access"], message: `${field.label} must be shown on the site to be a filter, be searched or be told by the chat.` });
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        ctx.addIssue({
          code: "custom",
          path: [...at, "min"],
          message: `${field.label}: the least is more than the most.`,
        });
      }
    });
    // Groups and repeaters: what they hold is checked as a group's own fields are.
    fields.forEach((field, index) => {
      const at = [index];
      if (!isStructural(field.type as FieldType)) {
        if (field.subFields && field.subFields.length > 0) {
          ctx.addIssue({ code: "custom", path: [...at, "subFields"], message: `${field.label} holds no fields of its own.` });
        }
        if (field.layouts && field.layouts.length > 0) {
          ctx.addIssue({ code: "custom", path: [...at, "layouts"], message: `${field.label} holds no layouts.` });
        }
        return;
      }
      if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
        ctx.addIssue({ code: "custom", path: [...at, "minRows"], message: `${field.label}: the fewest rows is more than the most.` });
      }
      // The fields of a group or repeater, or of one layout of flexible content: the same checks, conditions looking only inside one list.
      const checkSubs = (subs: LeafInput[], subsAt: (string | number)[], where: string) => {
        const subNames = new Set<string>();
        subs.forEach((sub, subIndex) => {
          const subAt = [...subsAt, subIndex];
          if (isStructural(sub.type)) ctx.addIssue({ code: "custom", path: subAt, message: `${sub.label}: a group, repeater or flexible content cannot hold another.` });
          if (ids.has(sub.id)) ctx.addIssue({ code: "custom", path: subAt, message: "Two fields share an id." });
          ids.add(sub.id);
          if (subNames.has(sub.name)) ctx.addIssue({ code: "custom", path: [...subAt, "name"], message: `Two fields in ${where} are named ${sub.name}.` });
          subNames.add(sub.name);
          if (hasChoices(sub.type) && (sub.choices ?? []).length === 0) ctx.addIssue({ code: "custom", path: [...subAt, "choices"], message: `Add choices to ${sub.label}.` });
          if (sub.type === "measurement" && (sub.units ?? []).length === 0) ctx.addIssue({ code: "custom", path: [...subAt, "units"], message: `Add units to ${sub.label}.` });
          if (sub.type === "money" && sub.chat) ctx.addIssue({ code: "custom", path: [...subAt, "chat"], message: `${sub.label} cannot be told by the chat: the assistant states no amount from a field.` });
          for (const condition of (sub.when ?? []).flat()) {
            const trigger = subs.findIndex((other) => other.id === condition.field);
            if (trigger === -1 || trigger >= subIndex) {
              ctx.addIssue({ code: "custom", path: [...subAt, "when"], message: `${sub.label} can only depend on fields above it in ${where}.` });
            }
          }
        });
      };
      if (field.type === "flexible") {
        if (field.subFields && field.subFields.length > 0) {
          ctx.addIssue({ code: "custom", path: [...at, "subFields"], message: `${field.label} takes its fields in its layouts.` });
        }
        const layouts = field.layouts ?? [];
        if (layouts.length === 0) ctx.addIssue({ code: "custom", path: [...at, "layouts"], message: `Add layouts to ${field.label}.` });
        const keys = new Set<string>();
        layouts.forEach((layout, layoutIndex) => {
          const layoutAt = [...at, "layouts", layoutIndex];
          if (keys.has(layout.key)) ctx.addIssue({ code: "custom", path: [...layoutAt, "key"], message: `${field.label} has two layouts with the same key.` });
          keys.add(layout.key);
          if (layout.subFields.length === 0) ctx.addIssue({ code: "custom", path: [...layoutAt, "subFields"], message: `Add fields to the layout ${layout.label}.` });
          checkSubs(layout.subFields, [...layoutAt, "subFields"], `${field.label}, ${layout.label}`);
        });
        return;
      }
      if (field.layouts && field.layouts.length > 0) {
        ctx.addIssue({ code: "custom", path: [...at, "layouts"], message: `${field.label} holds no layouts.` });
      }
      const subs = field.subFields ?? [];
      if (subs.length === 0) ctx.addIssue({ code: "custom", path: [...at, "subFields"], message: `Add fields to ${field.label}.` });
      checkSubs(subs, [...at, "subFields"], field.label);
    });
    // A field is shown by fields before it in the group, never by itself or one after it.
    fields.forEach((field, index) => {
      for (const condition of (field.when ?? []).flat()) {
        const trigger = fields.findIndex((f) => f.id === condition.field);
        if (trigger === -1 || trigger >= index) {
          ctx.addIssue({
            code: "custom",
            path: [index, "when"],
            message: `${field.label} can only depend on fields above it.`,
          });
        }
      }
    });
  });

export const fieldGroupInput = z
  .object({
    id: z.uuid().nullable().default(null),
    name: text(LABEL_MAX).min(1, "Give the group a name."),
    slug,
    entities: z.array(z.enum(FIELD_ENTITY_KEYS)).min(1, "Choose where the group can be used."),
    location: z.array(z.array(locationRule).min(1).max(MAX_RULES)).max(MAX_RULES).default([]),
    fields: fieldDefsSchema,
    position: z.enum(["main", "side"]).default("main"),
    active: z.boolean().default(true),
  })
  .superRefine((group, ctx) => {
    // Customers' and orders' fields are for staff alone (D120).
    const staffProblem = staffGroupProblem(group as { entities: FieldEntity[]; fields: FieldDef[] });
    if (staffProblem) ctx.addIssue({ code: "custom", path: ["entities"], message: staffProblem });
    if (group.entities.some(isStaffEntity) && group.location.length > 0) {
      ctx.addIssue({ code: "custom", path: ["location"], message: "A group for customers or orders is on all of them: it takes no rules." });
    }
  });

export type FieldGroupInput = z.infer<typeof fieldGroupInput>;

/**
 * Groups from a file: checked as an editor's are, given ids of their own
 * (values are kept under the ids, so a copy must not share them) with
 * conditions following, and web names not taken. A group's rules about a
 * category or tag, which are this store's own, are dropped.
 */
export function importGroups(
  raw: unknown,
  taken: readonly string[],
): { ok: true; groups: FieldGroupInput[] } | { ok: false; problem: string } {
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { kaizenFieldGroups?: unknown }).kaizenFieldGroups !== EXPORT_VERSION
  ) {
    return { ok: false, problem: "This is not a file of field groups from Kaizena Flow." };
  }
  const list = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, problem: "The file holds no groups." };
  const used = [...taken];
  const groups: FieldGroupInput[] = [];
  for (const item of list.slice(0, MAX_FIELD_GROUPS)) {
    const source = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    // Fresh ids, and the conditions that name them follow.
    const fields = Array.isArray(source.fields) ? (source.fields as Record<string, unknown>[]) : [];
    const subsOf = (f: Record<string, unknown> | undefined): Record<string, unknown>[] =>
      Array.isArray(f?.subFields) ? (f.subFields as Record<string, unknown>[]) : [];
    const layoutsOf = (f: Record<string, unknown> | undefined): Record<string, unknown>[] =>
      Array.isArray(f?.layouts) ? (f.layouts as Record<string, unknown>[]) : [];
    const layoutSubs = (f: Record<string, unknown> | undefined): Record<string, unknown>[] => layoutsOf(f).flatMap(subsOf);
    const ids = new Map<string, string>(
      [...fields, ...fields.flatMap(subsOf), ...fields.flatMap(layoutSubs)].map((f) => [String(f?.id), newFieldId()]),
    );
    const remapField = (f: Record<string, unknown>): Record<string, unknown> => ({
      ...f,
      id: ids.get(String(f?.id)),
      when: Array.isArray(f?.when)
        ? (f.when as Record<string, unknown>[][]).map((all) =>
            all.map((c) => ({ ...c, field: ids.get(String(c?.field)) ?? c?.field })),
          )
        : undefined,
      ...(Array.isArray(f?.subFields) && { subFields: subsOf(f).map(remapField) }),
      ...(Array.isArray(f?.layouts) && { layouts: layoutsOf(f).map((layout) => ({ ...layout, subFields: subsOf(layout).map(remapField) })) }),
    });
    const remapped = fields.map(remapField);
    const location = Array.isArray(source.location)
      ? (source.location as LocationRule[][])
          .map((all) => all.filter((rule) => rule?.param !== "category" && rule?.param !== "tag"))
          .filter((all) => all.length > 0)
      : [];
    const parsed = fieldGroupInput.safeParse({ ...source, id: null, fields: remapped, location });
    if (!parsed.success)
      return { ok: false, problem: parsed.error.issues[0]?.message ?? "A group in the file is not valid." };
    const next = { ...parsed.data, slug: uniqueName(parsed.data.slug, used, "-") };
    used.push(next.slug);
    groups.push(next);
  }
  return { ok: true, groups };
}
