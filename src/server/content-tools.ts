import "server-only";

import {
  contentTypeInput,
  entrySlugOf,
  entryStatus,
  entryTitle,
  typeSlugOf,
  typeToInput,
  TITLE_TYPES,
  SUMMARY_TYPES,
  contentTag,
  type ContentType,
} from "@/lib/content-types";
import { contentApprovalSummary } from "@/lib/content-tools";
import { findClaims } from "@/lib/claims";
import { isTranslatable, readField, uniqueName, type FieldDef } from "@/lib/custom-fields";
import { buildFieldGroup, fieldValueText, groupTexts, prepareValues, wordsIn, type NewFieldSpec } from "@/lib/field-tools";
import { moneyCurrencies } from "@/lib/field-money";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { redirectsTag } from "@/lib/redirects";

import type { Account } from "./auth";
import { entryPublishProblems, getEntry, listEntries, publishEntry, saveEntry, unpublishEntry, type EntryContext } from "./content-entries";
import { listContentTypes, saveContentType } from "./content-types";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's content tools (wave 6 unit H3, D326, area `website`): `list_content_types`, `list_entries` and `get_entry` read the
 * store's types and entries; `save_entry` writes a draft through `saveEntry()` (no shopper sees a draft, so it is ungated); `publish_entry`,
 * `unpublish_entry` and `save_content_type` change what the site shows and wait for the owner's yes (gate `public`), each checked first by
 * `preflightContentTool()` so the owner is never asked to approve what cannot be done. Values are written as `set_fields` writes them
 * (`prepareValues()`), text in the main language through the claims filter.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainOf = (store: Store) => store.localization.locales[0];
const adminLink = (store: Store, path = "") => `/admin/${store.slug}/content${path}`;
const entryContext = ({ account, store }: Ctx): EntryContext => ({
  accountId: account.id,
  owner: store.id,
  locales: store.localization.locales,
  main: mainOf(store),
  currencies: moneyCurrencies(store),
});

function refresh(ctx: Ctx): void {
  ctx.invalidate(contentTag(ctx.store.id));
  ctx.invalidate(redirectsTag(ctx.store.id));
}

function claimsFail(texts: string[]): void {
  const claims = [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];
  if (claims.length > 0) fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
}

/** One of the store's types by its web name or key; says what to use when it is not one. */
async function typeOf(store: Store, said: string): Promise<ContentType> {
  const types = await listContentTypes(store.id);
  const found = types.find((type) => type.slug === said.trim() || type.key === said.trim());
  return found ?? fail(`The store has no content type "${said}". Its types: ${types.map((t) => t.slug).join(", ") || "none"} (list_content_types).`);
}

const fieldLine = (type: ContentType) => (def: FieldDef) => ({
  name: def.name,
  label: def.label,
  type: def.type,
  required: def.required === true,
  shown_on_site: def.access === "public",
  ...(def.id === type.titleField && { title: true }),
});

export async function listContentTypesTool({ store }: Ctx) {
  const types = await listContentTypes(store.id);
  return {
    types: types.map((type) => ({
      key: type.key,
      name: type.name,
      web_name: type.slug,
      has_pages: type.hasPages,
      entries: type.entries,
      fields: type.fields.map(fieldLine(type)),
    })),
    note: types.length === 0 ? "The store has no content types yet: save_content_type makes one." : undefined,
    admin: adminLink(store),
  };
}

export async function listEntriesTool({ store }: Ctx, input: OwnerToolInput<"list_entries">) {
  const type = await typeOf(store, input.type);
  const main = mainOf(store);
  const words = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const entries = (await listEntries(store.id, type.id))
    .map((entry) => ({ entry, title: entryTitle(type, entry.draft.data, main, main) || entry.slug }))
    .filter(({ title }) => words.every((word) => title.toLowerCase().includes(word)));
  return {
    type: type.name,
    total: entries.length,
    entries: entries.slice(0, input.limit).map(({ entry, title }) => ({
      id: entry.id,
      title,
      status: entryStatus(entry),
      address: type.hasPages ? `/${type.slug}/${entry.slug}` : null,
    })),
    admin: adminLink(store, `/${type.id}`),
  };
}

/** One of the store's entries with its type; says so when it is not one. */
async function entryWithType(store: Store, id: string) {
  const entry = await getEntry(store.id, id);
  const type = entry ? (await listContentTypes(store.id)).find((t) => t.id === entry.typeId) : undefined;
  if (!entry || !type) return fail("The store has no such entry: read its id from list_entries.");
  return { entry, type };
}

export async function getEntryTool({ store }: Ctx, input: OwnerToolInput<"get_entry">) {
  const { entry, type } = await entryWithType(store, input.entry);
  const main = mainOf(store);
  const words = { yes: "yes", no: "no" };
  return {
    title: entryTitle(type, entry.draft.data, main, main) || entry.slug,
    type: type.name,
    status: entryStatus(entry),
    address: type.hasPages ? `/${type.slug}/${entry.slug}` : null,
    fields: type.fields.map((def) => {
      const value = readField(def, entry.draft.data, main, main);
      return { name: def.name, label: def.label, value: value === undefined ? null : fieldValueText(def, value, main, words) };
    }),
    search_title: entry.draft.seo.title || null,
    search_description: entry.draft.seo.description || null,
    admin: adminLink(store, `/${type.id}/${entry.id}`),
  };
}

export async function saveEntryTool(ctx: Ctx, input: OwnerToolInput<"save_entry">) {
  const { store } = ctx;
  const type = await typeOf(store, input.type);
  const existing = input.entry ? await getEntry(store.id, input.entry) : null;
  if (input.entry && (!existing || existing.typeId !== type.id)) return fail("The type has no such entry: read its id from list_entries.");
  const prepared = prepareValues(
    input.values,
    type.fields.map((def) => ({ group: { name: type.name, slug: type.slug }, def })),
    `the entry's editor (${adminLink(store, `/${type.id}`)})`,
  );
  if (!prepared.ok) return fail(prepared.problems.join(" "));
  claimsFail([...wordsIn(prepared.prepared), input.seo_title ?? "", input.seo_description ?? ""]);
  const main = mainOf(store);
  // Text is per language: it is written in the main one; the rest are the same in every language.
  const raw = { values: {} as Record<string, unknown>, translations: { [main]: {} as Record<string, unknown> } };
  for (const { candidate, value } of prepared.prepared) (isTranslatable(candidate.def.type) ? raw.translations[main] : raw.values)[candidate.def.id] = value;
  const titleGiven = prepared.prepared.find((p) => p.candidate.def.id === type.titleField)?.value;
  const draft = existing?.draft;
  const saved = await saveEntry(entryContext(ctx), {
    id: existing?.id ?? null,
    typeId: type.id,
    slug: existing?.slug ?? (input.address || entrySlugOf(typeof titleGiven === "string" ? titleGiven : type.name)),
    fields: raw,
    seo: { title: input.seo_title ?? draft?.seo.title ?? "", description: input.seo_description ?? draft?.seo.description ?? "" },
    seoTranslations: draft?.seoTranslations ?? {},
  });
  if (!saved.ok) return fail(saved.problems.join(" "));
  refresh(ctx);
  return {
    done: `${existing ? "Saved the changes to" : "Made"} the entry's draft. Shoppers see it only once it is published (publish_entry).`,
    id: saved.id,
    admin: adminLink(store, `/${type.id}/${saved.id}`),
  };
}

export async function publishEntryTool(ctx: Ctx, input: OwnerToolInput<"publish_entry">) {
  const result = await publishEntry(entryContext(ctx), input.entry);
  if (!result.ok) return fail(result.problems.join(" "));
  refresh(ctx);
  return { done: "Published the entry: the site shows it as its draft was." };
}

export async function unpublishEntryTool(ctx: Ctx, input: OwnerToolInput<"unpublish_entry">) {
  const result = await unpublishEntry({ accountId: ctx.account.id, owner: ctx.store.id }, input.entry);
  if (!result.ok) return fail(result.problems.join(" "));
  refresh(ctx);
  return { done: "Took the entry off the site; its draft is kept." };
}

/**
 * The type a `save_content_type` call would save, as `saveContentType()` takes it: a new type's fields made with the field library's own
 * helpers (public unless said), its first text field its title; an existing type's fields kept and the new labels added. Every problem in
 * words.
 */
async function plannedType({ store }: Ctx, input: OwnerToolInput<"save_content_type">) {
  claimsFail(groupTexts({ name: input.name, entity: "page", fields: input.fields as NewFieldSpec[] }));
  const existing = input.type ? await typeOf(store, input.type) : null;
  const known = new Set((existing?.fields ?? []).map((f) => f.label.trim().toLowerCase()));
  const wanted = input.fields.filter((f) => !known.has(f.label.trim().toLowerCase()));
  const built = wanted.length > 0 ? buildFieldGroup({ name: input.name, entity: "page", fields: wanted as NewFieldSpec[] }, []) : null;
  if (built && !built.ok) return fail(built.problem);
  const names = (existing?.fields ?? []).map((f) => f.name);
  const added = (built?.group.fields ?? []).map((field) => {
    const name = uniqueName(field.name, names);
    names.push(name);
    return { ...field, name };
  });
  if (existing) {
    const next = { ...typeToInput(existing), name: input.name, slug: input.web_name || existing.slug, hasPages: input.has_pages ?? existing.hasPages, fields: [...existing.fields, ...added] };
    return { existing, next };
  }
  const title = added.find((f) => TITLE_TYPES.includes(f.type));
  if (!title) return fail("Give the type a text field for its title, such as Name.");
  const summary = added.find((f) => f !== title && SUMMARY_TYPES.includes(f.type));
  const next = {
    id: null,
    name: input.name,
    slug: input.web_name || typeSlugOf(input.name),
    fields: added,
    titleField: title.id,
    summaryField: summary?.id ?? null,
    pictureField: null,
    hasPages: input.has_pages ?? true,
  };
  return { existing: null, next };
}

export async function saveContentTypeTool(ctx: Ctx, input: OwnerToolInput<"save_content_type">) {
  const { existing, next } = await plannedType(ctx, input);
  const saved = await saveContentType({ accountId: ctx.account.id, owner: ctx.store.id }, next);
  if (!saved.ok) return fail(saved.problems.join(" "));
  refresh(ctx);
  return {
    done: existing ? `Changed the content type "${input.name}".` : `Made the content type "${input.name}". Add entries with save_entry.`,
    key: (await listContentTypes(ctx.store.id)).find((t) => t.id === saved.id)?.key,
    admin: adminLink(ctx.store, saved.id ? `/${saved.id}` : ""),
  };
}

/** Checks a gated content tool before it is kept for a yes: an entry that could not be published, or a type that could not be saved, is refused now. */
export async function preflightContentTool(ctx: Ctx, name: string, raw: Record<string, unknown>): Promise<void> {
  if (name === "publish_entry") {
    const { entry, type } = await entryWithType(ctx.store, String(raw.entry ?? ""));
    const problems = entryPublishProblems(type, entry.draft, mainOf(ctx.store));
    if (problems.length > 0) fail(`It cannot be published yet: ${problems.join(" ")} Fill it in with save_entry first.`);
    if (entryStatus(entry) === "published") fail("It is published already, as its draft is.");
    return;
  }
  if (name === "unpublish_entry") {
    const { entry } = await entryWithType(ctx.store, String(raw.entry ?? ""));
    if (!entry.published) fail("It is not on the site: it is a draft.");
    return;
  }
  if (name === "save_content_type") {
    const { existing, next } = await plannedType(ctx, raw as OwnerToolInput<"save_content_type">);
    const parsed = contentTypeInput.safeParse(next);
    if (!parsed.success) fail([...new Set(parsed.error.issues.map((issue) => issue.message))].join(" "));
    if (existing?.everPublished && next.slug !== existing.slug) fail("The type's web name is fixed: one of its entries has been published.");
  }
}

/** What a kept content change will do, with the entry's or type's own name (D326). */
export async function contentApprovalWords(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "publish_entry" || name === "unpublish_entry") {
    const entry = await getEntry(ctx.store.id, String(args.entry ?? ""));
    const type = entry ? (await listContentTypes(ctx.store.id)).find((t) => t.id === entry.typeId) : undefined;
    const main = mainOf(ctx.store);
    const title = entry && type ? entryTitle(type, entry.draft.data, main, main) || entry.slug : undefined;
    return contentApprovalSummary(name, args, title);
  }
  if (name === "save_content_type" && args.type) {
    const type = (await listContentTypes(ctx.store.id)).find((t) => t.slug === String(args.type) || t.key === String(args.type));
    return contentApprovalSummary(name, args, type?.name);
  }
  return contentApprovalSummary(name, args);
}
