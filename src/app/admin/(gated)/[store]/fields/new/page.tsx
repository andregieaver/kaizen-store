import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { FieldGroupEditor } from "@/components/admin/field-group-editor";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { emptyGroup, isFieldEntity } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { contentTypeChoices } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";

import { saveFieldGroupAction } from "../actions";
import { editorTerms, roleOptions, storeLanguages } from "../data";
import { featureOn } from "@/lib/store-features";
import { PageHeader } from "@/components/admin/ui";
import { dealsOn } from "@/lib/extensions";
import { areaTexts } from "@/lib/admin-area";
import { FIELDS_WORDS } from "@/lib/admin-words/fields";
import { FIELDS_EDITOR_WORDS } from "@/lib/admin-words/fields-editor";

export const metadata: Metadata = { title: "New group of custom fields" };

export default async function NewFieldGroupPage({ params, searchParams }: PageProps<"/admin/[store]/fields/new">) {
  const { store, account } = await requirePermission((await params).store, "products:read");
  const lang = adminLangOf(account.adminLocale);
  const t = FIELDS_WORDS[lang].list;
  // A link from the store's, a customer's or an order's fields starts a group for that kind of thing.
  const { entity } = await searchParams;
  const start = typeof entity === "string" && isFieldEntity(entity) ? entity : "product";
  const base = `/admin/${store.slug}/fields`;
  return (
    <AdminTextScope texts={areaTexts(lang, { fields: FIELDS_WORDS, fieldsEditor: FIELDS_EDITOR_WORDS })}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: t.title }} title={t.newGroup} />
      <ContentTypeChoices types={await contentTypeChoices(store.id)}>
        <FieldGroupEditor
          initial={emptyGroup(start)}
          terms={await editorTerms(store.id)}
          roles={roleOptions()}
          languages={storeLanguages(store, ADMIN_LANG_FACTS[lang].locale)}
          currencies={moneyCurrencies(store)}
          sellsToBusinesses={featureOn(store, "business")}
          salesOn={dealsOn(store)}
          save={saveFieldGroupAction.bind(null, store.slug)}
          base={base}
        />
      </ContentTypeChoices>
    </div>
    </AdminTextScope>
  );
}
