import {
  CONDITION_OPERATORS,
  FIELD_ENTITIES,
  FIELD_TYPES,
  FIELD_TYPE_KEYS,
  LOCATION_CHOICES,
  LOCATION_PARAMS,
  MAX_LAYOUTS,
  MAX_SUB_FIELDS,
  VALUELESS_OPERATORS,
  fieldListsOf,
  hasChoices,
  isStructural,
  newField,
  newLayout,
  operatorsFor,
  slugOf,
  staffGroupProblem,
  subFieldsOf,
  uniqueName,
  newFieldId,
  type Condition,
  type ConditionOperator,
  type FieldDef,
  type FieldEntity,
  type FieldGroupInput,
  type FieldLayout,
  type FieldType,
  type LocationRule,
  type RuleGroups,
} from "./custom-fields";

/**
 * The pure parts of the field group generator (D118): the location rule
 * builder, conditional logic that only looks upwards, and the small edits
 * the editor makes to a group it holds until Save. Nothing here saves; the
 * server checks the group again with `fieldGroupInput`.
 */

/** Moves an item from one place to another, as a new list. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Where a group applies
// ---------------------------------------------------------------------------

/** What rules can ask about, for the kinds of thing chosen: each param once. */
export function locationParamsFor(entities: readonly FieldEntity[]): { param: string; label: string }[] {
  const seen = new Set<string>();
  const out: { param: string; label: string }[] = [];
  for (const entity of entities) {
    for (const p of LOCATION_PARAMS[entity]) {
      if (seen.has(p.param)) continue;
      seen.add(p.param);
      out.push(p);
    }
  }
  return out;
}

/** Whether a rule asks about something the chosen kinds of thing have. */
export const ruleFits = (rule: LocationRule, entities: readonly FieldEntity[]): boolean =>
  locationParamsFor(entities).some((p) => p.param === rule.param);

/** The value a rule starts with: the first of a fixed list, else nothing (the editor lists categories and tags). */
export const startValue = (param: string): string => LOCATION_CHOICES[param]?.[0]?.value ?? "";

export function newLocationRule(entities: readonly FieldEntity[]): LocationRule {
  const param = locationParamsFor(entities)[0]?.param ?? "kind";
  return { param, operator: "==", value: startValue(param) };
}

/** A rule as a sentence, `term` telling a category's or tag's name (a missing one is said so). */
export function describeRule(
  rule: LocationRule,
  lookup: { term: (id: string) => string | undefined; role: (role: string) => string | undefined },
): string {
  const param =
    Object.values(LOCATION_PARAMS)
      .flat()
      .find((p) => p.param === rule.param)?.label ?? rule.param;
  let value: string;
  if (rule.param === "category" || rule.param === "tag") value = lookup.term(rule.value) ?? "a removed one";
  else if (rule.param === "role") value = lookup.role(rule.value) ?? rule.value;
  else value = LOCATION_CHOICES[rule.param]?.find((c) => c.value === rule.value)?.label ?? rule.value;
  return `${param} ${rule.operator === "==" ? "is" : "is not"} ${value}`;
}

/** All of a group's rules in a line: rules in a rule group with "and", rule groups with "or". */
export function describeLocation(
  location: RuleGroups<LocationRule>,
  lookup: Parameters<typeof describeRule>[1],
): string {
  return location.map((all) => all.map((rule) => describeRule(rule, lookup)).join(" and ")).join(" or ");
}

/** The kinds of thing a group is on, as words: "Products and pages". */
export function entitiesText(entities: readonly FieldEntity[]): string {
  const words = entities.map((entity) => FIELD_ENTITIES[entity].toLowerCase());
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
  return list.charAt(0).toUpperCase() + list.slice(1);
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** A choice's key from its label: lowercase words with hyphens, not among `taken`. */
export const choiceKey = (label: string, taken: readonly string[]): string =>
  uniqueName(slugOf(label, "option"), taken, "-");

/** The units in a comma list, as a person types them. */
export const parseUnits = (text: string): string[] =>
  text
    .split(",")
    .map((unit) => unit.trim())
    .filter((unit) => unit !== "");

/** A field's label in a language, changed; an empty text takes the translation away. */
export function withLabel<T extends { labels?: Record<string, string> }>(item: T, locale: string, text: string): T {
  const labels = { ...item.labels };
  if (text.trim() === "") delete labels[locale];
  else labels[locale] = text;
  return { ...item, labels: Object.keys(labels).length > 0 ? labels : undefined };
}

/**
 * A copy of a field with new ids all through (a group's or repeater's fields
 * too: values are kept under them, so a copy must not share them), the
 * conditions between its fields following.
 */
export function cloneField(source: FieldDef): FieldDef {
  const copy: FieldDef = structuredClone(source);
  const ids = new Map<string, string>([[source.id, newFieldId()]]);
  for (const sub of subFieldsOf(source)) ids.set(sub.id, newFieldId());
  copy.id = ids.get(source.id) as string;
  const renewed = (subs: FieldDef[]): FieldDef[] =>
    subs.map((sub) => ({
      ...sub,
      id: ids.get(sub.id) as string,
      when: sub.when?.map((all) => all.map((c) => ({ ...c, field: ids.get(c.field) ?? c.field }))),
    }));
  if (copy.subFields) copy.subFields = renewed(copy.subFields);
  // A flexible field's layouts keep their keys (rows are kept under them, per field), their fields get new ids.
  if (copy.layouts) copy.layouts = copy.layouts.map((layout) => ({ ...layout, subFields: renewed(layout.subFields) }));
  return copy;
}

/** A copy of a field to put next to it: a new id and a name of its own; what it shows by carries over. */
export function duplicateField(fields: readonly FieldDef[], id: string): { fields: FieldDef[]; copy: FieldDef } | null {
  const index = fields.findIndex((f) => f.id === id);
  if (index === -1) return null;
  const source = fields[index];
  const copy: FieldDef = {
    ...cloneField(source),
    name: uniqueName(
      source.name.slice(0, 34),
      fields.map((f) => f.name),
    ),
    label: `${source.label} (copy)`.slice(0, 80),
    labels: undefined,
  };
  const next = [...fields];
  next.splice(index + 1, 0, copy);
  return { fields: next, copy };
}

/**
 * Takes away the conditions that name a field that is not above the field
 * they are on (removed, or moved below it), and rule groups left empty; in
 * a group's or repeater's fields too, where only the fields above one in the
 * same group or repeater count. `changed` names the fields whose logic was
 * touched.
 */
export function pruneConditions(fields: readonly FieldDef[]): { fields: FieldDef[]; changed: string[] } {
  const changed: string[] = [];
  const next = fields.map((field, index) => {
    let current = field;
    if (field.when && field.when.length > 0) {
      const above = new Set(fields.slice(0, index).map((f) => f.id));
      const when = field.when.map((all) => all.filter((c) => above.has(c.field))).filter((all) => all.length > 0);
      if (when.flat().length !== field.when.flat().length) {
        changed.push(field.label);
        current = { ...field, when: when.length > 0 ? when : undefined };
      }
    }
    if (isStructural(current.type) && current.subFields) {
      const inside = pruneConditions(current.subFields);
      if (inside.changed.length > 0) {
        changed.push(...inside.changed);
        current = { ...current, subFields: inside.fields };
      }
    }
    if (current.type === "flexible" && current.layouts) {
      // Each layout is a list of its own: its fields look only at those above them in it.
      const layouts = current.layouts.map((layout) => {
        const inside = pruneConditions(layout.subFields);
        changed.push(...inside.changed);
        return inside.changed.length > 0 ? { ...layout, subFields: inside.fields } : layout;
      });
      current = { ...current, layouts };
    }
    return current;
  });
  return { fields: next, changed };
}

// ---------------------------------------------------------------------------
// The fields inside a group or repeater
// ---------------------------------------------------------------------------

/** The types a group's or repeater's fields can be: all but a group or repeater (nesting is one deep). */
export const SUB_FIELD_TYPES: readonly FieldType[] = FIELD_TYPE_KEYS.filter((type) => !isStructural(type));

/** A field with its group's or repeater's fields changed by `edit`, the conditions among them kept whole. */
function withSubs(fields: readonly FieldDef[], parentId: string, edit: (subs: FieldDef[]) => FieldDef[]) {
  return fields.map((field) =>
    field.id === parentId ? { ...field, subFields: pruneConditions(edit(field.subFields ?? [])).fields } : field,
  );
}

/** A new field of a type at the end of a group's or repeater's fields, named apart from the others there. */
export function addSubField(
  fields: readonly FieldDef[],
  parentId: string,
  type: FieldType,
): { fields: FieldDef[]; added: FieldDef | null } {
  const parent = fields.find((f) => f.id === parentId);
  if (
    !parent ||
    !isStructural(parent.type) ||
    isStructural(type) ||
    (parent.subFields ?? []).length >= MAX_SUB_FIELDS
  ) {
    return { fields: [...fields], added: null };
  }
  const added = newField(
    type,
    (parent.subFields ?? []).map((s) => s.name),
  );
  return { fields: withSubs(fields, parentId, (subs) => [...subs, added]), added };
}

/** A field inside a group or repeater, replaced by its edited copy. */
export const replaceSubField = (fields: readonly FieldDef[], parentId: string, next: FieldDef): FieldDef[] =>
  withSubs(fields, parentId, (subs) => subs.map((s) => (s.id === next.id ? next : s)));

/** A field inside a group or repeater, moved; conditions that looked at a field now below theirs are taken away. */
export const moveSubField = (fields: readonly FieldDef[], parentId: string, from: number, to: number): FieldDef[] =>
  withSubs(fields, parentId, (subs) => moveItem(subs, from, to));

/**
 * A field inside a group or repeater, taken out, and the conditions of the
 * others that looked at it with it. `changed` names the fields whose logic was
 * touched.
 */
export function removeSubField(
  fields: readonly FieldDef[],
  parentId: string,
  subId: string,
): { fields: FieldDef[]; changed: string[] } {
  let changed: string[] = [];
  const next = fields.map((field) => {
    if (field.id !== parentId) return field;
    const pruned = pruneConditions((field.subFields ?? []).filter((s) => s.id !== subId));
    changed = pruned.changed;
    return { ...field, subFields: pruned.fields };
  });
  return { fields: next, changed };
}

/** A copy of a field inside a group or repeater, next to it. */
export function duplicateSubField(
  fields: readonly FieldDef[],
  parentId: string,
  subId: string,
): { fields: FieldDef[]; copy: FieldDef } | null {
  const parent = fields.find((f) => f.id === parentId);
  if (!parent || (parent.subFields ?? []).length >= MAX_SUB_FIELDS) return null;
  const result = duplicateField(parent.subFields ?? [], subId);
  if (!result) return null;
  return { fields: fields.map((f) => (f.id === parentId ? { ...f, subFields: result.fields } : f)), copy: result.copy };
}

// ---------------------------------------------------------------------------
// The layouts of flexible content
// ---------------------------------------------------------------------------

/** A layout's key from its label: lowercase words with hyphens, not among `taken`. */
export const layoutKey = (label: string, taken: readonly string[]): string => uniqueName(slugOf(label, "layout"), taken, "-");

/** A flexible field with its layouts changed by `edit`, the conditions inside each kept whole. */
function withLayouts(fields: readonly FieldDef[], parentId: string, edit: (layouts: FieldLayout[]) => FieldLayout[]): FieldDef[] {
  return fields.map((field) =>
    field.id === parentId && field.type === "flexible"
      ? pruneConditions([{ ...field, layouts: edit(field.layouts ?? []) }]).fields[0]
      : field,
  );
}

/** A new layout at the end of a flexible field's layouts (with a text field to start from), keyed and labelled apart from the others. */
export function addLayout(
  fields: readonly FieldDef[],
  parentId: string,
  label = "New layout",
): { fields: FieldDef[]; added: FieldLayout | null } {
  const parent = fields.find((f) => f.id === parentId);
  if (!parent || parent.type !== "flexible" || (parent.layouts ?? []).length >= MAX_LAYOUTS) return { fields: [...fields], added: null };
  const layouts = parent.layouts ?? [];
  const added = newLayout(uniqueName(label, layouts.map((l) => l.label), " "), layouts.map((l) => l.key));
  return { fields: withLayouts(fields, parentId, (all) => [...all, added]), added };
}

/** A layout replaced by its edited copy, found by its key as it was (a layout not yet saved may change its key). */
export const replaceLayout = (fields: readonly FieldDef[], parentId: string, key: string, next: FieldLayout): FieldDef[] =>
  withLayouts(fields, parentId, (all) => all.map((l) => (l.key === key ? next : l)));

/** A layout's label in the main language changed (its key stays: rows are kept under it). */
export const renameLayout = (fields: readonly FieldDef[], parentId: string, key: string, label: string): FieldDef[] =>
  withLayouts(fields, parentId, (all) => all.map((l) => (l.key === key ? { ...l, label } : l)));

/** A layout moved to another place in the list. */
export const moveLayout = (fields: readonly FieldDef[], parentId: string, from: number, to: number): FieldDef[] =>
  withLayouts(fields, parentId, (all) => moveItem(all, from, to));

/** A layout taken out; rows that used it are dropped when the group is next saved with values, never on read. */
export const removeLayout = (fields: readonly FieldDef[], parentId: string, key: string): FieldDef[] =>
  withLayouts(fields, parentId, (all) => all.filter((l) => l.key !== key));

/** A copy of a layout next to it: a key and label of its own, new ids for its fields, the conditions among them following. */
export function duplicateLayout(
  fields: readonly FieldDef[],
  parentId: string,
  key: string,
): { fields: FieldDef[]; copy: FieldLayout } | null {
  const parent = fields.find((f) => f.id === parentId);
  const source = parent?.layouts?.find((l) => l.key === key);
  if (!parent || parent.type !== "flexible" || !source || (parent.layouts ?? []).length >= MAX_LAYOUTS) return null;
  const layouts = parent.layouts ?? [];
  const holder = cloneField({ id: "holder", name: "holder", label: "", type: "flexible", access: "private", layouts: [source] });
  const copy: FieldLayout = {
    ...(holder.layouts?.[0] as FieldLayout),
    key: layoutKey(`${source.key}-copy`, layouts.map((l) => l.key)),
    label: uniqueName(`${source.label} (copy)`.slice(0, 80), layouts.map((l) => l.label), " "),
    labels: undefined,
  };
  const index = layouts.findIndex((l) => l.key === key);
  return { fields: withLayouts(fields, parentId, (all) => [...all.slice(0, index + 1), copy, ...all.slice(index + 1)]), copy };
}

/**
 * A layout as a stand-in group, so the fields inside it are edited with the
 * same functions (`addSubField()` and the rest) and dialog as a group's; put
 * the edited fields back with `withHeldFields()`.
 */
export const layoutHolder = (layout: FieldLayout, parent: Pick<FieldDef, "access">): FieldDef => ({
  id: `layout:${layout.key}`,
  name: layout.key.replace(/-/g, "_"),
  label: layout.label,
  type: "group",
  access: parent.access,
  subFields: layout.subFields,
});

/** A layout with the fields a holder ended up with. */
export const withHeldFields = (layout: FieldLayout, holder: Pick<FieldDef, "subFields">): FieldLayout => ({
  ...layout,
  subFields: holder.subFields ?? [],
});

/** What a flexible field's layouts are, in a line for the list: "3 layouts: Text, Picture, Quote". */
export function layoutsSummary(field: Pick<FieldDef, "layouts">): string {
  const layouts = field.layouts ?? [];
  if (layouts.length === 0) return "No layouts yet";
  const names = layouts.slice(0, 3).map((l) => l.label || l.key);
  return `${layouts.length} ${layouts.length === 1 ? "layout" : "layouts"}: ${names.join(", ")}${layouts.length > 3 ? " …" : ""}`;
}

/** What a group, repeater or flexible content holds, in a line for the list: "3 fields: Title, Text, Picture". */
export function subFieldsSummary(field: Pick<FieldDef, "type" | "subFields" | "layouts">): string {
  if (field.type === "flexible") return layoutsSummary(field);
  const subs = subFieldsOf(field);
  if (subs.length === 0) return "No fields yet";
  const names = subs.slice(0, 3).map((s) => s.label || s.name);
  return `${subs.length} ${subs.length === 1 ? "field" : "fields"}: ${names.join(", ")}${subs.length > 3 ? " …" : ""}`;
}

/** How a condition's value is asked for, by the type of the field it looks at. */
export type ValueKind = "none" | "choice" | "boolean" | "number" | "date" | "time" | "datetime" | "text";

export function valueKindFor(type: FieldType | undefined, operator: ConditionOperator): ValueKind {
  if (VALUELESS_OPERATORS.includes(operator) || !type) return "none";
  if (hasChoices(type) && operator !== "matches") return "choice";
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "measurement" || type === "money") return "number";
  if (type === "date" || type === "time" || type === "datetime") return type;
  return "text";
}

/** A condition made consistent with the field it looks at: an operator that field's type offers, and a value of the right kind. */
export function settleCondition(condition: Condition, trigger: FieldDef | undefined): Condition {
  if (!trigger) return condition;
  const operators = operatorsFor(trigger.type);
  const operator = operators.includes(condition.operator) ? condition.operator : operators[0];
  const kind = valueKindFor(trigger.type, operator);
  if (kind === "none") return { field: condition.field, operator };
  let value = condition.value ?? "";
  if (kind === "boolean" && value !== "1" && value !== "0") value = "1";
  if (kind === "choice" && !(trigger.choices ?? []).some((c) => c.key === value))
    value = trigger.choices?.[0]?.key ?? "";
  return { field: condition.field, operator, value };
}

/** A new condition on the first field above. */
export function newCondition(above: readonly FieldDef[]): Condition | null {
  const trigger = above[0];
  if (!trigger) return null;
  return settleCondition({ field: trigger.id, operator: operatorsFor(trigger.type)[0] }, trigger);
}

export const operatorLabel = (operator: ConditionOperator): string => CONDITION_OPERATORS[operator];

// ---------------------------------------------------------------------------
// A group before Save
// ---------------------------------------------------------------------------

/** The ids of fields whose logic looks at a field that is gone or no longer above them, in a group's or repeater's fields too (their group or repeater counts as broken as well). */
export function fieldsWithBrokenLogic(fields: readonly FieldDef[]): Set<string> {
  const broken = new Set<string>();
  fields.forEach((field, index) => {
    const above = new Set(fields.slice(0, index).map((f) => f.id));
    if ((field.when ?? []).flat().some((c) => !above.has(c.field))) broken.add(field.id);
    // Flexible content's layouts are lists of their own: a field looks only at those above it in its layout.
    for (const list of fieldListsOf(field)) {
      const inside = fieldsWithBrokenLogic(list);
      if (inside.size > 0) {
        broken.add(field.id);
        for (const id of inside) broken.add(id);
      }
    }
  });
  return broken;
}

/** What is wrong with a group that the editor can tell without the server: the server checks the rest. */
export function draftProblems(draft: FieldGroupInput): string[] {
  const problems: string[] = [];
  const misfits = draft.location.flat().filter((rule) => !ruleFits(rule, draft.entities));
  if (misfits.length > 0) {
    problems.push(
      "Some location rules ask about something the chosen kinds of thing do not have. Remove them or choose the kind again.",
    );
  }
  if (draft.location.flat().some((rule) => rule.value.trim() === ""))
    problems.push("Choose what each location rule compares with.");
  const staffProblem = staffGroupProblem(draft as { entities: FieldEntity[]; fields: FieldDef[] });
  if (staffProblem) problems.push(staffProblem);
  draft.fields.forEach((field, index) => {
    const above = new Set(draft.fields.slice(0, index).map((f) => f.id));
    if ((field.when ?? []).flat().some((c) => !above.has(c.field))) {
      problems.push(
        `${field.label || "A field"} is shown by a field that is no longer above it. Change its logic or move the fields.`,
      );
    }
    if (field.type === "flexible") {
      const layouts = (field.layouts ?? []) as FieldLayout[];
      if (layouts.length === 0) problems.push(`Add layouts to ${field.label || "the flexible content"}.`);
      if (layouts.some((layout) => layout.subFields.length === 0)) problems.push(`Add fields to every layout of ${field.label || "the flexible content"}.`);
      if (layouts.some((layout) => fieldsWithBrokenLogic(layout.subFields).size > 0)) {
        problems.push(
          `Some fields in ${field.label || "a field"} are shown by a field that is no longer above them. Change their logic or move the fields.`,
        );
      }
    } else if (isStructural(field.type as FieldType)) {
      const subs = (field.subFields ?? []) as FieldDef[];
      if (subs.length === 0)
        problems.push(`Add fields to ${field.label || "the " + FIELD_TYPES[field.type].label.toLowerCase()}.`);
      if (fieldsWithBrokenLogic(subs).size > 0) {
        problems.push(
          `Some fields in ${field.label || "a field"} are shown by a field that is no longer above them. Change their logic or move the fields.`,
        );
      }
    }
  });
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// One field before Apply
// ---------------------------------------------------------------------------

export const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * What is wrong with a field, in words, for the dialog to say before it lets
 * the field go back into its group (or a group's or repeater's field into its
 * container). `otherNames` are the names of the fields next to it, `above` the
 * fields its logic may look at.
 */
export function fieldProblems(field: FieldDef, otherNames: readonly string[], above: readonly FieldDef[]): string[] {
  const problems: string[] = [];
  if (field.label.trim() === "") problems.push("Give the field a label.");
  if (!NAME_PATTERN.test(field.name) || field.name.length > 40) {
    problems.push("The name starts with a lowercase letter and uses lowercase letters, digits and underscores.");
  } else if (otherNames.includes(field.name)) problems.push(`Another field is already named ${field.name}.`);
  if (hasChoices(field.type)) {
    const choices = field.choices ?? [];
    if (choices.length === 0) problems.push("Add at least one choice.");
    if (choices.some((c) => c.label.trim() === "")) problems.push("Give each choice a label.");
    if (choices.some((c) => !KEY_PATTERN.test(c.key) || c.key.length > 40)) {
      problems.push("A choice's key uses lowercase letters, digits, hyphens and underscores.");
    }
    if (new Set(choices.map((c) => c.key)).size !== choices.length) problems.push("Two choices have the same key.");
  }
  if (field.type === "measurement" && (field.units ?? []).length === 0) problems.push("Add at least one unit.");
  if (field.min !== undefined && field.max !== undefined && field.min > field.max)
    problems.push("The least is more than the most.");
  if (field.type === "flexible") {
    const layouts = field.layouts ?? [];
    if (layouts.length === 0) problems.push("Add at least one layout.");
    if (layouts.some((l) => l.label.trim() === "")) problems.push("Give each layout a label.");
    if (layouts.some((l) => !KEY_PATTERN.test(l.key) || l.key.length > 40)) {
      problems.push("A layout's key uses lowercase letters, digits, hyphens and underscores.");
    }
    if (new Set(layouts.map((l) => l.key)).size !== layouts.length) problems.push("Two layouts have the same key.");
    if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
      problems.push("The fewest rows is more than the most.");
    }
    for (const layout of layouts) {
      const where = layout.label.trim() || layout.key;
      if (layout.subFields.length === 0) problems.push(`Add at least one field to the layout ${where}.`);
      layout.subFields.forEach((sub, index) => {
        const others = layout.subFields.filter((_, i) => i !== index).map((s) => s.name);
        for (const problem of fieldProblems(sub, others, layout.subFields.slice(0, index)))
          problems.push(`${where}, ${sub.label.trim() || "a field inside"}: ${problem}`);
      });
    }
  } else if (isStructural(field.type)) {
    const subs = field.subFields ?? [];
    if (subs.length === 0)
      problems.push(`Add at least one field to the ${FIELD_TYPES[field.type].label.toLowerCase()}.`);
    if (
      field.type === "repeater" &&
      field.minRows !== undefined &&
      field.maxRows !== undefined &&
      field.minRows > field.maxRows
    ) {
      problems.push("The fewest rows is more than the most.");
    }
    subs.forEach((sub, index) => {
      const others = subs.filter((_, i) => i !== index).map((s) => s.name);
      const inner = fieldProblems(sub, others, subs.slice(0, index));
      for (const problem of inner) problems.push(`${sub.label.trim() || "A field inside"}: ${problem}`);
    });
  }
  const known = new Set(above.map((f) => f.id));
  if ((field.when ?? []).flat().some((c) => !known.has(c.field)))
    problems.push("The logic looks at a field that is no longer above this one.");
  return problems;
}

/** Settings a type has of its own beyond those every field has (so the dialog can say when there are none). */
export function hasTypeSettings(type: FieldType): boolean {
  return (
    [
      "text",
      "textarea",
      "email",
      "url",
      "phone",
      "number",
      "measurement",
      "gallery",
      "product",
      "page",
      "term",
      "repeater",
      "flexible",
      "money",
    ].includes(type) || hasChoices(type)
  );
}
