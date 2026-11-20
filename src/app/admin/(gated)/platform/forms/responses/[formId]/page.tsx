import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormResponses } from "@/components/admin/forms/form-responses";
import { FormTabs } from "@/components/admin/forms/form-tabs";
import { Chip, PageHeader } from "@/components/admin/ui";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { requirePlatform } from "@/server/auth";
import { getForm, listResponses } from "@/server/forms-admin";

import { deletePlatformResponsesAction, setPlatformResponseStateAction } from "../../actions";

export const metadata: Metadata = { title: "Form responses" };

/** What visitors sent with one of Kaizena Flow's forms (D705). */
export default async function PlatformFormResponsesPage({ params, searchParams }: PageProps<"/admin/platform/forms/responses/[formId]">) {
  const account = await requirePlatform("website", "read");
  const form = await getForm(null, (await params).formId);
  if (!form) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = FORMS_WORDS[lang];
  const query = await searchParams;
  const archived = query.archived === "1";
  const page = Math.max(1, Number(query.page) || 1);
  const { responses, more } = await listResponses(null, form.id, { archived, page });
  const here = `/admin/platform/forms/responses/${form.id}`;
  return (
    <AdminTextScope texts={areaTexts(lang, { forms: FORMS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: "/admin/platform/forms", label: w.title }}
          eyebrow={w.kinds[form.kind]}
          status={form.status === "archived" ? <Chip>{w.list.archived}</Chip> : undefined}
          title={form.name}
        />
        <FormTabs formHref={`/admin/platform/forms/${form.id}`} responsesHref={here} current="responses" words={w.tabs} />
        <FormResponses
          responses={responses}
          archived={archived}
          more={more ? `${here}?${archived ? "archived=1&" : ""}page=${page + 1}` : null}
          base={here}
          exportAction={`${here}/export`}
          setState={setPlatformResponseStateAction.bind(null, form.id)}
          remove={deletePlatformResponsesAction.bind(null, form.id)}
          timeZone={PLATFORM_TIME_ZONE}
        />
      </div>
    </AdminTextScope>
  );
}
