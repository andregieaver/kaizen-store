import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormEditor } from "@/components/admin/forms/form-editor";
import { FormTabs } from "@/components/admin/forms/form-tabs";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import type { PageType } from "@/lib/page-content";
import { platformCan, requirePlatform } from "@/server/auth";
import { formUses, getForm } from "@/server/forms-admin";

import { deletePlatformFormAction, savePlatformFormAction, setPlatformFormStatusAction } from "../actions";

export const metadata: Metadata = { title: "Form" };

/** One of Kaizena Flow's forms (D705): what it asks, who it emails and where it shows; its responses a tab away. */
export default async function PlatformFormPage({ params }: PageProps<"/admin/platform/forms/[formId]">) {
  const account = await requirePlatform("website", "read");
  const form = await getForm(null, (await params).formId);
  if (!form) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  const uses = await formUses(null, form.id);
  const base = "/admin/platform/forms";
  return (
    <AdminTextScope texts={adminTexts(lang, ["forms", "blocks"])}>
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
          canEdit={platformCan(account, "website", "write")}
          codes={null}
          placedOn={uses.map((u) => ({ ...u, href: `/admin/platform/${PAGE_TYPE_COPY[u.type as PageType]?.segment ?? "pages"}/${u.pageId}` }))}
          listHref={base}
          save={savePlatformFormAction.bind(null, form.id)}
          setStatus={setPlatformFormStatusAction.bind(null, form.id)}
          remove={deletePlatformFormAction.bind(null, form.id)}
        />
      </div>
    </AdminTextScope>
  );
}
