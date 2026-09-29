import {
  CONDITION_OPERATORS,
  FIELD_ENTITIES,
  LOCATION_CHOICES,
  LOCATION_PARAMS,
  VALUELESS_OPERATORS,
  hasChoices,
  operatorsFor,
  slugOf,
  uniqueName,
  newFieldId,
  type Condition,
  type ConditionOperator,
  type FieldDef,
  type FieldEntity,
  type FieldGroupInput,
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

/** A copy of a field to put next to it: a new id and a name of its own; what it shows by carries over. */
export function duplicateField(fields: readonly FieldDef[], id: string): { fields: FieldDef[]; copy: FieldDef } | null {
  const index = fields.findIndex((f) => f.id === id);
  if (index === -1) return null;
  const source = fields[index];
  const copy: FieldDef = {
    ...structuredClone(source),
    id: newFieldId(),
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
 * they are on (removed, or moved below it), and rule groups left empty.
 * `changed` names the fields whose logic was touched.
 */
export function pruneConditions(fields: readonly FieldDef[]): { fields: FieldDef[]; changed: string[] } {
  const changed: string[] = [];
  const next = fields.map((field, index) => {
    if (!field.when || field.when.length === 0) return field;
    const above = new Set(fields.slice(0, index).map((f) => f.id));
    const when = field.when.map((all) => all.filter((c) => above.has(c.field))).filter((all) => all.length > 0);
    if (when.flat().length === field.when.flat().length) return field;
    changed.push(field.label);
    return { ...field, when: when.length > 0 ? when : undefined };
  });
  return { fields: next, changed };
}

/** How a condition's value is asked for, by the type of the field it looks at. */
export type ValueKind = "none" | "choice" | "boolean" | "number" | "date" | "time" | "datetime" | "text";

export function valueKindFor(type: FieldType | undefined, operator: ConditionOperator): ValueKind {
  if (VALUELESS_OPERATORS.includes(operator) || !type) return "none";
  if (hasChoices(type) && operator !== "matches") return "choice";
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "measurement") return "number";
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
  draft.fields.forEach((field, index) => {
    const above = new Set(draft.fields.slice(0, index).map((f) => f.id));
    if ((field.when ?? []).flat().some((c) => !above.has(c.field))) {
      problems.push(
        `${field.label || "A field"} is shown by a field that is no longer above it. Change its logic or move the fields.`,
      );
    }
  });
  return [...new Set(problems)];
}

/** The ids of fields whose logic looks at a field that is gone or no longer above them. */
export function fieldsWithBrokenLogic(fields: readonly FieldDef[]): Set<string> {
  const broken = new Set<string>();
  fields.forEach((field, index) => {
    const above = new Set(fields.slice(0, index).map((f) => f.id));
    if ((field.when ?? []).flat().some((c) => !above.has(c.field))) broken.add(field.id);
  });
  return broken;
}
