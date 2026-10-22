import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { EntityFieldsCard } from "@/components/admin/entity-fields-card";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { storeFieldsForEditor } from "@/server/field-entities";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

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
  const t = adminText(lang, "fields").list;
  const editor = await storeFieldsForEditor(store.id);
  const base = `/admin/${store.slug}/fields`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["fields"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: t.title }} title={t.storeTitle} description={t.storeDescription} />
      {editor.groups.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {t.storeEmptyBefore}{" "}
          <Link href={`${base}/new?entity=store`} className="underline">
            {t.makeOne}
          </Link>{" "}
          {t.storeEmptyAfter}
        </p>
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
