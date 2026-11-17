import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { templateContentSchema, templateMetaSchema, templateWordsSchema } from "@/lib/form-records-schema";
import { draftFromTemplate, templateContentOf, wordsInLang, FORM_TEMPLATES_MAX, FORM_TEMPLATE_CATEGORIES, type FormTemplateContent, type FormTemplateItem, type TemplateSharing } from "@/lib/form-templates";
import type { FormKind } from "@/lib/form-records";

import { audit, platformCan, type Account } from "./auth";
import { getForm, saveForm, type SaveFormOutcome } from "./forms-admin";
import { log } from "./log";
import { owned } from "./owned";
import { isStoreOwner } from "./templates";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Form templates (D705 F4, `docs/forms.md` 12): the only writer of `commerce.form_templates`. A store sees Kaizena Flow's (the seven
 * starters and any the platform saves), its own, its owner's other stores' shared with `stores`, and the marketplace's; a hidden one is in
 * no list but its own store's. Using one copies it into a new form (`makeFormFromTemplate()`), so a later change of the template never
 * reaches a form. Only a store's owners share a template beyond the store, as D125's.
 */

/** Who looks at templates: the account, and the store (null for Kaizena Flow's own admin). */
export type TemplateViewer = { accountId: string; storeId: string | null };
export type TemplateOutcome<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

const NOT_OWNER = "Only the store's owners can share a template beyond this store.";
const GONE = "This template is gone.";
const problem = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
const isId = (id: string) => z.uuid().safeParse(id).success;

const templateRow = z.object({
  id: col.uuid,
  store_id: col.textOrNull,
  kind: z.enum(["message", "signup"]),
  category: z.enum(FORM_TEMPLATE_CATEGORIES),
  name: z.unknown(),
  description: z.unknown(),
  lang: col.text,
  content: z.unknown(),
  sharing: z.enum(["private", "stores", "marketplace"]),
  starter: col.textOrNull,
  form_id: col.textOrNull,
  hidden: col.bool,
  publisher: col.textOrNull,
  source: z.enum(["kaizen", "own", "stores", "marketplace"]),
  updated_at: col.timestamp,
});
type TemplateRow = z.output<typeof templateRow>;

const owns = (store: ReturnType<typeof sql>, accountId: string) => sql`exists (
  select 1 from commerce.store_members o
  where o.store_id = ${store} and o.account_id = ${accountId}::uuid and o.role = 'owner' and o.disabled_at is null
)`;

/** The templates `viewer` may see, with where each comes from: one query for the list and for a use alike. */
function visible(viewer: TemplateViewer, only?: string) {
  const one = only ? sql`and t.id = ${only}::uuid` : sql``;
  if (viewer.storeId === null) {
    // Kaizena Flow's own admin: its own, hidden ones too, so they can be shown again.
    return sql`
      select t.*, t.hidden_at is not null as hidden, null::text as publisher, 'kaizen' as source
      from commerce.form_templates t where t.store_id is null ${one}`;
  }
  const store = sql`${viewer.storeId}::uuid`;
  const mine = owns(sql`t.store_id`, viewer.accountId);
  return sql`
    select t.*, t.hidden_at is not null as hidden,
      case when t.store_id is null or t.store_id = ${store} then null else s.name end as publisher,
      case when t.store_id is null then 'kaizen' when t.store_id = ${store} then 'own' when ${mine} then 'stores' else 'marketplace' end as source
    from commerce.form_templates t left join commerce.stores s on s.id = t.store_id
    where (t.store_id = ${store}
      or (t.hidden_at is null and (t.store_id is null or t.sharing = 'marketplace'
        or (t.sharing = 'stores' and ${mine} and ${owns(store, viewer.accountId)}))))
      ${one}`;
}

const wordsOf = (value: unknown) => {
  const parsed = templateWordsSchema.safeParse(value);
  return parsed.success ? parsed.data : { text: "", byLocale: {} };
};

function contentOf(row: TemplateRow): FormTemplateContent | null {
  const parsed = templateContentSchema.safeParse(row.content);
  if (!parsed.success) {
    log("warn", "form_templates.unreadable", { templateId: row.id });
    return null;
  }
  return parsed.data as FormTemplateContent;
}

function asItem(row: TemplateRow, lang: string): FormTemplateItem & { hidden: boolean } {
  const content = contentOf(row);
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    name: wordsInLang(wordsOf(row.name), row.lang, lang),
    description: wordsInLang(wordsOf(row.description), row.lang, lang),
    questions: content?.questions.length ?? 0,
    source: row.source,
    publisher: row.publisher,
    sharing: row.sharing,
    starterKey: row.starter,
    formId: row.form_id,
    updatedAt: row.updated_at,
    hidden: row.hidden,
  };
}

/** Kaizena Flow's starters in the order they were written (seeded together, so their times are the same). */
const STARTER_ORDER = sql`array['contact', 'quote', 'booking', 'callback', 'feedback', 'event', 'newsletter']`;

/** Kaizena Flow's first, then the store's own, its other stores' and the marketplace's, each newest first; words in `lang`. */
export async function listFormTemplates(viewer: TemplateViewer, lang: string): Promise<(FormTemplateItem & { hidden: boolean })[]> {
  const rows = await typedRows(
    templateRow,
    sql`select * from (${visible(viewer)}) v
      order by case v.source when 'kaizen' then 0 when 'own' then 1 when 'stores' then 2 else 3 end,
        array_position(${STARTER_ORDER}::text[], v.starter), v.created_at, v.updated_at desc, v.id
      limit 500`,
  );
  return rows.filter((row) => contentOf(row) !== null).map((row) => asItem(row, lang));
}

/**
 * A new form from a template the viewer may see, in the store's languages (`main` first), sending to `recipients`. A hidden template
 * is used only by its own store.
 */
export async function makeFormFromTemplate(
  viewer: TemplateViewer,
  id: string,
  main: string,
  langs: readonly string[],
  recipients: string[],
): Promise<SaveFormOutcome> {
  if (!isId(id)) return problem(GONE);
  const row = await typedRow(templateRow, visible(viewer, id));
  const content = row ? contentOf(row) : null;
  if (!row || !content || (row.hidden && row.source !== "own")) return problem(GONE);
  const draft = draftFromTemplate({ kind: row.kind, name: wordsOf(row.name), lang: row.lang, content }, main, langs, recipients);
  return saveForm(viewer, null, draft, row.starter ? `starter:${row.starter}` : `template:${row.id}`);
}

type TemplateMeta = z.input<typeof templateMetaSchema>;

/** The sharing a viewer may give: Kaizena Flow's are the marketplace's; beyond a store only its owners share. */
async function sharingFor(viewer: TemplateViewer, sharing: TemplateSharing): Promise<TemplateSharing | null> {
  if (viewer.storeId === null) return "marketplace";
  if (sharing === "private") return "private";
  return (await isStoreOwner(viewer.accountId, viewer.storeId)) ? sharing : null;
}

/** Saves one of the viewer's forms as a new template, updated from that form later; its words are in `lang`, the site's main language. */
export async function saveFormAsTemplate(viewer: TemplateViewer, formId: string, raw: TemplateMeta, lang: string): Promise<TemplateOutcome<{ id: string }>> {
  const meta = templateMetaSchema.safeParse(raw);
  if (!meta.success) return { ok: false, problems: [...new Set(meta.error.issues.map((i) => i.message))] };
  const form = isId(formId) ? await getForm(viewer.storeId, formId) : null;
  if (!form) return problem("This form is gone.");
  const sharing = await sharingFor(viewer, meta.data.sharing);
  if (!sharing) return problem(NOT_OWNER);
  const [count] = await db().execute(sql`select count(*)::int as n from commerce.form_templates where ${owned(viewer.storeId)} and starter is null`);
  if (Number(count?.n ?? 0) >= FORM_TEMPLATES_MAX) return problem(`A site keeps at most ${FORM_TEMPLATES_MAX} templates of its own. Delete one you no longer use.`);
  const json = (v: unknown) => JSON.stringify(v);
  const [row] = await db().execute(sql`
    insert into commerce.form_templates (store_id, kind, category, name, description, lang, content, sharing, form_id, created_by, updated_by)
    values (${viewer.storeId}::uuid, ${form.kind}, ${meta.data.category}, ${json({ text: meta.data.name, byLocale: {} })}::jsonb,
      ${json({ text: meta.data.description, byLocale: {} })}::jsonb, ${lang}, ${json(templateContentOf(form))}::jsonb, ${sharing},
      ${form.id}::uuid, ${viewer.accountId}::uuid, ${viewer.accountId}::uuid)
    returning id
  `);
  const id = String(row.id);
  await audit(viewer.accountId, viewer.storeId, `${viewer.storeId ? "store" : "platform"}.form_template_made`, { kind: form.kind, sharing }, { target: { type: "form_template", id } });
  return { ok: true, id };
}

/** Writes a template's questions and words again from the form it was saved from (the viewer's own template only). */
export async function updateTemplateFromForm(viewer: TemplateViewer, id: string): Promise<TemplateOutcome> {
  if (!isId(id)) return problem(GONE);
  const [row] = await db().execute(sql`select form_id from commerce.form_templates where id = ${id}::uuid and ${owned(viewer.storeId)}`);
  if (!row) return problem(GONE);
  const form = row.form_id ? await getForm(viewer.storeId, String(row.form_id)) : null;
  if (!form) return problem("The form this template was saved from is gone.");
  await db().execute(sql`
    update commerce.form_templates set content = ${JSON.stringify(templateContentOf(form))}::jsonb, updated_by = ${viewer.accountId}::uuid
    where id = ${id}::uuid and ${owned(viewer.storeId)}
  `);
  await audit(viewer.accountId, viewer.storeId, `${viewer.storeId ? "store" : "platform"}.form_template_updated`, { questions: form.questions.length }, { target: { type: "form_template", id } });
  return { ok: true };
}

/**
 * Kaizena Flow's starter a platform form was made from (`starter:{key}`), while no template is updated from that form yet: the platform
 * may make the form the starter's from then on (`adoptStarter()`), so editing a starter is editing a form and pressing Update.
 */
export async function starterOfForm(formId: string, lang: string): Promise<{ key: string; name: string } | null> {
  const form = isId(formId) ? await getForm(null, formId) : null;
  const key = form?.madeFrom?.startsWith("starter:") ? form.madeFrom.slice("starter:".length) : null;
  if (!key) return null;
  const row = await typedRow(
    z.object({ name: z.unknown(), lang: col.text, form_id: col.textOrNull }),
    sql`select name, lang, form_id from commerce.form_templates where store_id is null and starter = ${key}`,
  );
  if (!row || row.form_id === formId) return null;
  return { key, name: wordsInLang(wordsOf(row.name), row.lang, lang) };
}

/** Writes Kaizena Flow's starter from the platform form made from it, and ties the starter to that form for later updates. */
export async function adoptStarter(viewer: TemplateViewer, formId: string): Promise<TemplateOutcome> {
  if (viewer.storeId !== null) return problem(GONE);
  const form = isId(formId) ? await getForm(null, formId) : null;
  const key = form?.madeFrom?.startsWith("starter:") ? form.madeFrom.slice("starter:".length) : null;
  if (!form || !key) return problem("This form was not made from one of Kaizena Flow's starters.");
  const done = await db().execute(sql`
    update commerce.form_templates set content = ${JSON.stringify(templateContentOf(form))}::jsonb, form_id = ${form.id}::uuid, updated_by = ${viewer.accountId}::uuid
    where store_id is null and starter = ${key} and kind = ${form.kind} returning id
  `);
  if (done.length === 0) return problem(GONE);
  await audit(viewer.accountId, null, "platform.form_template_updated", { starter: key, questions: form.questions.length }, { target: { type: "form_template", id: String(done[0].id) } });
  return { ok: true };
}

/**
 * Renames, describes, files or shares one of the viewer's own templates. A Kaizena Flow template's name keeps its other languages'
 * words unless the main words change.
 */
export async function changeFormTemplate(viewer: TemplateViewer, id: string, raw: TemplateMeta): Promise<TemplateOutcome> {
  const meta = templateMetaSchema.safeParse(raw);
  if (!meta.success) return { ok: false, problems: [...new Set(meta.error.issues.map((i) => i.message))] };
  if (!isId(id)) return problem(GONE);
  const before = await typedRow(
    z.object({ name: z.unknown(), description: z.unknown(), sharing: z.enum(["private", "stores", "marketplace"]) }),
    sql`select name, description, sharing from commerce.form_templates where id = ${id}::uuid and ${owned(viewer.storeId)} for update`,
  );
  if (!before) return problem(GONE);
  const sharing = meta.data.sharing === before.sharing ? before.sharing : await sharingFor(viewer, meta.data.sharing);
  if (!sharing) return problem(NOT_OWNER);
  const keep = (old: unknown, text: string) => {
    const words = wordsOf(old);
    return JSON.stringify(words.text === text ? words : { text, byLocale: {} });
  };
  await db().execute(sql`
    update commerce.form_templates set name = ${keep(before.name, meta.data.name)}::jsonb, description = ${keep(before.description, meta.data.description)}::jsonb,
      category = ${meta.data.category}, sharing = ${sharing}, updated_by = ${viewer.accountId}::uuid
    where id = ${id}::uuid and ${owned(viewer.storeId)}
  `);
  await audit(viewer.accountId, viewer.storeId, `${viewer.storeId ? "store" : "platform"}.form_template_changed`, { from: before.sharing, to: sharing }, { target: { type: "form_template", id } });
  return { ok: true };
}

/** Deletes one of the viewer's own templates; forms made from it stay as they are. Kaizena Flow's starters are hidden, never deleted. */
export async function deleteFormTemplate(viewer: TemplateViewer, id: string): Promise<TemplateOutcome> {
  if (!isId(id)) return problem(GONE);
  const done = await db().execute(sql`
    delete from commerce.form_templates where id = ${id}::uuid and ${owned(viewer.storeId)} and starter is null returning kind
  `);
  if (done.length === 0) return problem(viewer.storeId === null ? "A starter cannot be deleted. Hide it instead." : GONE);
  await audit(viewer.accountId, viewer.storeId, `${viewer.storeId ? "store" : "platform"}.form_template_deleted`, { kind: String(done[0].kind) }, { target: { type: "form_template", id } });
  return { ok: true };
}

/** The viewer's own templates saved from a form: the form's settings offer to update them. */
export async function templatesOfForm(viewer: TemplateViewer, formId: string, lang: string): Promise<{ id: string; name: string }[]> {
  if (!isId(formId)) return [];
  const rows = await typedRows(
    z.object({ id: col.uuid, name: z.unknown(), lang: col.text }),
    sql`select id, name, lang from commerce.form_templates where ${owned(viewer.storeId)} and form_id = ${formId}::uuid order by created_at`,
  );
  return rows.map((r) => ({ id: r.id, name: wordsInLang(wordsOf(r.name), r.lang, lang) }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Moderation (platform admins)

export type SharedFormTemplate = { id: string; kind: FormKind; name: string; publisher: string; storeSlug: string; sharing: TemplateSharing; hidden: boolean; updatedAt: string };

/** Every store's marketplace template, and any hidden one whatever its sharing is now, newest first. */
export async function listSharedFormTemplates(): Promise<SharedFormTemplate[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      kind: z.enum(["message", "signup"]),
      name: z.unknown(),
      lang: col.text,
      publisher: col.text,
      slug: col.text,
      sharing: z.enum(["private", "stores", "marketplace"]),
      hidden: col.bool,
      updated_at: col.timestamp,
    }),
    sql`
      select t.id, t.kind, t.name, t.lang, s.name as publisher, s.slug, t.sharing, t.hidden_at is not null as hidden, t.updated_at
      from commerce.form_templates t join commerce.stores s on s.id = t.store_id
      where t.sharing = 'marketplace' or t.hidden_at is not null
      order by t.updated_at desc, t.id
      limit 500
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: wordsInLang(wordsOf(r.name), r.lang, "en"),
    publisher: r.publisher,
    storeSlug: r.slug,
    sharing: r.sharing,
    hidden: r.hidden,
    updatedAt: r.updated_at,
  }));
}

/** Hides a template from every list but its own store's, or shows it again: a platform admin, for any store's or Kaizena Flow's own. */
export async function setFormTemplateHidden(account: Account, id: string, hidden: boolean): Promise<TemplateOutcome> {
  if (!platformCan(account, "website")) return problem("Only the platform's admins can hide templates.");
  if (!isId(id)) return problem(GONE);
  const found = await typedRow(z.object({ store_id: col.textOrNull }), sql`select store_id from commerce.form_templates where id = ${id}::uuid`);
  if (!found) return problem(GONE);
  await db().execute(sql`
    update commerce.form_templates
       set hidden_at = ${hidden ? sql`coalesce(hidden_at, now())` : sql`null`}, hidden_by = ${hidden ? sql`coalesce(hidden_by, ${account.id}::uuid)` : sql`null`}
     where id = ${id}::uuid and ${owned(found.store_id)}
  `);
  await audit(account.id, found.store_id, hidden ? "platform.form_template_hidden" : "platform.form_template_shown", {}, { target: { type: "form_template", id } });
  return { ok: true };
}
