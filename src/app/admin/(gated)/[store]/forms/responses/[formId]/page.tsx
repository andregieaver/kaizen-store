import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormResponses } from "@/components/admin/forms/form-responses";
import { FormTabs } from "@/components/admin/forms/form-tabs";
import { Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { getForm, listResponses } from "@/server/forms-admin";
import { requirePermission } from "@/server/permissions";

import { deleteResponsesAction, setResponseStateAction } from "./actions";

export const metadata: Metadata = { title: "Form responses" };

/** What visitors sent with one of the store's forms (D705): people's data, read with the right to read customers. */
export default async function FormResponsesPage({ params, searchParams }: PageProps<"/admin/[store]/forms/responses/[formId]">) {
  const { store: slug, formId } = await params;
  const { store, account } = await requirePermission(slug, "customers:read");
  const form = await getForm(store.id, formId);
  if (!form) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = FORMS_WORDS[lang];
  const query = await searchParams;
  const archived = query.archived === "1";
  const page = Math.max(1, Number(query.page) || 1);
  const { responses, more } = await listResponses(store.id, form.id, { archived, page });
  const here = `/admin/${store.slug}/forms/responses/${form.id}`;
  return (
    <AdminTextScope texts={areaTexts(lang, { forms: FORMS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: `/admin/${store.slug}/forms`, label: w.title }}
          eyebrow={w.kinds[form.kind]}
          status={form.status === "archived" ? <Chip>{w.list.archived}</Chip> : undefined}
          title={form.name}
        />
        <FormTabs formHref={`/admin/${store.slug}/forms/${form.id}`} responsesHref={here} current="responses" words={w.tabs} />
        <FormResponses
          responses={responses}
          archived={archived}
          more={more ? `${here}?${archived ? "archived=1&" : ""}page=${page + 1}` : null}
          base={here}
          exportAction={`${here}/export`}
          setState={setResponseStateAction.bind(null, store.slug, form.id)}
          remove={deleteResponsesAction.bind(null, store.slug, form.id)}
          timeZone={store.timeZone}
        />
      </div>
    </AdminTextScope>
  );
}
