import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { FORMS_MAX, formAsBlock, formTakesAnswers, type BuilderForms, type FormDraft, type FormKind, type FormRecord, type FormStatus } from "@/lib/form-records";
import { publicForm } from "@/lib/forms";
import { formDraftSchema } from "@/lib/form-records-schema";
import { writeCsv } from "@/lib/csv";
import type { FormFile } from "@/lib/form-files";
import { normaliseEmail } from "@/lib/email-address";

import { audit } from "./auth";
import { getDiscount } from "./discounts";
import { log } from "./log";
import { FORM_COLUMNS, asForm, formRow, formsTag } from "./form-site";
import { owned } from "./owned";
import { refreshTag } from "./refresh";
import { col, typedRow, typedRows } from "./typed-rows";

export { formsTag, siteForm } from "./form-site";

/**
 * Forms as their own records (D705, `docs/forms.md`): the only writer of `commerce.forms` and `commerce.form_responses`. A store's forms
 * and Kaizena Flow's (no store) are written by the same functions; the site reads a form through `siteForm()`, cached under the owner's
 * forms tag, which every write here refreshes.
 */

type Owner = string | null;
/** Who changes a form: the account, and the store (null for Kaizena Flow's own). */
export type FormActor = { accountId: string; storeId: Owner };

export async function getForm(owner: Owner, id: string): Promise<FormRecord | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(formRow, sql`select ${FORM_COLUMNS} from commerce.forms where id = ${id}::uuid and ${owned(owner)}`);
  return row ? asForm(row) : null;
}

/** The owner's forms for the page builder (D705), drawn in `lang` without where they send (`publicForm()`). */
export async function builderForms(owner: Owner, lang: string, href: string): Promise<BuilderForms> {
  const rows = await typedRows(formRow, sql`select ${FORM_COLUMNS} from commerce.forms where ${owned(owner)} order by status, name`);
  const list = rows.map(asForm).map((form) => ({
    id: form.id,
    name: form.name,
    kind: form.kind,
    status: form.status,
    takesAnswers: formTakesAnswers(form),
    preview: publicForm(formAsBlock(form, lang)),
  }));
  return { list, href };
}

export type FormSummary = {
  id: string;
  name: string;
  kind: FormKind;
  status: FormStatus;
  recipients: number;
  questions: number;
  responses: number;
  unread: number;
  lastAt: string | null;
  updatedAt: string;
};

/** The owner's forms, newest change first, with their responses counted. */
export async function listForms(owner: Owner): Promise<FormSummary[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      name: col.text,
      kind: z.enum(["message", "signup"]),
      status: z.enum(["active", "archived"]),
      recipients: col.int,
      questions: col.int,
      responses: col.int,
      unread: col.int,
      last_at: col.timestampOrNull,
      updated_at: col.timestamp,
    }),
    sql`
      select f.id, f.name, f.kind, f.status, f.updated_at,
        coalesce(jsonb_array_length(f.delivery -> 'recipients'), 0)::int as recipients,
        jsonb_array_length(f.questions)::int as questions,
        count(r.id)::int as responses,
        (count(r.id) filter (where r.state = 'new'))::int as unread,
        max(r.created_at) as last_at
      from commerce.forms f left join commerce.form_responses r on r.form_id = f.id
      where ${owned(owner, sql`f.store_id`)}
      group by f.id
      order by f.status, f.updated_at desc
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    recipients: r.recipients,
    questions: r.questions,
    responses: r.responses,
    unread: r.unread,
    lastAt: r.last_at,
    updatedAt: r.updated_at,
  }));
}

/** A page that shows a form, as the list and the delete dialog name it. */
export type FormUse = { formId: string; pageId: string; type: string; title: string; published: boolean };

/** Where the owner's forms are placed: a page's draft or its published copy names the form's id (the `form` component's `formId`). */
export async function formUses(owner: Owner, formId?: string): Promise<FormUse[]> {
  const rows = await typedRows(
    z.object({ form_id: col.uuid, id: col.uuid, type: col.text, title: col.text, published: col.bool }),
    sql`
      select f.id as form_id, p.id, p.type, coalesce(p.draft ->> 'title', '') as title,
        coalesce(p.published::text like '%"' || f.id::text || '"%', false) as published
      from commerce.forms f
      join commerce.pages p on ${owned(owner, sql`p.store_id`)}
        and (p.draft::text like '%"' || f.id::text || '"%' or p.published::text like '%"' || f.id::text || '"%')
      where ${owned(owner, sql`f.store_id`)} ${formId ? sql`and f.id = ${formId}::uuid` : sql``}
      order by p.type, title
    `,
  );
  return rows.map((r) => ({ formId: r.form_id, pageId: r.id, type: r.type, title: r.title, published: r.published }));
}

/** Whether a published page of the owner carries the form, at any depth: only a form the site shows takes answers (D93). */
export async function formIsPublished(owner: Owner, formId: string): Promise<boolean> {
  const [row] = await db().execute(sql`
    select 1 from commerce.pages
    where ${owned(owner)} and published is not null
      and jsonb_path_exists(published, 'strict $.**.formId ? (@ == $id)', jsonb_build_object('id', ${formId}::text))
    limit 1
  `);
  return Boolean(row);
}

export type SaveFormOutcome = { ok: true; id: string } | { ok: false; problems: string[] };

/** The sign-up's own checks against the owner: a discount of the store's own with codes to give (D304 J3); Kaizena Flow's forms give none. */
async function signupProblems(owner: Owner, draft: FormDraft): Promise<string[]> {
  if (!draft.signup) return [];
  if (owner === null && (draft.signup.incentive || draft.signup.tags?.length)) return ["Kaizena Flow's own sign-ups give no codes or tags."];
  if (owner && draft.signup.incentive) {
    const discount = await getDiscount(owner, draft.signup.incentive);
    if (!discount || !discount.uniqueCodes) return ["Choose a discount with single-use codes."];
  }
  return [];
}

/**
 * Saves a form (a new one without an id), checked against `formDraftSchema`. A form keeps its kind: a change of kind is refused. `madeFrom`
 * says which starter a new one came from.
 */
export async function saveForm(actor: FormActor, id: string | null, raw: unknown, madeFrom: string | null = null): Promise<SaveFormOutcome> {
  const parsed = formDraftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const draft = parsed.data as FormDraft;
  const owner = actor.storeId;
  const problems = await signupProblems(owner, draft);
  if (problems.length > 0) return { ok: false, problems };
  const json = (v: unknown) => JSON.stringify(v);
  const signup = draft.signup ? json(draft.signup) : null;
  let saved: string;
  if (id) {
    const before = await getForm(owner, id);
    if (!before) return { ok: false, problems: ["This form is gone."] };
    if (before.kind !== draft.kind) return { ok: false, problems: ["A form keeps its kind. Make a new form instead."] };
    await db().execute(sql`
      update commerce.forms set name = ${draft.name}, questions = ${json(draft.questions)}::jsonb, words = ${json(draft.words)}::jsonb,
        delivery = ${json(draft.delivery)}::jsonb, signup = ${signup}::jsonb, keep_months = ${draft.keepMonths}, updated_by = ${actor.accountId}::uuid
      where id = ${id}::uuid and ${owned(owner)}
    `);
    saved = id;
  } else {
    const [count] = await db().execute(sql`select count(*)::int as n from commerce.forms where ${owned(owner)}`);
    if (Number(count?.n ?? 0) >= FORMS_MAX) return { ok: false, problems: [`A site has at most ${FORMS_MAX} forms. Delete one you no longer use.`] };
    const [row] = await db().execute(sql`
      insert into commerce.forms (store_id, kind, name, questions, words, delivery, signup, keep_months, made_from, created_by, updated_by)
      values (${owner}::uuid, ${draft.kind}, ${draft.name}, ${json(draft.questions)}::jsonb, ${json(draft.words)}::jsonb, ${json(draft.delivery)}::jsonb,
        ${signup}::jsonb, ${draft.keepMonths}, ${madeFrom}, ${actor.accountId}::uuid, ${actor.accountId}::uuid)
      returning id
    `);
    saved = String(row.id);
  }
  await audit(actor.accountId, owner, `${owner ? "store" : "platform"}.form_${id ? "changed" : "made"}`, {
    kind: draft.kind,
    questions: draft.questions.length,
    recipients: draft.delivery.recipients.length,
    keepMonths: draft.keepMonths,
    ...(madeFrom && { madeFrom }),
  }, { target: { type: "form", id: saved } });
  refreshTag(formsTag(owner));
  return { ok: true, id: saved };
}

/** Archives a form (it shows nothing and takes nothing) or brings it back. */
export async function setFormStatus(actor: FormActor, id: string, status: FormStatus): Promise<boolean> {
  const done = await db().execute(sql`
    update commerce.forms set status = ${status}, updated_by = ${actor.accountId}::uuid
    where id = ${id}::uuid and ${owned(actor.storeId)} and status <> ${status} returning id
  `);
  if (done.length === 0) return false;
  await audit(actor.accountId, actor.storeId, `${actor.storeId ? "store" : "platform"}.form_${status === "archived" ? "archived" : "restored"}`, {}, { target: { type: "form", id } });
  refreshTag(formsTag(actor.storeId));
  return true;
}

export type DeleteFormOutcome = { ok: true; responses: number } | { ok: false; uses: FormUse[] } | { ok: false; gone: true };

/** Deletes a form and its responses, unless a page (its draft or published copy) still places it: then it can only be archived. */
export async function deleteForm(actor: FormActor, id: string): Promise<DeleteFormOutcome> {
  const uses = await formUses(actor.storeId, id);
  if (uses.length > 0) return { ok: false, uses };
  const [row] = await db().execute(sql`
    with gone as (delete from commerce.forms where id = ${id}::uuid and ${owned(actor.storeId)} returning id, kind)
    select gone.kind, (select count(*)::int from commerce.form_responses r where r.form_id = gone.id) as responses from gone
  `);
  if (!row) return { ok: false, gone: true };
  const responses = Number(row.responses ?? 0);
  await audit(actor.accountId, actor.storeId, `${actor.storeId ? "store" : "platform"}.form_deleted`, { kind: String(row.kind), responses }, { target: { type: "form", id } });
  refreshTag(formsTag(actor.storeId));
  return { ok: true, responses };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Responses

export type FormAnswer = { label: string; value: string };
export type FormResponseRow = {
  id: string;
  answers: FormAnswer[];
  contactEmail: string | null;
  path: string;
  locale: string;
  state: "new" | "read" | "archived";
  delivery: "sent" | "logged" | "failed" | "inbox";
  createdAt: string;
  /** Files sent with it (D738 F6b): downloaded by question through the admin, never by their stored path. */
  files: { question: string; name: string; bytes: number }[];
};

const responseRow = z.object({
  id: col.uuid,
  answers: z.array(z.object({ label: z.string(), value: z.string() })).catch([]),
  contact_email: col.textOrNull,
  path: col.text,
  locale: col.text,
  state: z.enum(["new", "read", "archived"]),
  delivery: z.enum(["sent", "logged", "failed", "inbox"]),
  created_at: col.timestamp,
  files: z.array(z.object({ question: z.string(), name: z.string(), bytes: z.number() })).default([]).catch([]),
});
const asResponse = (r: z.output<typeof responseRow>): FormResponseRow => ({
  id: r.id,
  answers: r.answers,
  contactEmail: r.contact_email,
  path: r.path,
  locale: r.locale,
  state: r.state,
  delivery: r.delivery,
  createdAt: r.created_at,
  files: r.files.map((f) => ({ question: f.question, name: f.name, bytes: f.bytes })),
});

export const RESPONSES_PAGE = 50;

/** Response ids as a list of parameters; one that is not an id is left out. */
const idList = (ids: string[]) => sql.join(ids.filter((id) => z.uuid().safeParse(id).success).map((id) => sql`${id}::uuid`), sql`, `);

/** A form's responses, newest first; `archived` shows the archived ones, otherwise the others. */
export async function listResponses(owner: Owner, formId: string, { archived = false, page = 1 }: { archived?: boolean; page?: number } = {}) {
  const offset = (Math.max(1, page) - 1) * RESPONSES_PAGE;
  const rows = await typedRows(
    responseRow,
    sql`
      select id, answers, contact_email, path, locale, state, delivery, created_at, files from commerce.form_responses
      where ${owned(owner)} and form_id = ${formId}::uuid and ${archived ? sql`state = 'archived'` : sql`state <> 'archived'`}
      order by created_at desc, id limit ${RESPONSES_PAGE + 1} offset ${offset}
    `,
  );
  return { responses: rows.slice(0, RESPONSES_PAGE).map(asResponse), more: rows.length > RESPONSES_PAGE };
}

/** Marks responses read, archived or new again. */
export async function setResponseState(actor: FormActor, formId: string, ids: string[], state: FormResponseRow["state"]): Promise<number> {
  if (!ids.some((id) => z.uuid().safeParse(id).success)) return 0;
  const done = await db().execute(sql`
    update commerce.form_responses set state = ${state}
    where ${owned(actor.storeId)} and form_id = ${formId}::uuid and id in (${idList(ids)}) and state <> ${state} returning id
  `);
  if (done.length > 0 && state !== "read") {
    await audit(actor.accountId, actor.storeId, `${actor.storeId ? "store" : "platform"}.form_responses_${state}`, { count: done.length }, { target: { type: "form", id: formId } });
  }
  return done.length;
}

/** Deletes responses for good. */
export async function deleteResponses(actor: FormActor, formId: string, ids: string[]): Promise<number> {
  if (!ids.some((id) => z.uuid().safeParse(id).success)) return 0;
  const done = await db().execute(sql`
    delete from commerce.form_responses where ${owned(actor.storeId)} and form_id = ${formId}::uuid and id in (${idList(ids)}) returning id
  `);
  if (done.length > 0) {
    await audit(actor.accountId, actor.storeId, `${actor.storeId ? "store" : "platform"}.form_responses_deleted`, { count: done.length }, { target: { type: "form", id: formId } });
  }
  return done.length;
}

/**
 * Every response of a form as CSV: one column per question as the answers were labelled (in the order first seen), with the time, the
 * page and the language. Audited with its count only (as D295's export).
 */
export async function exportResponses(actor: FormActor, formId: string, timeZone: string): Promise<{ name: string; csv: string } | null> {
  const form = await getForm(actor.storeId, formId);
  if (!form) return null;
  const rows = (
    await typedRows(
      responseRow,
      sql`select id, answers, contact_email, path, locale, state, delivery, created_at from commerce.form_responses
          where ${owned(actor.storeId)} and form_id = ${formId}::uuid order by created_at, id`,
    )
  ).map(asResponse);
  const labels: string[] = [];
  for (const r of rows) for (const a of r.answers) if (!labels.includes(a.label)) labels.push(a.label);
  const when = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium", timeZone });
  const csv = writeCsv([
    ["sent_at", ...labels, "page", "language", "state"],
    ...rows.map((r) => [when.format(new Date(r.createdAt)), ...labels.map((l) => r.answers.find((a) => a.label === l)?.value ?? ""), r.path, r.locale, r.state]),
  ]);
  await audit(actor.accountId, actor.storeId, `${actor.storeId ? "store" : "platform"}.form_responses_exported`, { count: rows.length }, { target: { type: "form", id: formId } });
  const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "form";
  return { name: `${slug}-responses.csv`, csv };
}

/** Keeps what a visitor sent with a form (called by `submitForm()` and the sign-up's confirmation). Never fails the send: a problem is logged. */
export async function keepResponse(input: {
  formId: string;
  answers: FormAnswer[];
  contactEmail: string | null;
  path: string;
  locale: string;
  delivery: FormResponseRow["delivery"];
  /** The response's id when its files were stored under it first (D738 F6b), and those files. */
  id?: string;
  files?: FormFile[];
}): Promise<void> {
  try {
    await db().execute(sql`
      insert into commerce.form_responses (id, form_id, answers, contact_email, path, locale, delivery, files)
      values (${input.id ?? randomUUID()}::uuid, ${input.formId}::uuid, ${JSON.stringify(input.answers.slice(0, 40))}::jsonb, ${input.contactEmail ? normaliseEmail(input.contactEmail).slice(0, 254) : null},
        ${input.path.slice(0, 500)}, ${input.locale}, ${input.delivery}, ${JSON.stringify(input.files ?? [])}::jsonb)
    `);
  } catch (error) {
    log("error", "forms.response_keep_failed", { formId: input.formId }, error);
  }
}

/**
 * Deletes responses older than their form's months, never older than the retention rule's (`form_responses`), form by form with its store
 * named, at most `batch` forms a run (the daily `runRetention()`).
 */
export async function pruneFormResponses(now: Date, ruleMonths: number, batch: number): Promise<number> {
  const at = now.toISOString();
  const due = await typedRows(
    z.object({ id: col.uuid, store_id: col.textOrNull, keep: col.int }),
    sql`
      select f.id, f.store_id, least(f.keep_months, ${ruleMonths})::int as keep from commerce.forms f
      where exists (
        select 1 from commerce.form_responses r
        where r.form_id = f.id and r.created_at < ${at}::timestamptz - make_interval(months => least(f.keep_months, ${ruleMonths})))
      limit ${batch}
    `,
  );
  let count = 0;
  for (const form of due) {
    const rows = await db().execute(sql`
      delete from commerce.form_responses
      where ${owned(form.store_id)} and form_id = ${form.id}::uuid and created_at < ${at}::timestamptz - make_interval(months => ${form.keep})
      returning 1
    `);
    count += rows.length;
  }
  return count;
}
