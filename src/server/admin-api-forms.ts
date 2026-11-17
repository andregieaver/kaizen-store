import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { FORMS_API } from "@/lib/admin-api-forms";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { normaliseEmail } from "@/lib/email-address";
import type { FormRecord } from "@/lib/form-records";

import { cursorAt, fail, ok, pageOf, paging, readBody, record, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { getForm, listForms, saveForm, type FormSummary } from "./forms-admin";
import { makeFormFromTemplate } from "./form-templates";
import { col, typedRows } from "./typed-rows";

/**
 * The Admin API's forms (D705 F5): read through `listForms()` and `getForm()`, made and changed through the editor's own `saveForm()` and
 * `makeFormFromTemplate()`, so a token's form is checked as the owner's is; responses read newest first in pages. Each change audited
 * `integration.api_form_{what}`.
 */

export const FORMS_NAMES = FORMS_API.map((o) => o.name);
type FormsName = (typeof FORMS_API)[number]["name"];
export type FormsRoute = Extract<ApiRoute, { name: FormsName }>;

type ApiForm = AdminAnswer<"forms.get">["data"];

const summaryOut = (s: FormSummary): AdminAnswer<"forms.list">["data"][number] => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  status: s.status,
  questions: s.questions,
  responses: s.responses,
  unread: s.unread,
  last_response_at: s.lastAt,
  updated_at: s.updatedAt,
});

async function formById(storeId: string, id: string): Promise<ApiForm> {
  const [form, summary] = await Promise.all([getForm(storeId, id), listForms(storeId).then((all) => all.find((s) => s.id === id))]);
  if (!form || !summary) return fail("not_found", "No such form in this store.");
  const { id: _id, storeId: _store, status: _status, madeFrom, ...draft } = form satisfies FormRecord;
  return { ...summaryOut(summary), made_from: madeFrom, draft: { ...draft } };
}

const responseRow = z.object({
  id: col.uuid,
  answers: z.array(z.object({ label: z.string(), value: z.string() })),
  contact_email: col.textOrNull,
  path: col.text,
  locale: col.text,
  state: z.enum(["new", "read", "archived"]),
  delivery: z.enum(["sent", "logged", "failed", "inbox"]),
  created_at: col.timestamp,
  cursor_at: col.text,
});

export async function answerForms(caller: ApiCaller, route: FormsRoute, request: Request): Promise<ApiAnswer> {
  const store = caller.member.store;
  const actor = { accountId: caller.member.account.id, storeId: store.id };
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "forms.list":
      return ok(route.name, { data: (await listForms(store.id)).map(summaryOut) });
    case "forms.get":
      return ok(route.name, { data: await formById(store.id, route.id) });
    case "forms.responses": {
      if (!(await getForm(store.id, route.id))) return fail("not_found", "No such form in this store.");
      const page = paging(params, sql`created_at`, sql`id`);
      const rows = await typedRows(
        responseRow,
        sql`
          select id, answers, contact_email, path, locale, state, delivery, created_at, ${cursorAt(sql`created_at`)} as cursor_at
          from commerce.form_responses
          where store_id = ${store.id}::uuid and form_id = ${route.id}::uuid and ${page.where}
          order by created_at desc, id desc limit ${page.limit + 1}
        `,
      );
      return ok(route.name, pageOf(page, rows, ({ cursor_at: _c, ...r }) => r));
    }
    case "forms.create": {
      const input = await readBody(route.name, request);
      const address = store.details.contactEmail ?? caller.member.account.email;
      const recipients = address ? [normaliseEmail(address)] : [];
      const langs = [...new Set(store.markets.map((m) => m.lang))];
      const made = input.template_id
        ? await makeFormFromTemplate(actor, input.template_id, langs[0] ?? "en", langs, recipients)
        : await saveForm(actor, null, input.draft);
      if (!made.ok) return fail(made.problems.includes("This template is gone.") ? "not_found" : "invalid", made.problems.join(" "));
      await record(caller, "form_made", {}, { type: "form", id: made.id });
      return ok(route.name, { data: await formById(store.id, made.id) }, 201);
    }
    case "forms.update": {
      const before = await getForm(store.id, route.id);
      if (!before) return fail("not_found", "No such form in this store.");
      const input = await readBody(route.name, request);
      const saved = await saveForm(actor, route.id, input.draft);
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, "form_changed", {}, { type: "form", id: route.id });
      return ok(route.name, { data: await formById(store.id, route.id) });
    }
  }
}
