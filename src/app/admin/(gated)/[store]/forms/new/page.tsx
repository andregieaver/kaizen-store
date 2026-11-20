import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormStart } from "@/components/admin/forms/form-start";
import { TemplateManager } from "@/components/admin/forms/form-template-parts";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { FORM_TEMPLATES_WORDS } from "@/lib/admin-words/form-templates";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { listFormTemplates } from "@/server/form-templates";
import { memberCan, requirePermission } from "@/server/permissions";
import { isStoreOwner } from "@/server/templates";

import { changeTemplateAction, deleteTemplateAction, makeFormAction } from "../actions";

export const metadata: Metadata = { title: "New form" };

/** Starting one of the store's forms (D705) from a template (F4): Kaizena Flow's, the owner's own and the marketplace's, in the store's main language. */
export default async function NewFormPage({ params }: PageProps<"/admin/[store]/forms/new">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store, account } = member;
  const lang = adminLangOf(account.adminLocale);
  const w = FORMS_WORDS[lang];
  const siteLang = store.markets[0]?.lang ?? "en";
  const [items, owner] = await Promise.all([listFormTemplates({ accountId: account.id, storeId: store.id }, siteLang), isStoreOwner(account.id, store.id)]);
  const own = items.filter((i) => i.source === "own");
  return (
    <AdminTextScope texts={areaTexts(lang, { forms: FORMS_WORDS, formTemplates: FORM_TEMPLATES_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/forms`, label: w.start.back }} title={w.start.title} description={w.start.description} />
        <FormStart lang={lang} items={items} make={makeFormAction.bind(null, store.slug)} />
        {memberCan(member, "website:write") && (
          <TemplateManager
            items={own}
            mayShare={owner}
            change={changeTemplateAction.bind(null, store.slug)}
            remove={deleteTemplateAction.bind(null, store.slug)}
          />
        )}
      </div>
    </AdminTextScope>
  );
}
