import { z } from "zod";

import {
  EMPTY_DATA,
  fieldDefsSchema,
  isEmptyValue,
  newFieldId,
  nameOf,
  readField,
  slugOf,
  uniqueName,
  type FieldAccess,
  type FieldData,
  type FieldDef,
  type FieldEntity,
  type FieldGroup,
  type FieldType,
} from "./custom-fields";
import { RESERVED_STORE_PAGE_SLUGS } from "./page-content";
import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";

/**
 * Content types (wave 6 unit H, D326, `docs/wave-6-catalogue.md` Unit H): an owner's own kinds of entries, each a list of field
 * definitions from the custom fields' `FIELD_TYPES` (D118 to D120), and the entries kept of them. The parts shared by the admin's
 * editors and the server: the limits, the shapes, the input schemas and the pure helpers. An entry's values are a `FieldData` (the
 * values the same in every language and each language's own words), so every function of the custom fields (parsing a change, laying it
 * over what is kept, asking for required fields, drawing it for a shopper) works on it unchanged.
 */

/** The most types an owner (a store, or Kaizena Flow's own site) keeps, and entries of all its types together. */
export const MAX_CONTENT_TYPES = 50;
export const MAX_ENTRIES = 10_000;
export const TYPE_NAME_MAX = 80;
export const TYPE_SLUG_MAX = 60;
export const ENTRY_SLUG_MAX = 120;

/** A type's key: made once and never changed, what fields and grids name a type by, so a copied store needs no remapping. */
export const TYPE_KEY = /^t_[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The field types a type's title, summary and picture may be. */
export const TITLE_TYPES: readonly FieldType[] = ["text"];
export const SUMMARY_TYPES: readonly FieldType[] = ["text", "textarea", "richText"];
export const PICTURE_TYPES: readonly FieldType[] = ["image"];

/** An entry's search texts in one language: the page's title and description for search engines and sharing. */
export type EntrySeo = { title: string; description: string };

/**
 * What an entry holds, as its draft and as published: its values and its search texts in the main language, with the other languages'
 * search texts over them (D55's model, as a page's texts are).
 */
export type EntryContent = { data: FieldData; seo: EntrySeo; seoTranslations: Record<string, EntrySeo> };
export const EMPTY_ENTRY: EntryContent = { data: EMPTY_DATA, seo: { title: "", description: "" }, seoTranslations: {} };

export type ContentType = {
  id: string;
  key: string;
  name: string;
  /** The type's web name: the address part of its entries' pages (H2). */
  slug: string;
  fields: FieldDef[];
  titleField: string;
  summaryField: string | null;
  pictureField: string | null;
  hasPages: boolean;
  /** The page (of type `entry_layout`, H2) its entries are drawn with; null: the standard view. */
  layoutId: string | null;
  position: number;
  /** How many entries it has, and whether one of them has ever been published (its web name is then fixed). */
  entries: number;
  everPublished: boolean;
};

export type Entry = {
  id: string;
  typeId: string;
  slug: string;
  draft: EntryContent;
  published: EntryContent | null;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  position: number;
  updatedAt: string;
};

export type EntryStatus = "draft" | "published" | "changed";

/** Whether an entry is a draft only, published as it is, or published with changes not yet published. */
export function entryStatus(entry: Pick<Entry, "draft" | "published">): EntryStatus {
  if (!entry.published) return "draft";
  return sameContent(entry.draft, entry.published) ? "published" : "changed";
}

/** Two contents hold the same, whatever order their keys were written in. */
export function sameContent(a: EntryContent, b: EntryContent): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The type as a group of fields, which the custom fields' form, checks and drawing take: one group on nothing but its entries. */
export function typeAsGroup(type: Pick<ContentType, "id" | "name" | "slug" | "fields">): FieldGroup {
  return {
    id: type.id,
    name: type.name,
    slug: type.slug,
    entities: [] as FieldEntity[],
    location: [],
    fields: type.fields,
    position: "main",
    active: true,
    sort: 0,
  };
}

/** An entry's title in a language: its title field's words there, else the main language's; empty when it has none. */
export function entryTitle(type: Pick<ContentType, "fields" | "titleField">, data: FieldData, locale: string, main: string): string {
  const def = type.fields.find((field) => field.id === type.titleField);
  if (!def) return "";
  const value = readField(def, data, locale, main);
  return typeof value === "string" && !isEmptyValue(value) ? value.trim() : "";
}

/** An entry's search texts in a language: its own there, else the main language's. */
export function entrySeoIn(content: EntryContent, locale: string, main: string): EntrySeo {
  if (locale === main) return content.seo;
  const own = content.seoTranslations[locale];
  return { title: own?.title || content.seo.title, description: own?.description || content.seo.description };
}

/** A slug made from a title, cut to fit; `entry` when the title gives nothing. */
export const entrySlugOf = (title: string): string => slugOf(title, "entry").slice(0, ENTRY_SLUG_MAX).replace(/-+$/, "") || "entry";

/** A type's web name made from its name, cut to fit; empty when the name gives nothing yet. */
export const typeSlugOf = (name: string): string => slugOf(name, "").slice(0, TYPE_SLUG_MAX).replace(/-+$/, "");

/** A new type's key. */
export function newTypeKey(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `t_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Checking what an editor sends
// ---------------------------------------------------------------------------

const fieldIdSchema = z.string().regex(/^f_[a-z0-9]{6,24}$/, "Choose a field.");

/** Why a type's web name cannot be used, or null. */
export function typeSlugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) return "The web name may use lowercase letters, digits and single hyphens.";
  if (slug.length > TYPE_SLUG_MAX) return `Keep the web name under ${TYPE_SLUG_MAX} characters.`;
  if ((RESERVED_STORE_PAGE_SLUGS as readonly string[]).includes(slug)) return `The web name ${slug} is taken by the site itself: choose another.`;
  return null;
}

export const contentTypeInput = z
  .object({
    id: z.uuid().nullable().default(null),
    name: z.string().trim().min(1, "Give the type a name.").max(TYPE_NAME_MAX, `Keep the name under ${TYPE_NAME_MAX} characters.`),
    slug: z.string().trim(),
    fields: fieldDefsSchema,
    titleField: fieldIdSchema,
    summaryField: fieldIdSchema.nullable().default(null),
    pictureField: fieldIdSchema.nullable().default(null),
    hasPages: z.boolean().default(false),
  })
  .superRefine((type, ctx) => {
    const slugProblem = typeSlugProblem(type.slug);
    if (slugProblem) ctx.addIssue({ code: "custom", path: ["slug"], message: slugProblem });
    if (type.fields.length === 0) ctx.addIssue({ code: "custom", path: ["fields"], message: "Add at least one field: the entries' title." });
    const field = (id: string | null) => (id ? type.fields.find((f) => f.id === id) : undefined);
    const title = field(type.titleField);
    if (!title || !TITLE_TYPES.includes(title.type)) {
      ctx.addIssue({ code: "custom", path: ["titleField"], message: "Choose a text field as the entries' title." });
    }
    if (type.summaryField && !SUMMARY_TYPES.includes(field(type.summaryField)?.type as FieldType)) {
      ctx.addIssue({ code: "custom", path: ["summaryField"], message: "The summary is a text, a text area or a rich text field." });
    }
    if (type.pictureField && !PICTURE_TYPES.includes(field(type.pictureField)?.type as FieldType)) {
      ctx.addIssue({ code: "custom", path: ["pictureField"], message: "The picture is a picture field." });
    }
  });
export type ContentTypeInput = z.infer<typeof contentTypeInput>;

const seoSchema = z.object({
  title: z.string().trim().max(TITLE_MAX, `Keep the search title under ${TITLE_MAX} characters.`).default(""),
  description: z.string().trim().max(DESCRIPTION_MAX, `Keep the search description under ${DESCRIPTION_MAX} characters.`).default(""),
});

/** What the entry editor sends: its address, its search texts, and its fields' changes (`changesFrom()`), checked against the type by the server. */
export const entryInput = z.object({
  id: z.uuid().nullable().default(null),
  typeId: z.uuid("Choose the type of the entry."),
  slug: z
    .string()
    .trim()
    .regex(SLUG, "The address may use lowercase letters, digits and single hyphens.")
    .max(ENTRY_SLUG_MAX, `Keep the address under ${ENTRY_SLUG_MAX} characters.`)
    .refine((slug) => slug !== "ab", "The address ab is taken: choose another."),
  fields: z.unknown(),
  seo: seoSchema.default({ title: "", description: "" }),
  seoTranslations: z.record(z.string().min(2).max(10), seoSchema).default({}),
});
export type EntryInput = z.infer<typeof entryInput>;

/** Why an entry cannot be published as it is: a title in the main language, besides its type's required fields. */
export function publishProblems(type: Pick<ContentType, "fields" | "titleField">, content: EntryContent, main: string): string[] {
  return entryTitle(type, content.data, main, main) === "" ? ["Give the entry a title before publishing it."] : [];
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

type PresetField = {
  key: string;
  type: FieldType;
  /** The field's label in English and Norwegian (D312: the type is made in the owner's admin language). */
  label: { en: string; nb: string };
  access?: FieldAccess;
  required?: boolean;
  width?: FieldDef["width"];
  choices?: { key: string; label: { en: string; nb: string } }[];
};

type Preset = {
  key: string;
  name: { en: string; nb: string };
  slug: string;
  fields: PresetField[];
  title: string;
  summary?: string;
  picture?: string;
  hasPages?: boolean;
};

/** Types to begin from: each a type with its fields made, which the owner changes as they like before saving. */
export const CONTENT_TYPE_PRESETS: readonly Preset[] = [
  {
    key: "team",
    name: { en: "Team members", nb: "Ansatte" },
    slug: "team",
    title: "name",
    summary: "bio",
    picture: "photo",
    fields: [
      { key: "name", type: "text", label: { en: "Name", nb: "Navn" }, access: "public", required: true, width: 50 },
      { key: "role", type: "text", label: { en: "Role", nb: "Rolle" }, access: "public", width: 50 },
      { key: "photo", type: "image", label: { en: "Photo", nb: "Bilde" }, access: "public" },
      { key: "bio", type: "textarea", label: { en: "About", nb: "Om" }, access: "public" },
      { key: "email", type: "email", label: { en: "Email", nb: "E-post" }, width: 50 },
    ],
  },
  {
    key: "faq",
    name: { en: "Questions and answers", nb: "Spørsmål og svar" },
    slug: "faq",
    title: "question",
    summary: "answer",
    fields: [
      { key: "question", type: "text", label: { en: "Question", nb: "Spørsmål" }, access: "public", required: true },
      { key: "answer", type: "richText", label: { en: "Answer", nb: "Svar" }, access: "public", required: true },
    ],
  },
  {
    key: "locations",
    name: { en: "Locations", nb: "Steder" },
    slug: "locations",
    title: "name",
    summary: "description",
    picture: "picture",
    hasPages: true,
    fields: [
      { key: "name", type: "text", label: { en: "Name", nb: "Navn" }, access: "public", required: true },
      { key: "address", type: "textarea", label: { en: "Address", nb: "Adresse" }, access: "public" },
      { key: "opening_hours", type: "textarea", label: { en: "Opening hours", nb: "Åpningstider" }, access: "public" },
      { key: "phone", type: "phone", label: { en: "Phone", nb: "Telefon" }, access: "public", width: 50 },
      { key: "picture", type: "image", label: { en: "Picture", nb: "Bilde" }, access: "public" },
      { key: "description", type: "richText", label: { en: "Description", nb: "Beskrivelse" }, access: "public" },
    ],
  },
  {
    key: "events",
    name: { en: "Events", nb: "Arrangementer" },
    slug: "events",
    title: "title",
    summary: "summary",
    picture: "picture",
    hasPages: true,
    fields: [
      { key: "title", type: "text", label: { en: "Title", nb: "Tittel" }, access: "public", required: true },
      { key: "starts", type: "datetime", label: { en: "Starts", nb: "Starter" }, access: "public", width: 50 },
      { key: "place", type: "text", label: { en: "Place", nb: "Sted" }, access: "public", width: 50 },
      { key: "picture", type: "image", label: { en: "Picture", nb: "Bilde" }, access: "public" },
      { key: "summary", type: "textarea", label: { en: "Summary", nb: "Sammendrag" }, access: "public" },
      { key: "details", type: "richText", label: { en: "Details", nb: "Detaljer" }, access: "public" },
    ],
  },
];

/** A preset as the type editor starts from it, in the admin's language (`en` or `nb`), its web name free among `taken`. */
export function typeFromPreset(key: string, lang: "en" | "nb", taken: readonly string[] = []): ContentTypeInput | null {
  const preset = CONTENT_TYPE_PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  const ids = new Map<string, string>();
  const names: string[] = [];
  const fields = preset.fields.map((field): FieldDef => {
    const id = newFieldId();
    ids.set(field.key, id);
    const name = uniqueName(nameOf(field.label.en), names);
    names.push(name);
    return {
      id,
      name,
      label: field.label[lang],
      type: field.type,
      access: field.access ?? "private",
      width: field.width ?? 100,
      ...(field.required && { required: true }),
      ...(field.choices && { choices: field.choices.map((c) => ({ key: c.key, label: c.label[lang] })) }),
    };
  });
  return {
    id: null,
    name: preset.name[lang],
    slug: uniqueName(preset.slug, taken, "-"),
    fields,
    titleField: ids.get(preset.title)!,
    summaryField: preset.summary ? (ids.get(preset.summary) ?? null) : null,
    pictureField: preset.picture ? (ids.get(preset.picture) ?? null) : null,
    hasPages: preset.hasPages ?? false,
  };
}

/** A new, empty type: one text field for its entries' titles. */
export function emptyType(lang: "en" | "nb", taken: readonly string[] = []): ContentTypeInput {
  const id = newFieldId();
  return {
    id: null,
    name: "",
    slug: uniqueName("entries", taken, "-"),
    fields: [{ id, name: "title", label: lang === "nb" ? "Tittel" : "Title", type: "text", access: "public", required: true, width: 100 }],
    titleField: id,
    summaryField: null,
    pictureField: null,
    hasPages: false,
  };
}

/** A type as its editor holds it, ready to save. */
export const typeToInput = (type: ContentType): ContentTypeInput => ({
  id: type.id,
  name: type.name,
  slug: type.slug,
  fields: type.fields,
  titleField: type.titleField,
  summaryField: type.summaryField,
  pictureField: type.pictureField,
  hasPages: type.hasPages,
});

/** The fields of a type that a definition change took away: their values go from every entry with them. */
export function removedFieldIds(before: readonly FieldDef[], after: readonly FieldDef[]): string[] {
  const kept = new Set(after.map((field) => field.id));
  return before.map((field) => field.id).filter((id) => !kept.has(id));
}

/** Fields whose type changed since they were saved (refused: their values would no longer fit). */
export function retypedFields(before: readonly FieldDef[], after: readonly FieldDef[]): FieldDef[] {
  const was = new Map(before.map((field) => [field.id, field.type]));
  return after.filter((field) => was.has(field.id) && was.get(field.id) !== field.type);
}

/** An entry's content with the values of the given fields taken away, in every language: what a type that lost those fields keeps. */
export function withoutFields(content: EntryContent, ids: readonly string[]): EntryContent {
  if (ids.length === 0) return content;
  const drop = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).filter(([id]) => !ids.includes(id)));
  const translations: FieldData["translations"] = {};
  for (const [locale, values] of Object.entries(content.data.translations)) {
    const kept = drop(values);
    if (Object.keys(kept).length > 0) translations[locale] = kept as FieldData["values"];
  }
  return { ...content, data: { values: drop(content.data.values) as FieldData["values"], translations } };
}

/** An entry's content as kept, read without trusting it: what is missing or of the wrong shape is empty. */
export function readEntryContent(raw: unknown): EntryContent {
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const seoOf = (value: unknown): EntrySeo => ({ title: text(record(value).title), description: text(record(value).description) });
  const content = record(raw);
  const data = record(content.data);
  const translations: FieldData["translations"] = {};
  for (const [locale, values] of Object.entries(record(data.translations))) translations[locale] = record(values) as FieldData["values"];
  const seoTranslations: Record<string, EntrySeo> = {};
  for (const [locale, seo] of Object.entries(record(content.seoTranslations))) seoTranslations[locale] = seoOf(seo);
  return { data: { values: record(data.values) as FieldData["values"], translations }, seo: seoOf(content.seo), seoTranslations };
}

/** What the admin's content actions answer (D326): done, with the id of what was made, or what is wrong in the admin's words. */
export type ContentResult = { ok: true; id?: string } | { ok: false; problems: string[] };
/** A bound server action the content editors call. */
export type ContentAction<A> = (input: A) => Promise<ContentResult>;
/** A bound server action that takes nothing more (deleting what the page is about). */
export type ContentCall = () => Promise<ContentResult>;
