import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { EntityFieldsCard } from "@/components/admin/entity-fields-card";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { BUILDER_TEXT_WORDS } from "@/lib/admin-words/builder-text";
import { FIELDS_WORDS } from "@/lib/admin-words/fields";
import { FIELDS_EDITOR_WORDS } from "@/lib/admin-words/fields-editor";
import { requirePermission } from "@/server/permissions";
import { storeFieldsForEditor } from "@/server/field-entities";
import { ButtonLink, EmptyState, PageHeader } from "@/components/admin/ui";

import { saveStoreFieldsAction } from "../actions";
import { entityFieldsSetup } from "../data";

export const metadata: Metadata = { title: "Store details" };

/**
 * The store's own custom fields (D120): what belongs to the whole site rather
 * than to a product or page (opening hours, a brand story, a contact person, a
 * certificate). Public fields are placed on the site by the page builder's
 * Custom fields component, a product layout, a header or a footer, set to show
 * the store's fields.
 */
export default async function StoreFieldsPage({ params }: PageProps<"/admin/[store]/fields/store">) {
  const { store, account } = await requirePermission((await params).store, "products:read");
  const lang = adminLangOf(account.adminLocale);
  const t = FIELDS_WORDS[lang].list;
  const editor = await storeFieldsForEditor(store.id);
  const base = `/admin/${store.slug}/fields`;

  return (
    <AdminTextScope texts={areaTexts(lang, { fieldsEditor: FIELDS_EDITOR_WORDS, builderText: BUILDER_TEXT_WORDS })}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: t.title }} title={t.storeTitle} description={t.storeDescription} />
      {editor.groups.length === 0 ? (
        <EmptyState
          title={t.storeEmpty}
          action={
            <ButtonLink kind="main" href={`${base}/new?entity=store`}>
              {t.makeStoreGroup}
            </ButtonLink>
          }
        >
          {t.storeEmptyText}
        </EmptyState>
      ) : (
        <EntityFieldsCard
          groups={editor.groups}
          data={editor.data}
          lookups={editor.lookups}
          setup={entityFieldsSetup(store, ADMIN_LANG_FACTS[lang].locale)}
          save={saveStoreFieldsAction.bind(null, store.slug)}
          title={t.storeTitle}
          intro={t.storeIntro}
          idPrefix="store-fields"
        />
      )}
    </div>
    </AdminTextScope>
  );
}
