import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormEditor } from "@/components/admin/forms/form-editor";
import { FormTabs } from "@/components/admin/forms/form-tabs";
import { SaveAsTemplateCard } from "@/components/admin/forms/form-template-parts";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import type { PageType } from "@/lib/page-content";
import { areaTexts } from "@/lib/admin-area";
import { BLOCKS_FORM_WORDS } from "@/lib/admin-words/blocks-form";
import { FORM_TEMPLATES_WORDS } from "@/lib/admin-words/form-templates";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { platformCan, requirePlatform } from "@/server/auth";
import { formUses, getForm } from "@/server/forms-admin";
import { starterOfForm, templatesOfForm } from "@/server/form-templates";

import {
  adoptPlatformStarterAction,
  deletePlatformFormAction,
  savePlatformFormAction,
  savePlatformTemplateAction,
  setPlatformFormStatusAction,
  updatePlatformTemplateAction,
} from "../actions";

/** The languages Kaizena Flow's templates carry besides English (F4): a platform form's words in them go into a starter. */
const TEMPLATE_LANGUAGES = [
  { code: "nb", name: "Norsk bokmål" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
];

export const metadata: Metadata = { title: "Form" };

/** One of Kaizena Flow's forms (D705): what it asks, who it emails and where it shows; its responses a tab away. */
export default async function PlatformFormPage({ params }: PageProps<"/admin/platform/forms/[formId]">) {
  const account = await requirePlatform("website", "read");
  const form = await getForm(null, (await params).formId);
  if (!form) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = FORMS_WORDS[lang];
  const [uses, linked, starter] = await Promise.all([formUses(null, form.id), templatesOfForm({ accountId: account.id, storeId: null }, form.id, "en"), starterOfForm(form.id, "en")]);
  const base = "/admin/platform/forms";
  return (
    <AdminTextScope texts={areaTexts(lang, { forms: FORMS_WORDS, blocksForm: BLOCKS_FORM_WORDS, formTemplates: FORM_TEMPLATES_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: w.title }}
          eyebrow={w.kinds[form.kind]}
          status={form.status === "archived" ? <Chip>{w.list.archived}</Chip> : undefined}
          title={form.name}
        />
        <FormTabs formHref={`${base}/${form.id}`} responsesHref={`${base}/responses/${form.id}`} current="form" words={w.tabs} />
        <FormEditor
          key={form.id}
          form={form}
          siteLang="en"
          languages={TEMPLATE_LANGUAGES}
          canEdit={platformCan(account, "website", "write")}
          codes={null}
          placedOn={uses.map((u) => ({ ...u, href: `/admin/platform/${PAGE_TYPE_COPY[u.type as PageType]?.segment ?? "pages"}/${u.pageId}` }))}
          templates={
            <SaveAsTemplateCard
              formName={form.name}
              platform
              mayShare
              linked={linked}
              starter={starter}
              saveAs={savePlatformTemplateAction.bind(null, form.id)}
              update={updatePlatformTemplateAction}
              adopt={adoptPlatformStarterAction.bind(null, form.id)}
            />
          }
          listHref={base}
          save={savePlatformFormAction.bind(null, form.id)}
          setStatus={setPlatformFormStatusAction.bind(null, form.id)}
          remove={deletePlatformFormAction.bind(null, form.id)}
        />
      </div>
    </AdminTextScope>
  );
}
