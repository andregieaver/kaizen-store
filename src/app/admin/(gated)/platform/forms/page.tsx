import type { Metadata } from "next";
import { Plus } from "lucide-react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormsList } from "@/components/admin/forms/forms-list";
import { ButtonLink, PageHeader } from "@/components/admin/ui";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { platformCan, requirePlatform } from "@/server/auth";
import { formUses, listForms } from "@/server/forms-admin";
import { formReport } from "@/server/form-views";

export const metadata: Metadata = { title: "Forms" };

/** Kaizena Flow's own forms (D705), placed on its pages with the Form component. */
export default async function PlatformFormsPage({ searchParams }: PageProps<"/admin/platform/forms">) {
  const account = await requirePlatform("website", "read");
  const lang = adminLangOf(account.adminLocale);
  const w = FORMS_WORDS[lang];
  const { problem } = await searchParams;
  const [forms, uses, report] = await Promise.all([listForms(null), formUses(null), formReport(null)]);
  const base = "/admin/platform/forms";
  return (
    <AdminTextScope texts={areaTexts(lang, { forms: FORMS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.title}
          description={w.description}
          actions={
            platformCan(account, "website", "write") && forms.length > 0 ? (
              <ButtonLink kind="main" size="header" href={`${base}/new`} icon={<Plus aria-hidden className="size-4" />}>
                {w.newForm}
              </ButtonLink>
            ) : undefined
          }
        />
        {typeof problem === "string" && problem && (
          <p role="alert" className="rounded-panel bg-danger-soft p-3 text-body text-danger-text">
            {problem}
          </p>
        )}
        <FormsList lang={lang} base={base} forms={forms} uses={uses} timeZone={PLATFORM_TIME_ZONE} report={report} />
      </div>
    </AdminTextScope>
  );
}
