import { z } from "zod";

import { cleanRichText, richTextPlain, type RichTextDoc } from "./page-content";
import { isPictureAddress } from "./picture-address";
import { embedUrl } from "./video-embed";

/**
 * Custom fields (D118, `docs/custom-fields.md`): owners define groups of
 * fields (a size guide, ingredients, a warranty), fill them in where they
 * edit a product, page or article, and place them in templates. This module
 * is the pure part, shared by the browser (the generator, the forms) and the
 * server (which checks everything it is sent and everything it reads):
 * field types, the definitions and how they are checked, where a group
 * applies (location rules), when a field shows (conditional logic), how a
 * value is checked and told apart by language, and the starting points.
 *
 * Values are keyed by a field's `id`, never its `name`, so a field can be
 * renamed without losing what was entered.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_FIELD_GROUPS = 50;
export const MAX_GROUP_FIELDS = 60;
export const MAX_CHOICES = 100;
export const MAX_GALLERY = 20;
export const MAX_RULES = 20;
export const TEXT_MAX = 500;
export const TEXTAREA_MAX = 5000;
const LABEL_MAX = 80;
const NAME_MAX = 40;

// ---------------------------------------------------------------------------
// Things that have fields
// ---------------------------------------------------------------------------

/**
 * The kinds of thing a group can be on: products, their variants, pages,
 * articles, and categories and tags (the store's own, `term`).
 */
export const FIELD_ENTITIES = {
  product: "Products",
  variant: "Variants",
  page: "Pages",
  article: "Articles",
  term: "Categories and tags",
} as const;
export type FieldEntity = keyof typeof FIELD_ENTITIES;
export const FIELD_ENTITY_KEYS = Object.keys(FIELD_ENTITIES) as [FieldEntity, ...FieldEntity[]];
export const isFieldEntity = (value: unknown): value is FieldEntity =>
  typeof value === "string" && Object.hasOwn(FIELD_ENTITIES, value);

// ---------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------

export const FIELD_TYPES = {
  text: { label: "Text", category: "Basic", translatable: true, hint: "A short line of text." },
  textarea: { label: "Text area", category: "Basic", translatable: true, hint: "Several lines of plain text." },
  number: { label: "Number", category: "Basic", translatable: false, hint: "A number, with a unit if you like." },
  measurement: {
    label: "Measurement",
    category: "Basic",
    translatable: false,
    hint: "A number with a unit chosen from a list, such as 250 g or 12 cm.",
  },
  email: { label: "Email", category: "Basic", translatable: false, hint: "An email address." },
  url: { label: "Web address", category: "Basic", translatable: false, hint: "A link to a web page." },
  phone: { label: "Phone number", category: "Basic", translatable: false, hint: "A telephone number." },
  select: { label: "Select", category: "Choice", translatable: false, hint: "One of a list, chosen from a drop-down." },
  radio: { label: "Radio buttons", category: "Choice", translatable: false, hint: "One of a short list." },
  buttons: { label: "Button group", category: "Choice", translatable: false, hint: "One of a short list, as buttons." },
  checkbox: { label: "Checkboxes", category: "Choice", translatable: false, hint: "Any number of a list." },
  boolean: { label: "Yes or no", category: "Choice", translatable: false, hint: "A switch." },
  richText: {
    label: "Rich text",
    category: "Content",
    translatable: true,
    hint: "Formatted text with headings, lists and links.",
  },
  image: { label: "Picture", category: "Content", translatable: false, hint: "One picture from the media library." },
  gallery: { label: "Gallery", category: "Content", translatable: false, hint: "Several pictures." },
  video: { label: "Video", category: "Content", translatable: false, hint: "A YouTube or Vimeo video." },
  date: { label: "Date", category: "Date and colour", translatable: false, hint: "A day." },
  datetime: { label: "Date and time", category: "Date and colour", translatable: false, hint: "A day and a time." },
  time: { label: "Time", category: "Date and colour", translatable: false, hint: "A time of day." },
  color: { label: "Colour", category: "Date and colour", translatable: false, hint: "A colour." },
  file: { label: "File", category: "Content", translatable: false, hint: "A file to download, such as a data sheet." },
  link: {
    label: "Link",
    category: "Relational",
    translatable: true,
    hint: "A link to a page, product, category, tag or web address, with its own words and one per language.",
  },
  product: { label: "Product", category: "Relational", translatable: false, hint: "One or more of the store's products." },
  page: { label: "Page or article", category: "Relational", translatable: false, hint: "One or more of the store's published pages or articles." },
  term: { label: "Category or tag", category: "Relational", translatable: false, hint: "One or more of the store's categories or tags." },
  group: { label: "Group", category: "Layout", translatable: false, hint: "Several fields that belong together, shown as one." },
  repeater: {
    label: "Repeater",
    category: "Layout",
    translatable: false,
    hint: "Rows of the same fields, as many as you allow: features, sizes, ingredients with amounts.",
  },
} as const;

export type FieldType = keyof typeof FIELD_TYPES;
export const FIELD_TYPE_KEYS = Object.keys(FIELD_TYPES) as [FieldType, ...FieldType[]];
export const FIELD_CATEGORIES = ["Basic", "Choice", "Content", "Date and colour", "Relational", "Layout"] as const;

/** Whether a type's value has one text per language; the rest are the same in every language. */
export const isTranslatable = (type: FieldType): boolean => FIELD_TYPES[type].translatable;

/** A group or a repeater: it holds fields of its own, whose texts are per language one by one. */
export const isStructural = (type: FieldType): boolean => type === "group" || type === "repeater";

/** The fields a group or repeater holds (none for other types). */
export const subFieldsOf = (def: Pick<FieldDef, "type" | "subFields">): FieldDef[] => (isStructural(def.type) ? (def.subFields ?? []) : []);

/** Whether some part of a field's value is per language: a text-like type, or a group or repeater with such a field in it. */
export const hasTranslations = (def: Pick<FieldDef, "type" | "subFields">): boolean =>
  isStructural(def.type) ? subFieldsOf(def).some((sub) => isTranslatable(sub.type)) : isTranslatable(def.type);

/** Rows in a repeater, at most; and the most a sub field list may hold. */
export const MAX_REPEATER_ROWS = 100;
export const MAX_SUB_FIELDS = 30;
/** How many things a relational field may point at. */
export const MAX_RELATED = 50;

const CHOICE_TYPES: readonly FieldType[] = ["select", "radio", "buttons", "checkbox"];
/** The types a listing can be filtered by (D78): a choice from a list, or a yes or no. */
export const FILTER_TYPES: readonly FieldType[] = ["select", "radio", "buttons", "checkbox", "boolean"];
/** The types keyword search reads: those that hold words. */
export const SEARCH_TYPES: readonly FieldType[] = ["text", "textarea", "richText", "select", "radio", "buttons", "checkbox"];
export const hasChoices = (type: FieldType): boolean => CHOICE_TYPES.includes(type);

/** How wide a field is in its group's form, in percent (ACF's wrapper width). */
export const FIELD_WIDTHS = [25, 33, 50, 66, 75, 100] as const;
export type FieldWidth = (typeof FIELD_WIDTHS)[number];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type FieldImage = { url: string; thumbnailUrl: string | null; alt: string };
export type FieldVideo = { source: "youtube" | "vimeo"; link: string };
export type FieldMeasurement = { value: number; unit: string };
/** A link (D118): what it points at (a page, product, category, tag by id, or a web address), and its words. */
export const LINK_KINDS = { page: "Page or article", product: "Product", category: "Category", tag: "Tag", url: "Web address" } as const;
export type LinkKind = keyof typeof LINK_KINDS;
export type FieldLink = { kind: LinkKind; ref: string; label: string; newTab?: boolean };
/** A file to download, kept in the store's own storage. */
export type FieldFile = { url: string; name: string; size: number; contentType: string };

/** What a field holds, by type. Empty values are never stored. */
export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | FieldMeasurement
  | FieldImage
  | FieldImage[]
  | FieldVideo
  | FieldLink
  | FieldFile
  | RichTextDoc
  | Values
  | Values[];

/** Values by field id. In a group, the values of its fields; a repeater's rows are these with an `id` of their own. */
export interface Values {
  [id: string]: FieldValue;
}

/**
 * A thing's values as they are kept: those that are the same in every
 * language, and, for each language, those written in it (text, rich text).
 */
export type FieldData = { values: Values; translations: Record<string, Values> };
export const EMPTY_DATA: FieldData = { values: {}, translations: {} };

/** What an editor sends: a `null` takes a value away. Fields it does not name are left as they are. */
export type FieldChanges = {
  values: Record<string, FieldValue | null>;
  translations: Record<string, Record<string, FieldValue | null>>;
};

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const CONDITION_OPERATORS = {
  has: "Has any value",
  empty: "Has no value",
  "==": "Is equal to",
  "!=": "Is not equal to",
  contains: "Contains",
  matches: "Matches pattern",
  ">": "Is greater than",
  "<": "Is less than",
} as const;
export type ConditionOperator = keyof typeof CONDITION_OPERATORS;
/** Operators that need no value to compare with. */
export const VALUELESS_OPERATORS: readonly ConditionOperator[] = ["has", "empty"];

/** Shows a field by the value of another in the same group. */
export type Condition = { field: string; operator: ConditionOperator; value?: string };

/** OR between the groups, AND inside each (ACF's shape, for location rules and conditional logic alike). */
export type RuleGroups<T> = T[][];

export type Choice = { key: string; label: string; labels?: Record<string, string> };

/** Who can see a field's value on the site: nobody, until the owner chooses (as Shopify's metafields). */
export const FIELD_ACCESS = { private: "Only staff", public: "Shown on the site" } as const;
export type FieldAccess = keyof typeof FIELD_ACCESS;

export type FieldDef = {
  /** Never changes; values are kept under it. */
  id: string;
  /** For people and templates; may be changed. */
  name: string;
  label: string;
  /** The label in other languages, by locale. */
  labels?: Record<string, string>;
  /** Help for staff under the label; never shown to shoppers. */
  instructions?: string;
  type: FieldType;
  required?: boolean;
  width?: FieldWidth;
  access: FieldAccess;
  /** Shows the field by other fields' values. */
  when?: RuleGroups<Condition>;
  placeholder?: string;
  /** Text: the most characters. */
  maxLength?: number;
  /** Number and measurement: the least and most, and the step between. */
  min?: number;
  max?: number;
  step?: number;
  /** Number: the unit shown after it. */
  unit?: string;
  /** Measurement: the units to choose from; the first is the default. */
  units?: string[];
  /** Select, radio, buttons and checkboxes. */
  choices?: Choice[];
  /** Gallery: the most pictures. */
  maxItems?: number;
  /** Group and repeater: the fields in it (never a group or repeater themselves). */
  subFields?: FieldDef[];
  /** Repeater: the fewest and most rows, the label of the button that adds one, and how a row is laid out in the form. */
  minRows?: number;
  maxRows?: number;
  buttonLabel?: string;
  rowLayout?: "table" | "block";
  /** Where else a public field is used (D118): offered as a filter in the listing, found by keyword search, told by the chat agent. */
  filter?: boolean;
  search?: boolean;
  chat?: boolean;
  /** Product, page and category or tag fields: whether one thing or several may be chosen. */
  multiple?: boolean;
  /** Category or tag fields: which of them to choose from. */
  termKinds?: ("category" | "tag")[];
};

export const FIELD_POSITIONS = { main: "Main column", side: "Side column" } as const;
export type FieldPosition = keyof typeof FIELD_POSITIONS;

export type LocationRule = { param: string; operator: "==" | "!="; value: string };

export type FieldGroup = {
  id: string;
  name: string;
  /** Unique in the store; what templates and the export call it. */
  slug: string;
  /** What it can be on. */
  entities: FieldEntity[];
  /** Which of those, by OR of AND rules; none: all of them. */
  location: RuleGroups<LocationRule>;
  fields: FieldDef[];
  position: FieldPosition;
  active: boolean;
  sort: number;
};

// ---------------------------------------------------------------------------
// Where a group applies (location rules)
// ---------------------------------------------------------------------------

/** What rules can ask about, by kind of thing. */
export const LOCATION_PARAMS: Record<FieldEntity, readonly { param: string; label: string }[]> = {
  product: [
    { param: "kind", label: "Kind of product" },
    { param: "category", label: "Category" },
    { param: "tag", label: "Tag" },
    { param: "audience", label: "Sold to" },
  ],
  page: [
    { param: "category", label: "Category" },
    { param: "tag", label: "Tag" },
    { param: "role", label: "Special page" },
  ],
  article: [
    { param: "category", label: "Category" },
    { param: "tag", label: "Tag" },
  ],
  // A variant follows its product: what the product is and where it is listed.
  variant: [
    { param: "kind", label: "Kind of product" },
    { param: "category", label: "Product's category" },
    { param: "tag", label: "Product's tag" },
    { param: "audience", label: "Sold to" },
  ],
  term: [
    { param: "termKind", label: "Category or tag" },
    { param: "content", label: "Used for" },
  ],
};

/** The fixed answers for the params that have some. */
export const LOCATION_CHOICES: Record<string, readonly { value: string; label: string }[]> = {
  kind: [
    { value: "goods", label: "Goods" },
    { value: "appointment", label: "Appointment" },
    { value: "stay", label: "Stay" },
    { value: "rental", label: "Rental" },
  ],
  termKind: [
    { value: "category", label: "Category" },
    { value: "tag", label: "Tag" },
  ],
  content: [
    { value: "product", label: "Products" },
    { value: "page", label: "Pages" },
    { value: "article", label: "Articles" },
  ],
  audience: [
    { value: "all", label: "Everyone" },
    { value: "consumers", label: "Private shoppers" },
    { value: "businesses", label: "Businesses" },
  ],
};

/** What is known about a thing, to say which groups it gets. */
export type Facts = {
  entity: FieldEntity;
  /** A product's kind, and who it is sold to. */
  kind?: string;
  audience?: string;
  /** Its categories with their parents, and its tags, by id. */
  categories: string[];
  tags: string[];
  /** The special pages (roles) a page is chosen for. */
  roles: string[];
  /** A category or tag: which it is, and what it sorts (products, pages or articles). */
  termKind?: string;
  content?: string;
};

export function ruleMatches(rule: LocationRule, facts: Facts): boolean {
  let holds: boolean;
  switch (rule.param) {
    case "kind":
      holds = facts.kind === rule.value;
      break;
    case "audience":
      holds = (facts.audience ?? "all") === rule.value;
      break;
    case "category":
      holds = facts.categories.includes(rule.value);
      break;
    case "tag":
      holds = facts.tags.includes(rule.value);
      break;
    case "role":
      holds = facts.roles.includes(rule.value);
      break;
    case "termKind":
      holds = facts.termKind === rule.value;
      break;
    case "content":
      holds = facts.content === rule.value;
      break;
    default:
      holds = false;
  }
  return rule.operator === "==" ? holds : !holds;
}

/** Whether a group is on a thing: active, for its kind, and matching one of its rule groups (or having none). */
export function groupApplies(group: FieldGroup, facts: Facts): boolean {
  if (!group.active || !group.entities.includes(facts.entity)) return false;
  if (group.location.length === 0) return true;
  return group.location.some((all) => all.every((rule) => ruleMatches(rule, facts)));
}

/** Category ids with their parents' ids: a rule about a category holds for what is in its subcategories. */
export function withParents(
  ids: readonly string[],
  terms: readonly { id: string; parentId: string | null }[],
): string[] {
  const byId = new Map(terms.map((term) => [term.id, term]));
  const all = new Set<string>();
  for (const id of ids) {
    for (let at = byId.get(id); at && !all.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined)
      all.add(at.id);
  }
  return [...all];
}

/** A group's rules for a kind of thing only: a rule about something else (a page's role on a product) would never match. */
export const locationFor = (group: FieldGroup, entity: FieldEntity): RuleGroups<LocationRule> =>
  group.location
    .map((all) => all.filter((rule) => LOCATION_PARAMS[entity].some((p) => p.param === rule.param)))
    .filter((all) => all.length > 0);

// ---------------------------------------------------------------------------
// Values as text, and when they are empty
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDoc = (v: unknown): v is RichTextDoc => isRecord(v) && v.type === "doc" && Array.isArray(v.content);
const isImage = (v: unknown): v is FieldImage => isRecord(v) && typeof v.url === "string" && "alt" in v;
const isMeasurement = (v: unknown): v is FieldMeasurement => isRecord(v) && typeof v.value === "number" && typeof v.unit === "string";
const isVideo = (v: unknown): v is FieldVideo => isRecord(v) && typeof v.source === "string" && typeof v.link === "string";
const isLink = (v: unknown): v is FieldLink => isRecord(v) && typeof v.kind === "string" && typeof v.ref === "string" && typeof v.label === "string";
const isFile = (v: unknown): v is FieldFile => isRecord(v) && typeof v.url === "string" && typeof v.name === "string" && typeof v.size === "number";

export function isEmptyValue(value: FieldValue | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (isDoc(value)) return richTextPlain(value).trim() === "";
  // A group: empty when everything in it is; the other objects (a picture, a link) hold something as soon as they exist.
  if (isImage(value) || isMeasurement(value) || isVideo(value) || isLink(value) || isFile(value)) return false;
  return Object.values(value).every((inner) => isEmptyValue(inner as FieldValue));
}

/** A value as text, for comparing in conditions and for a plain rendering. */
export function valueText(value: FieldValue | null | undefined): string {
  if (isEmptyValue(value) || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) {
    // Choices and ids are texts; pictures have addresses; a repeater's rows count.
    if (value.every((item) => typeof item === "string")) return (value as string[]).join(", ");
    if (value.every(isImage)) return (value as FieldImage[]).map((item) => item.url).join(", ");
    return String(value.length);
  }
  if (isDoc(value)) return richTextPlain(value);
  if (isMeasurement(value)) return `${value.value} ${value.unit}`;
  if (isVideo(value)) return value.link;
  if (isImage(value)) return value.url;
  if (isLink(value)) return value.label || value.ref;
  if (isFile(value)) return value.name;
  return "";
}

// ---------------------------------------------------------------------------
// Conditional logic
// ---------------------------------------------------------------------------

const asBool = (text: string) => ["1", "true", "yes"].includes(text.trim().toLowerCase());

/** Whether one condition holds for the values (in the language being edited or shown). */
export function conditionHolds(condition: Condition, values: Values): boolean {
  const value = values[condition.field];
  const empty = isEmptyValue(value);
  const wanted = condition.value ?? "";
  switch (condition.operator) {
    case "has":
      return !empty;
    case "empty":
      return empty;
    case "==":
      if (typeof value === "boolean") return value === asBool(wanted);
      if (Array.isArray(value)) return (value as unknown[]).some((item) => item === wanted);
      return valueText(value) === wanted;
    case "!=":
      return !conditionHolds({ ...condition, operator: "==" }, values);
    case "contains":
      if (Array.isArray(value)) return (value as unknown[]).some((item) => item === wanted);
      return valueText(value).toLowerCase().includes(wanted.toLowerCase());
    case "matches":
      try {
        return wanted.length <= 200 && new RegExp(wanted, "i").test(valueText(value));
      } catch {
        return false;
      }
    case ">":
    case "<": {
      const number = typeof value === "number" ? value : isMeasurement(value) ? value.value : Number(valueText(value));
      const limit = Number(wanted);
      if (empty || Number.isNaN(number) || Number.isNaN(limit)) return false;
      return condition.operator === ">" ? number > limit : number < limit;
    }
  }
}

/** Whether a field shows, given the values of its group: no logic, or one of its rule groups holds in full. */
export function fieldShows(def: FieldDef, values: Values): boolean {
  if (!def.when || def.when.length === 0) return true;
  return def.when.some((all) => all.every((condition) => conditionHolds(condition, values)));
}

/** The operators that make sense for a trigger field of a type. */
export function operatorsFor(type: FieldType): ConditionOperator[] {
  switch (type) {
    case "number":
    case "measurement":
      return ["has", "empty", "==", "!=", ">", "<"];
    case "boolean":
      return ["==", "!="];
    case "select":
    case "radio":
    case "buttons":
      return ["has", "empty", "==", "!="];
    case "checkbox":
      return ["has", "empty", "contains"];
    case "image":
    case "gallery":
    case "video":
    case "file":
    case "link":
    case "product":
    case "page":
    case "term":
    case "group":
    case "repeater":
      return ["has", "empty"];
    case "date":
    case "datetime":
    case "time":
      return ["has", "empty", "==", "!=", ">", "<"];
    default:
      return ["has", "empty", "==", "!=", "contains", "matches"];
  }
}

// ---------------------------------------------------------------------------
// Checking a value
// ---------------------------------------------------------------------------

type Parsed = { ok: true; value: FieldValue | null } | { ok: false; problem: string };

const ok = (value: FieldValue | null): Parsed => ({ ok: true, value });
const bad = (def: FieldDef, problem: string): Parsed => ({ ok: false, problem: `${def.label}: ${problem}` });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s().-]{3,29}$/;

const validDay = (value: string) =>
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

function parseImage(def: FieldDef, raw: unknown): { ok: true; image: FieldImage } | { ok: false; problem: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: "Choose a picture." };
  const { url, thumbnailUrl, alt } = raw as Record<string, unknown>;
  if (typeof url !== "string" || !isPictureAddress(url.trim()) || url.length > 1000)
    return { ok: false, problem: "A picture has an invalid address." };
  if (
    thumbnailUrl !== null &&
    thumbnailUrl !== undefined &&
    (typeof thumbnailUrl !== "string" || !isPictureAddress(thumbnailUrl.trim()))
  ) {
    return { ok: false, problem: "A picture has an invalid address." };
  }
  if (alt !== undefined && typeof alt !== "string")
    return { ok: false, problem: "A picture's description must be text." };
  void def;
  return {
    ok: true,
    image: {
      url: url.trim(),
      thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl.trim() : null,
      alt: (alt ?? "").slice(0, 300),
    },
  };
}

/** A value of a field's type, cleaned; an empty one is `null`, which takes the value away. */
export function parseValue(def: FieldDef, raw: unknown): Parsed {
  if (raw === null || raw === undefined) return ok(null);
  switch (def.type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return bad(def, "Write some text.");
      const text = raw.replace(/\r\n/g, "\n").trim();
      const max = Math.min(
        def.maxLength ?? (def.type === "text" ? TEXT_MAX : TEXTAREA_MAX),
        def.type === "text" ? TEXT_MAX : TEXTAREA_MAX,
      );
      if (text.length > max) return bad(def, `Keep it under ${max} characters.`);
      return ok(text === "" ? null : def.type === "text" ? text.replace(/\s*\n\s*/g, " ") : text);
    }
    case "email":
    case "url":
    case "phone":
    case "color":
    case "date":
    case "time":
    case "datetime": {
      if (typeof raw !== "string") return bad(def, "Write some text.");
      const text = raw.trim();
      if (text === "") return ok(null);
      if (def.type === "email" && (!EMAIL.test(text) || text.length > 200))
        return bad(def, "That is not an email address.");
      if (def.type === "phone" && !PHONE.test(text)) return bad(def, "That is not a telephone number.");
      if (def.type === "url") {
        try {
          const url = new URL(text);
          if ((url.protocol !== "https:" && url.protocol !== "http:") || text.length > 1000) throw new Error("scheme");
        } catch {
          return bad(def, "A web address starts with https://.");
        }
      }
      if (def.type === "color" && !COLOR.test(text))
        return bad(def, "A colour is written as # and six hex digits, like #1f2937.");
      if (def.type === "date" && !validDay(text)) return bad(def, "That is not a date.");
      if (def.type === "time" && !TIME.test(text)) return bad(def, "That is not a time.");
      if (def.type === "datetime") {
        const [day, time] = text.split("T");
        if (!day || !time || !validDay(day) || !TIME.test(time.slice(0, 5)))
          return bad(def, "That is not a date and time.");
      }
      return ok(text);
    }
    case "number": {
      if (typeof raw === "string" && raw.trim() === "") return ok(null);
      const number = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw;
      if (typeof number !== "number" || !Number.isFinite(number)) return bad(def, "Write a number.");
      if (def.min !== undefined && number < def.min) return bad(def, `Use at least ${def.min}.`);
      if (def.max !== undefined && number > def.max) return bad(def, `Use at most ${def.max}.`);
      return ok(number);
    }
    case "measurement": {
      if (typeof raw !== "object" || Array.isArray(raw)) return bad(def, "Write a number and choose a unit.");
      const { value, unit } = raw as Record<string, unknown>;
      if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return ok(null);
      const number = typeof value === "string" ? Number(value.replace(",", ".")) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) return bad(def, "Write a number.");
      const units = def.units && def.units.length > 0 ? def.units : [];
      const chosen = typeof unit === "string" && unit !== "" ? unit : (units[0] ?? "");
      if (units.length > 0 && !units.includes(chosen)) return bad(def, "Choose one of the units.");
      if (def.min !== undefined && number < def.min) return bad(def, `Use at least ${def.min}.`);
      if (def.max !== undefined && number > def.max) return bad(def, `Use at most ${def.max}.`);
      return ok({ value: number, unit: chosen });
    }
    case "boolean":
      if (typeof raw !== "boolean") return bad(def, "Choose yes or no.");
      return ok(raw);
    case "select":
    case "radio":
    case "buttons": {
      if (typeof raw !== "string") return bad(def, "Choose one of the choices.");
      if (raw === "") return ok(null);
      if (!(def.choices ?? []).some((choice) => choice.key === raw)) return bad(def, "That is not one of the choices.");
      return ok(raw);
    }
    case "checkbox": {
      if (!Array.isArray(raw)) return bad(def, "Choose from the choices.");
      const keys = [...new Set(raw)];
      if (keys.some((key) => typeof key !== "string" || !(def.choices ?? []).some((choice) => choice.key === key))) {
        return bad(def, "That is not one of the choices.");
      }
      return ok(keys.length === 0 ? null : (keys as string[]));
    }
    case "richText": {
      const cleaned = cleanRichText(raw);
      if (!cleaned.ok) return bad(def, cleaned.problem);
      return ok(richTextPlain(cleaned.doc).trim() === "" ? null : cleaned.doc);
    }
    case "image": {
      const parsed = parseImage(def, raw);
      return parsed.ok ? ok(parsed.image) : bad(def, parsed.problem);
    }
    case "gallery": {
      if (!Array.isArray(raw)) return bad(def, "Choose pictures.");
      const most = Math.min(def.maxItems ?? MAX_GALLERY, MAX_GALLERY);
      if (raw.length > most) return bad(def, `Use at most ${most} pictures.`);
      const images: FieldImage[] = [];
      for (const item of raw) {
        const parsed = parseImage(def, item);
        if (!parsed.ok) return bad(def, parsed.problem);
        images.push(parsed.image);
      }
      return ok(images.length === 0 ? null : images);
    }
    case "video": {
      if (typeof raw !== "object" || Array.isArray(raw)) return bad(def, "Paste a YouTube or Vimeo address.");
      const { source, link } = raw as Record<string, unknown>;
      if (typeof link !== "string" || link.trim() === "") return ok(null);
      if (source !== "youtube" && source !== "vimeo") return bad(def, "Choose YouTube or Vimeo.");
      if (embedUrl(source, link.trim()) === null) return bad(def, "That is not a YouTube or Vimeo address.");
      return ok({ source, link: link.trim() });
    }
    case "file": {
      if (!isRecord(raw)) return bad(def, "Choose a file.");
      const { url, name, size, contentType } = raw;
      if (typeof url !== "string" || url.trim() === "") return ok(null);
      if (!isFileAddress(url.trim())) return bad(def, "A file has an invalid address.");
      if (typeof name !== "string" || name.trim() === "" || name.length > 200) return bad(def, "A file needs a name of at most 200 characters.");
      if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) return bad(def, "A file can be at most 50 MB.");
      if (typeof contentType !== "string" || contentType.length > 100) return bad(def, "A file has an invalid type.");
      return ok({ url: url.trim(), name: name.trim(), size, contentType });
    }
    case "link": {
      if (!isRecord(raw)) return bad(def, "Choose what to link to.");
      const { kind, ref, label, newTab } = raw;
      if (typeof ref !== "string" || ref.trim() === "") return ok(null);
      if (typeof kind !== "string" || !Object.hasOwn(LINK_KINDS, kind)) return bad(def, "Choose what to link to.");
      const target = ref.trim();
      if (kind === "url" ? !isLinkTarget(target) : !UUID.test(target)) return bad(def, kind === "url" ? "A web address starts with https:// or a slash." : "That is not something to link to.");
      if (label !== undefined && (typeof label !== "string" || label.length > 100)) return bad(def, "Keep the link's words under 100 characters.");
      return ok({ kind: kind as LinkKind, ref: target, label: typeof label === "string" ? label.trim() : "", ...(newTab === true && { newTab: true }) });
    }
    case "product":
    case "page":
    case "term": {
      const one = !def.multiple;
      const list = Array.isArray(raw) ? raw : raw === "" ? [] : [raw];
      const ids = [...new Set(list)];
      if (ids.some((id) => typeof id !== "string" || !UUID.test(id))) return bad(def, "That is not something to choose.");
      if (ids.length > (one ? 1 : MAX_RELATED)) return bad(def, one ? "Choose one." : `Choose at most ${MAX_RELATED}.`);
      if (ids.length === 0) return ok(null);
      return ok(one ? (ids[0] as string) : (ids as string[]));
    }
    case "group":
    case "repeater":
      return parseStructural(def, raw, "all");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROW_ID = /^r_[a-z0-9]{6,24}$/;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A file's address: on the web (https) or in the store's own storage path. */
const isFileAddress = (url: string) => url.length <= 1000 && (/^https:\/\//.test(url) || /^\/(?![/\\])\S*$/.test(url));
/** A link's web address: https or http, or a path on the store's own site. */
const isLinkTarget = (url: string) => url.length <= 1000 && (/^https?:\/\/\S+$/.test(url) || /^\/(?![/\\])\S*$/.test(url));

/**
 * A group's or repeater's value: its sub fields checked one by one. `part`
 * says which of them: all (a value as a person edits it), the shared ones or
 * the translated ones (as they are kept in the two kinds of row). A
 * repeater's rows are kept with an id of their own, the translated part by
 * that id, so a row moved keeps its words in every language.
 */
function parseStructural(def: FieldDef, raw: unknown, part: "all" | "shared" | "translated"): Parsed {
  if (raw === null || raw === undefined) return ok(null);
  const subs = subFieldsOf(def).filter((sub) => part === "all" || (part === "translated") === isTranslatable(sub.type));
  const cells = (source: unknown): { ok: true; values: Values } | { ok: false; problem: string } => {
    if (!isRecord(source)) return { ok: false, problem: "Fill in its fields." };
    const values: Values = {};
    for (const sub of subs) {
      if (!Object.hasOwn(source, sub.id)) continue;
      const parsed = parseValue(sub, source[sub.id]);
      if (!parsed.ok) return { ok: false, problem: parsed.problem };
      if (parsed.value !== null) values[sub.id] = parsed.value;
    }
    return { ok: true, values };
  };
  if (def.type === "group") {
    const result = cells(raw);
    if (!result.ok) return bad(def, result.problem);
    return ok(Object.keys(result.values).length > 0 ? result.values : null);
  }
  if (part === "translated") {
    if (!isRecord(raw)) return bad(def, "Its rows could not be read.");
    const entries = Object.entries(raw);
    if (entries.length > MAX_REPEATER_ROWS) return bad(def, `Use at most ${MAX_REPEATER_ROWS} rows.`);
    const out: Record<string, Values> = {};
    for (const [rowId, source] of entries) {
      if (!ROW_ID.test(rowId)) continue;
      const result = cells(source);
      if (!result.ok) return bad(def, result.problem);
      if (Object.keys(result.values).length > 0) out[rowId] = result.values;
    }
    return ok(Object.keys(out).length > 0 ? (out as unknown as Values) : null);
  }
  if (!Array.isArray(raw)) return bad(def, "Its rows could not be read.");
  const most = Math.min(def.maxRows ?? MAX_REPEATER_ROWS, MAX_REPEATER_ROWS);
  if (raw.length > most) return bad(def, `Use at most ${most} rows.`);
  const seen = new Set<string>();
  const rows: Values[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || !ROW_ID.test(item.id) || seen.has(item.id)) return bad(def, "A row could not be read.");
    seen.add(item.id);
    const result = cells(item);
    if (!result.ok) return bad(def, result.problem);
    rows.push({ id: item.id, ...result.values });
  }
  return ok(rows.length > 0 ? rows : null);
}

/** A new row's id: rows keep it wherever they are moved, and their words in other languages follow it. */
export const newRowId = () => `r_${randomHex(12)}`;

/**
 * What an editor sent, checked against the definitions of the groups on the
 * thing: only their fields count, everything else is dropped. A field
 * hidden by its logic is kept (so flipping the switch back restores it) but
 * never required. `locales` are the languages a store has; `main` is the one
 * a required text must be written in. A group's or repeater's sub fields
 * follow their own kind: the shared ones in the shared value, the texts in the
 * value of each language.
 */
export function parseFieldChanges(
  defs: FieldDef[],
  raw: unknown,
  locales: readonly string[],
  main: string,
): { changes: FieldChanges; problems: string[] } {
  const input = (isRecord(raw) ? raw : {}) as { values?: unknown; translations?: unknown };
  const sent = (isRecord(input.values) ? input.values : {}) as Record<string, unknown>;
  const sentTranslations = (isRecord(input.translations) ? input.translations : {}) as Record<string, unknown>;
  const changes: FieldChanges = { values: {}, translations: {} };
  const problems: string[] = [];

  for (const def of defs) {
    if (hasTranslations(def)) {
      for (const locale of locales) {
        const own = sentTranslations[locale];
        if (!isRecord(own) || !Object.hasOwn(own, def.id)) continue;
        const parsed = isStructural(def.type) ? parseStructural(def, own[def.id], "translated") : parseValue(def, own[def.id]);
        if (!parsed.ok) problems.push(locale === main ? parsed.problem : `${parsed.problem} (${locale})`);
        else (changes.translations[locale] ??= {})[def.id] = parsed.value;
      }
    }
    // What is the same in every language: everything but a text, and a group's or repeater's other fields.
    if (!isTranslatable(def.type) && Object.hasOwn(sent, def.id)) {
      const parsed = isStructural(def.type) ? parseStructural(def, sent[def.id], "shared") : parseValue(def, sent[def.id]);
      if (!parsed.ok) problems.push(parsed.problem);
      else changes.values[def.id] = parsed.value;
    }
  }
  return { changes, problems };
}

/**
 * What an editor holding `data` for these fields sends: every field's value,
 * a `null` where it holds none, so a value taken away is taken away.
 */
export function changesFrom(defs: FieldDef[], data: FieldData, locales: readonly string[]): FieldChanges {
  const changes: FieldChanges = { values: {}, translations: {} };
  for (const def of defs) {
    if (hasTranslations(def)) {
      for (const locale of locales) (changes.translations[locale] ??= {})[def.id] = data.translations[locale]?.[def.id] ?? null;
    }
    if (!isTranslatable(def.type)) changes.values[def.id] = data.values[def.id] ?? null;
  }
  return changes;
}

/** The values a change leaves: what was there, with what was sent over it. */
export function applyChanges(existing: FieldData, changes: FieldChanges): FieldData {
  const merge = (base: Values, over: Record<string, FieldValue | null> | undefined): Values => {
    const next: Values = { ...base };
    for (const [id, value] of Object.entries(over ?? {})) {
      if (value === null) delete next[id];
      else next[id] = value;
    }
    return next;
  };
  const translations: Record<string, Values> = {};
  for (const locale of new Set([...Object.keys(existing.translations), ...Object.keys(changes.translations)])) {
    const merged = merge(existing.translations[locale] ?? {}, changes.translations[locale]);
    if (Object.keys(merged).length > 0) translations[locale] = merged;
  }
  return { values: merge(existing.values, changes.values), translations };
}

// A group's or repeater's parts, as they are kept and as a person edits them ---

/** The fields of `values` that are shared, or those that are texts, as a group's or a row's cells. */
function cellsOf(subs: FieldDef[], values: Values | undefined, pick: "shared" | "translated"): Values {
  const out: Values = {};
  for (const sub of subs) {
    if ((pick === "translated") !== isTranslatable(sub.type)) continue;
    const value = values?.[sub.id];
    if (value !== undefined && !isEmptyValue(value)) out[sub.id] = value;
  }
  return out;
}

/** A group's or row's fields in a language: the shared ones as they are, the texts in the language's own words, else the main language's. */
function overlayCells(
  subs: FieldDef[],
  shared: Values | undefined,
  mainWords: Values | undefined,
  ownWords: Values | undefined,
  locale: string,
  main: string,
): Values {
  const out: Values = {};
  for (const sub of subs) {
    const value = isTranslatable(sub.type) ? (ownWords?.[sub.id] ?? (locale === main ? undefined : mainWords?.[sub.id])) : shared?.[sub.id];
    if (value !== undefined && !isEmptyValue(value)) out[sub.id] = value;
  }
  return out;
}

const asValues = (value: unknown): Values | undefined => (isRecord(value) ? (value as Values) : undefined);
const asRows = (value: unknown): Values[] => (Array.isArray(value) ? (value as Values[]).filter((row) => isRecord(row)) : []);

/**
 * A field's value in a language, as an editor shows it and a page draws it:
 * a text is the language's own, else the main language's; a group is its
 * fields (its texts by the same rule); a repeater is its rows, each with its
 * `id`, in the main language's order; the rest are the same everywhere.
 */
export function readField(def: FieldDef, data: FieldData, locale: string, main: string): FieldValue | undefined {
  if (!isStructural(def.type)) {
    return isTranslatable(def.type)
      ? (data.translations[locale]?.[def.id] ?? (locale === main ? undefined : data.translations[main]?.[def.id]))
      : data.values[def.id];
  }
  const subs = subFieldsOf(def);
  const words = (l: string) => data.translations[l]?.[def.id];
  if (def.type === "group") {
    const merged = overlayCells(subs, asValues(data.values[def.id]), asValues(words(main)), asValues(words(locale)), locale, main);
    return Object.keys(merged).length > 0 ? merged : undefined;
  }
  const rowWords = (l: string) => asValues(words(l)) as Record<string, Values> | undefined;
  const rows = asRows(data.values[def.id]).map((row) => ({
    id: String(row.id),
    ...overlayCells(subs, row, rowWords(main)?.[String(row.id)], rowWords(locale)?.[String(row.id)], locale, main),
  }));
  return rows.length > 0 ? rows : undefined;
}

/**
 * The data after a value for a field is written in a language: the counterpart
 * of `readField`. A text is the language's own; a group's shared fields and a
 * repeater's rows (their number, order and shared fields) are written in the
 * main language only, and another language writes only the texts in them, by
 * row.
 */
export function writeField(def: FieldDef, data: FieldData, locale: string, main: string, value: FieldValue | undefined): FieldData {
  const empty = value === undefined || isEmptyValue(value);
  const next: FieldData = { values: { ...data.values }, translations: { ...data.translations } };
  const setWords = (l: string, words: FieldValue | undefined) => {
    const own = { ...(next.translations[l] ?? {}) };
    if (words === undefined) delete own[def.id];
    else own[def.id] = words;
    if (Object.keys(own).length > 0) next.translations[l] = own;
    else delete next.translations[l];
  };
  if (!isStructural(def.type)) {
    if (isTranslatable(def.type)) setWords(locale, empty ? undefined : value);
    else if (empty) delete next.values[def.id];
    else next.values[def.id] = value;
    return next;
  }
  const subs = subFieldsOf(def);
  const filled = (values: Values) => (Object.keys(values).length > 0 ? values : undefined);
  if (def.type === "group") {
    const cells = asValues(value) ?? {};
    if (locale === main) {
      const shared = filled(cellsOf(subs, cells, "shared"));
      if (shared) next.values[def.id] = shared;
      else delete next.values[def.id];
    }
    setWords(locale, filled(cellsOf(subs, cells, "translated")));
    return next;
  }
  const rows = empty ? [] : asRows(value);
  if (locale === main) {
    if (rows.length === 0) {
      delete next.values[def.id];
      for (const l of Object.keys(next.translations)) setWords(l, undefined);
      return next;
    }
    next.values[def.id] = rows.map((row) => ({ id: String(row.id), ...cellsOf(subs, row, "shared") }));
  }
  const known = new Set(asRows(next.values[def.id]).map((row) => String(row.id)));
  const words: Record<string, Values> = {};
  for (const row of rows) {
    const cells = filled(cellsOf(subs, row, "translated"));
    if (cells && known.has(String(row.id))) words[String(row.id)] = cells;
  }
  setWords(locale, Object.keys(words).length > 0 ? (words as unknown as Values) : undefined);
  return next;
}

/** Required fields left empty, among those that show (in the main language for text), and the rows a repeater needs. */
export function requiredProblems(defs: FieldDef[], data: FieldData, main: string): string[] {
  const values = valuesFor(defs, data, main, main);
  const problems: string[] = [];
  for (const def of defs) {
    if (fieldShows(def, values)) problems.push(...requiredIn(def, values[def.id], ""));
  }
  return problems;
}

function requiredIn(def: FieldDef, value: FieldValue | undefined, where: string): string[] {
  const at = where ? `${where}: ` : "";
  const problems: string[] = [];
  if (def.required && isEmptyValue(value)) problems.push(`${at}${def.label} is required.`);
  if (!isStructural(def.type)) return problems;
  const subs = subFieldsOf(def);
  // What is inside is asked for once the group or repeater is used or asked for.
  if (def.type === "group") {
    const cells = asValues(value) ?? {};
    if (def.required || !isEmptyValue(value)) {
      for (const sub of subs) if (fieldShows(sub, cells)) problems.push(...requiredIn(sub, cells[sub.id], `${at}${def.label}`));
    }
    return problems;
  }
  const rows = asRows(value);
  if ((def.minRows ?? 0) > rows.length && (def.required || rows.length > 0 || (def.minRows ?? 0) > 0)) {
    problems.push(`${at}${def.label} needs at least ${def.minRows} ${def.minRows === 1 ? "row" : "rows"}.`);
  }
  rows.forEach((row, index) => {
    for (const sub of subs) if (fieldShows(sub, row)) problems.push(...requiredIn(sub, row[sub.id], `${at}${def.label}, row ${index + 1}`));
  });
  return problems;
}

/**
 * The values to show in a language: a text is the language's own, else the
 * main language's; the rest are the same everywhere.
 */
export function valuesFor(defs: FieldDef[], data: FieldData, locale: string, main: string): Values {
  const out: Values = {};
  for (const def of defs) {
    const value = readField(def, data, locale, main);
    if (value !== undefined && !isEmptyValue(value)) out[def.id] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a page shows
// ---------------------------------------------------------------------------

/** A field with a value, ready to draw, in the shopper's language. */
export type ShownField = {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  value: FieldValue;
  /** The value as plain text: a choice by its label, a number with its unit, a date as the language writes it. */
  text: string;
  /** A checkbox's chosen labels. */
  items?: string[];
  /** A group's fields, or a repeater's rows of fields, that have something to show. */
  children?: ShownField[];
  rows?: ShownField[][];
  /** What a file, a link or a relation points at, ready to draw: words and address (the server fills in the ones that need a lookup). */
  links?: ShownLink[];
  /** The field may be said by the chat agent (phase 2). */
  chat?: boolean;
};

/** Something a field points at: a file, a page, a product, a category or a web address. */
export type ShownLink = {
  label: string;
  href: string;
  /** Opens in a new tab: an address outside the site, or a file. */
  newTab?: boolean;
  /** A product's or page's picture, when it has one. */
  image?: string | null;
  /** A file's size in bytes and type. */
  size?: number;
  contentType?: string;
};

export type ShownGroup = { id: string; name: string; slug: string; position: FieldPosition; fields: ShownField[] };

/** A word by locale: the language's own, else its base language's, else the main text. */
export function localized(text: string, translations: Record<string, string> | undefined, locale: string): string {
  return translations?.[locale]?.trim() || translations?.[locale.slice(0, 2)]?.trim() || text;
}

const choiceLabel = (def: FieldDef, key: string, locale: string): string => {
  const choice = def.choices?.find((c) => c.key === key);
  return choice ? localized(choice.label, choice.labels, locale) : key;
};

/** A value as the language writes it (`words` says yes and no in it). */
export function displayText(
  def: FieldDef,
  value: FieldValue,
  locale: string,
  words: { yes: string; no: string },
): string {
  switch (def.type) {
    case "number":
      return `${new Intl.NumberFormat(locale).format(value as number)}${def.unit ? ` ${def.unit}` : ""}`;
    case "measurement": {
      const { value: number, unit } = value as FieldMeasurement;
      return `${new Intl.NumberFormat(locale).format(number)} ${unit}`.trim();
    }
    case "boolean":
      return value ? words.yes : words.no;
    case "select":
    case "radio":
    case "buttons":
      return choiceLabel(def, value as string, locale);
    case "checkbox":
      return (value as string[]).map((key) => choiceLabel(def, key, locale)).join(", ");
    case "date":
      return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${value as string}T00:00:00Z`),
      );
    case "datetime": {
      const [day, time] = (value as string).split("T");
      return `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}, ${time.slice(0, 5)}`;
    }
    case "file":
      return (value as FieldFile).name;
    case "link":
      return (value as FieldLink).label;
    case "product":
    case "page":
    case "term":
    case "group":
    case "repeater":
      // Their words come from what they point at or hold: the server looks the first up, the renderer draws the second.
      return "";
    default:
      return valueText(value);
  }
}

/** The fields that have something to show, in order, from sibling `values`: empty and logic-hidden ones left out. */
function shownFields(
  defs: FieldDef[],
  values: Values,
  locale: string,
  words: { yes: string; no: string },
  publicOnly: boolean,
): ShownField[] {
  const fields: ShownField[] = [];
  for (const def of defs) {
    if (publicOnly && def.access !== "public") continue;
    const value = values[def.id];
    if (value === undefined || isEmptyValue(value) || !fieldShows(def, values)) continue;
    const shown: ShownField = {
      id: def.id,
      name: def.name,
      label: localized(def.label, def.labels, locale),
      type: def.type,
      value,
      text: displayText(def, value, locale, words),
    };
    if (def.type === "checkbox") shown.items = (value as string[]).map((key) => choiceLabel(def, key, locale));
    if (def.chat) shown.chat = true;
    if (def.type === "group") {
      // What is inside a group follows the group's own access.
      const children = shownFields(subFieldsOf(def), value as Values, locale, words, false);
      if (children.length === 0) continue;
      shown.children = children;
    }
    if (def.type === "repeater") {
      const rows = asRows(value)
        .map((row) => shownFields(subFieldsOf(def), row, locale, words, false))
        .filter((row) => row.length > 0);
      if (rows.length === 0) continue;
      shown.rows = rows;
    }
    if (def.type === "file") {
      const file = value as FieldFile;
      shown.links = [{ label: file.name, href: file.url, newTab: true, size: file.size, contentType: file.contentType }];
    }
    if (def.type === "link" && (value as FieldLink).kind === "url") {
      const link = value as FieldLink;
      shown.links = [{ label: link.label || link.ref, href: link.ref, ...(link.newTab && { newTab: true }) }];
    }
    fields.push(shown);
  }
  return fields;
}

/**
 * A group's fields that have something to show in a language, in order:
 * hidden by their logic or empty ones left out, and, for the site, those
 * the owner has not made public.
 */
export function shownGroup(
  group: FieldGroup,
  data: FieldData,
  locale: string,
  main: string,
  words: { yes: string; no: string },
  options: { publicOnly: boolean },
): ShownGroup {
  const values = valuesFor(group.fields, data, locale, main);
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    position: group.position,
    fields: shownFields(group.fields, values, locale, words, options.publicOnly),
  };
}

// ---------------------------------------------------------------------------
// What an editor can point at
// ---------------------------------------------------------------------------

/** The store's things a relational field can choose from, for the editor (a store's own, never another's). */
export type FieldLookups = {
  products: { id: string; title: string }[];
  pages: { id: string; title: string; type: "page" | "article" }[];
  terms: { id: string; name: string; kind: "category" | "tag" }[];
};
export const EMPTY_LOOKUPS: FieldLookups = { products: [], pages: [], terms: [] };

/** The most of each kind an editor lists to choose from. */
export const MAX_LOOKUPS = 500;

/** Whether some field in these groups points at the store's products, pages or categories (so an editor must list them). */
export function needsLookups(groups: readonly FieldGroup[]): boolean {
  const points = (def: FieldDef): boolean =>
    def.type === "product" || def.type === "page" || def.type === "term" || def.type === "link" || subFieldsOf(def).some(points);
  return groups.some((group) => group.fields.some(points));
}

/** The types whose value is a plain fact a search engine can read as a product property. */
const PROPERTY_TYPES: readonly FieldType[] = ["text", "number", "measurement", "boolean", "select", "radio", "buttons", "checkbox", "date", "textarea"];

/**
 * The public fields of a product that make a `PropertyValue` in its structured
 * data (D118): what the page already says in plain words, at most 30. Rich text,
 * pictures, files, links and groups are left to the page.
 */
export function structuredProperties(groups: readonly ShownGroup[]): { name: string; value: string }[] {
  return groups
    .flatMap((group) => group.fields)
    .filter((field) => PROPERTY_TYPES.includes(field.type) && field.text.trim() !== "" && field.text.length <= 300)
    .slice(0, 30)
    .map((field) => ({ name: field.label, value: field.text }));
}

/** The chat agent's facts (D81): the fields the owner has let it say, as label and words. */
export function chatDetails(groups: readonly ShownGroup[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const visit = (fields: ShownField[]) => {
    for (const field of fields) {
      if (field.chat && field.text.trim() !== "") out.push({ label: field.label, value: field.text.slice(0, 300) });
      if (field.children) visit(field.children);
    }
  };
  for (const group of groups) visit(group.fields);
  return out.slice(0, 30);
}

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
  multiple: z.boolean().optional(),
  termKinds: z.array(z.enum(["category", "tag"])).min(1).max(2).optional(),
  minRows: z.number().int().min(0).max(MAX_REPEATER_ROWS).optional(),
  maxRows: z.number().int().min(1).max(MAX_REPEATER_ROWS).optional(),
  buttonLabel: text(40).optional(),
  rowLayout: z.enum(["table", "block"]).optional(),
});

const fieldDef = leafField.extend({
  subFields: z.array(leafField).max(MAX_SUB_FIELDS, `Use at most ${MAX_SUB_FIELDS} fields in a group or repeater.`).optional(),
});

const locationRule = z.object({
  param: z.string().min(1).max(20),
  operator: z.enum(["==", "!="]),
  value: text(100).min(1, "Choose what each rule compares with."),
});

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "The web name may use lowercase letters, digits and single hyphens.")
  .max(60);

export const fieldGroupInput = z
  .object({
    id: z.uuid().nullable().default(null),
    name: text(LABEL_MAX).min(1, "Give the group a name."),
    slug,
    entities: z.array(z.enum(FIELD_ENTITY_KEYS)).min(1, "Choose where the group can be used."),
    location: z.array(z.array(locationRule).min(1).max(MAX_RULES)).max(MAX_RULES).default([]),
    fields: z.array(fieldDef).max(MAX_GROUP_FIELDS, `Use at most ${MAX_GROUP_FIELDS} fields in a group.`),
    position: z.enum(["main", "side"]).default("main"),
    active: z.boolean().default(true),
  })
  .superRefine((group, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    group.fields.forEach((field, index) => {
      const at = ["fields", index];
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
        ctx.addIssue({ code: "custom", path: [...at, "filter"], message: `${field.label} cannot be a filter: only choices and yes or no can.` });
      }
      if (field.search && !SEARCH_TYPES.includes(field.type)) {
        ctx.addIssue({ code: "custom", path: [...at, "search"], message: `${field.label} cannot be searched: only texts and choices can.` });
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
    group.fields.forEach((field, index) => {
      const at = ["fields", index];
      if (!isStructural(field.type as FieldType)) {
        if (field.subFields && field.subFields.length > 0) {
          ctx.addIssue({ code: "custom", path: [...at, "subFields"], message: `${field.label} holds no fields of its own.` });
        }
        return;
      }
      const subs = field.subFields ?? [];
      if (subs.length === 0) ctx.addIssue({ code: "custom", path: [...at, "subFields"], message: `Add fields to ${field.label}.` });
      if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
        ctx.addIssue({ code: "custom", path: [...at, "minRows"], message: `${field.label}: the fewest rows is more than the most.` });
      }
      const subNames = new Set<string>();
      subs.forEach((sub, subIndex) => {
        const subAt = [...at, "subFields", subIndex];
        if (isStructural(sub.type)) ctx.addIssue({ code: "custom", path: subAt, message: `${sub.label}: a group or repeater cannot hold another.` });
        if (ids.has(sub.id)) ctx.addIssue({ code: "custom", path: subAt, message: "Two fields share an id." });
        ids.add(sub.id);
        if (subNames.has(sub.name)) ctx.addIssue({ code: "custom", path: [...subAt, "name"], message: `Two fields in ${field.label} are named ${sub.name}.` });
        subNames.add(sub.name);
        if (hasChoices(sub.type) && (sub.choices ?? []).length === 0) ctx.addIssue({ code: "custom", path: [...subAt, "choices"], message: `Add choices to ${sub.label}.` });
        if (sub.type === "measurement" && (sub.units ?? []).length === 0) ctx.addIssue({ code: "custom", path: [...subAt, "units"], message: `Add units to ${sub.label}.` });
        for (const condition of (sub.when ?? []).flat()) {
          const trigger = subs.findIndex((other) => other.id === condition.field);
          if (trigger === -1 || trigger >= subIndex) {
            ctx.addIssue({ code: "custom", path: [...subAt, "when"], message: `${sub.label} can only depend on fields above it in ${field.label}.` });
          }
        }
      });
    });
    // A field is shown by fields before it in the group, never by itself or one after it.
    group.fields.forEach((field, index) => {
      for (const condition of (field.when ?? []).flat()) {
        const trigger = group.fields.findIndex((f) => f.id === condition.field);
        if (trigger === -1 || trigger >= index) {
          ctx.addIssue({
            code: "custom",
            path: ["fields", index, "when"],
            message: `${field.label} can only depend on fields above it.`,
          });
        }
      }
    });
  });

export type FieldGroupInput = z.infer<typeof fieldGroupInput>;

/** A group as the editor holds it, ready to save. */
export const groupToInput = (group: FieldGroup): FieldGroupInput => ({
  id: group.id,
  name: group.name,
  slug: group.slug,
  entities: group.entities,
  location: group.location,
  fields: group.fields,
  position: group.position,
  active: group.active,
});

// ---------------------------------------------------------------------------
// Making things
// ---------------------------------------------------------------------------

const randomHex = (length: number) => {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
};

export const newFieldId = () => `f_${randomHex(12)}`;

/** A slug from a name: lowercase words with hyphens. */
export function slugOf(name: string, fallback = "group"): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/** A field name from a label: lowercase words with underscores, starting with a letter. */
export function nameOf(label: string): string {
  const name = slugOf(label, "field").replace(/-/g, "_");
  return /^[a-z]/.test(name) ? name.slice(0, NAME_MAX) : `f_${name}`.slice(0, NAME_MAX);
}

/** A name not among `taken`: the wanted one, else with a number after it. */
export function uniqueName(wanted: string, taken: readonly string[], join = "_"): string {
  if (!taken.includes(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const next = `${wanted}${join}${n}`;
    if (!taken.includes(next)) return next;
  }
}

export function newField(type: FieldType, taken: readonly string[] = []): FieldDef {
  const label = FIELD_TYPES[type].label;
  const base: FieldDef = {
    id: newFieldId(),
    name: uniqueName(nameOf(label), taken),
    label,
    type,
    access: "private",
    width: 100,
  };
  if (hasChoices(type))
    base.choices = [
      { key: "option-1", label: "Option 1" },
      { key: "option-2", label: "Option 2" },
    ];
  if (type === "measurement") base.units = ["g", "kg"];
  if (isStructural(type)) {
    base.subFields = [{ id: newFieldId(), name: "text", label: "Text", type: "text", access: "private", width: 100 }];
    if (type === "repeater") {
      base.minRows = 0;
      base.buttonLabel = "Add row";
      base.rowLayout = "block";
    }
  }
  if (type === "product" || type === "page" || type === "term") base.multiple = false;
  if (type === "term") base.termKinds = ["category", "tag"];
  return base;
}

export function emptyGroup(entity: FieldEntity = "product"): FieldGroupInput {
  return { id: null, name: "", slug: "", entities: [entity], location: [], fields: [], position: "main", active: true };
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

type PresetField = Omit<FieldDef, "id" | "name" | "access" | "when" | "subFields"> & {
  name?: string;
  access?: FieldAccess;
  subFields?: PresetField[];
};

/** A set of fields to start a group from (owners then change them as they like). */
export const FIELD_PRESETS: readonly {
  key: string;
  name: string;
  description: string;
  entity: FieldEntity;
  fields: PresetField[];
}[] = [
  {
    key: "specifications",
    name: "Specifications",
    description: "Material, dimensions and weight, shown as a table.",
    entity: "product",
    fields: [
      { label: "Material", type: "text", width: 50 },
      { label: "Dimensions", type: "text", width: 50, placeholder: "e.g. 20 × 30 × 5 cm" },
      { label: "Weight", type: "measurement", units: ["g", "kg"], width: 50 },
      { label: "Country of origin", type: "text", width: 50 },
    ],
  },
  {
    key: "size-guide",
    name: "Size guide",
    description: "A size chart and how the product fits.",
    entity: "product",
    fields: [
      {
        label: "Fit",
        type: "buttons",
        choices: [
          { key: "small", label: "Runs small" },
          { key: "true", label: "True to size" },
          { key: "large", label: "Runs large" },
        ],
      },
      { label: "Size chart", type: "image" },
      { label: "Notes", type: "richText" },
    ],
  },
  {
    key: "ingredients",
    name: "Ingredients and allergens",
    description: "What is in it, and what to look out for.",
    entity: "product",
    fields: [
      { label: "Ingredients", type: "textarea" },
      {
        label: "Allergens",
        type: "checkbox",
        choices: [
          { key: "gluten", label: "Gluten" },
          { key: "milk", label: "Milk" },
          { key: "eggs", label: "Eggs" },
          { key: "nuts", label: "Nuts" },
          { key: "peanuts", label: "Peanuts" },
          { key: "soy", label: "Soy" },
          { key: "fish", label: "Fish" },
          { key: "shellfish", label: "Shellfish" },
          { key: "sesame", label: "Sesame" },
        ],
      },
      { label: "Vegan", type: "boolean", width: 50 },
      { label: "Best before", type: "date", width: 50 },
    ],
  },
  {
    key: "materials-care",
    name: "Materials and care",
    description: "What it is made of and how to look after it.",
    entity: "product",
    fields: [
      { label: "Materials", type: "text" },
      { label: "Care instructions", type: "richText" },
      { label: "Machine washable", type: "boolean", width: 50 },
    ],
  },
  {
    key: "warranty",
    name: "Warranty",
    description: "How long it is covered and by whom.",
    entity: "product",
    fields: [
      { label: "Warranty", type: "number", unit: "months", min: 0, width: 50 },
      { label: "Terms", type: "url", width: 50 },
    ],
  },
  {
    key: "designer",
    name: "Designer",
    description: "Who made it, with a picture and a story.",
    entity: "product",
    fields: [
      { label: "Designer", type: "text", width: 50 },
      { label: "Portrait", type: "image", width: 50 },
      { label: "Story", type: "richText" },
    ],
  },
  {
    key: "key-features",
    name: "Key features",
    description: "A list of features, each with a title and a few words.",
    entity: "product",
    fields: [
      {
        label: "Features",
        type: "repeater",
        minRows: 0,
        maxRows: 12,
        buttonLabel: "Add feature",
        rowLayout: "block",
        subFields: [
          { label: "Title", type: "text", width: 50 },
          { label: "Description", type: "textarea", width: 100 },
        ],
      },
    ],
  },
  {
    key: "downloads",
    name: "Downloads",
    description: "Data sheets, manuals and other files to download.",
    entity: "product",
    fields: [
      {
        label: "Downloads",
        type: "repeater",
        minRows: 0,
        maxRows: 10,
        buttonLabel: "Add file",
        rowLayout: "table",
        subFields: [
          { label: "Name", type: "text", width: 50 },
          { label: "File", type: "file", width: 50 },
        ],
      },
    ],
  },
  {
    key: "page-details",
    name: "Page details",
    description: "A subtitle and a highlighted picture for a page or an article.",
    entity: "page",
    fields: [
      { label: "Subtitle", type: "text" },
      { label: "Highlight", type: "image" },
    ],
  },
];

/** A preset made into a group, with fresh ids, ready to edit and save. */
export function groupFromPreset(key: string, taken: readonly string[] = []): FieldGroupInput | null {
  const preset = FIELD_PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  const made = (list: PresetField[]): FieldDef[] => {
    const names: string[] = [];
    return list.map((field): FieldDef => {
      const name = uniqueName(field.name ?? nameOf(field.label), names);
      names.push(name);
      const { subFields, ...rest } = field;
      return { width: 100, ...rest, id: newFieldId(), name, access: field.access ?? "private", ...(subFields && { subFields: made(subFields) }) };
    });
  };
  const fields = made(preset.fields);
  return {
    ...emptyGroup(preset.entity),
    name: preset.name,
    slug: uniqueName(slugOf(preset.name), taken, "-"),
    fields,
  };
}

// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

export const EXPORT_VERSION = 1;

/** Groups as a file the owner can keep or move to another store. */
export const exportGroups = (groups: FieldGroup[]) => ({
  kaizenFieldGroups: EXPORT_VERSION,
  groups: groups.map((group) => ({
    name: group.name,
    slug: group.slug,
    entities: group.entities,
    location: group.location,
    fields: group.fields,
    position: group.position,
    active: group.active,
  })),
});

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
    return { ok: false, problem: "This is not a file of field groups from Kaizen." };
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
    const ids = new Map<string, string>([...fields, ...fields.flatMap(subsOf)].map((f) => [String(f?.id), newFieldId()]));
    const remapField = (f: Record<string, unknown>): Record<string, unknown> => ({
      ...f,
      id: ids.get(String(f?.id)),
      when: Array.isArray(f?.when)
        ? (f.when as Record<string, unknown>[][]).map((all) =>
            all.map((c) => ({ ...c, field: ids.get(String(c?.field)) ?? c?.field })),
          )
        : undefined,
      ...(Array.isArray(f?.subFields) && { subFields: subsOf(f).map(remapField) }),
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
