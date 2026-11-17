import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormStart } from "@/components/admin/forms/form-start";
import { TemplateManager } from "@/components/admin/forms/form-template-parts";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requirePlatform } from "@/server/auth";
import { listFormTemplates } from "@/server/form-templates";

import { changePlatformTemplateAction, deletePlatformTemplateAction, hideFormTemplateAction, makePlatformFormAction } from "../actions";

export const metadata: Metadata = { title: "New form" };

/**
 * Starting one of Kaizena Flow's forms (D705) from one of its templates (F4): the seven starters and any it saved, which every store is
 * offered too. One step away: hide a template from every store's list, or delete one it saved.
 */
export default async function NewPlatformFormPage() {
  const account = await requirePlatform("website");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  const items = await listFormTemplates({ accountId: account.id, storeId: null }, "en");
  return (
    <AdminTextScope texts={adminTexts(lang, ["forms"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: "/admin/platform/forms", label: w.start.back }} title={w.start.title} description={w.start.description} />
        <FormStart lang={lang} items={items} make={makePlatformFormAction} />
        <TemplateManager items={items} platform mayShare change={changePlatformTemplateAction} remove={deletePlatformTemplateAction} hide={hideFormTemplateAction} />
      </div>
    </AdminTextScope>
  );
}
