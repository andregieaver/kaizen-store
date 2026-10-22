import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FieldGroupEditor } from "@/components/admin/field-group-editor";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { emptyGroup, isFieldEntity } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { requirePermission } from "@/server/permissions";

import { saveFieldGroupAction } from "../actions";
import { editorTerms, roleOptions, storeLanguages } from "../data";
import { featureOn } from "@/lib/store-features";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New group of custom fields" };

export default async function NewFieldGroupPage({ params, searchParams }: PageProps<"/admin/[store]/fields/new">) {
  const { store, account } = await requirePermission((await params).store, "products:read");
  const lang = adminLangOf(account.adminLocale);
  const t = adminText(lang, "fields").list;
  // A link from the store's, a customer's or an order's fields starts a group for that kind of thing.
  const { entity } = await searchParams;
  const start = typeof entity === "string" && isFieldEntity(entity) ? entity : "product";
  const base = `/admin/${store.slug}/fields`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["fields"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: t.title }} title={t.newGroup} />
      <FieldGroupEditor
        initial={emptyGroup(start)}
        terms={await editorTerms(store.id)}
        roles={roleOptions()}
        languages={storeLanguages(store, ADMIN_LANG_FACTS[lang].locale)}
        currencies={moneyCurrencies(store)}
        sellsToBusinesses={featureOn(store, "business")}
        save={saveFieldGroupAction.bind(null, store.slug)}
        base={base}
      />
    </div>
    </AdminTextScope>
  );
}
