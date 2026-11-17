import type { Metadata } from "next";
import { Plus } from "lucide-react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormsList } from "@/components/admin/forms/forms-list";
import { ButtonLink, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formUses, listForms } from "@/server/forms-admin";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Forms" };

/** The store's forms (D705): contact forms and newsletter sign-ups, placed on pages with the Form component. */
export default async function FormsPage({ params, searchParams }: PageProps<"/admin/[store]/forms">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store, account } = member;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  const { problem } = await searchParams;
  const [forms, uses] = await Promise.all([listForms(store.id), formUses(store.id)]);
  const base = `/admin/${store.slug}/forms`;
  const canEdit = memberCan(member, "website:write");
  return (
    <AdminTextScope texts={adminTexts(lang, ["forms"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.title}
          description={w.description}
          actions={
            canEdit && forms.length > 0 ? (
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
        <FormsList lang={lang} base={base} forms={forms} uses={uses} />
      </div>
    </AdminTextScope>
  );
}
