import type { Metadata } from "next";
import Link from "next/link";

import { EntityFieldsCard } from "@/components/admin/entity-fields-card";
import { requireMember } from "@/server/auth";
import { storeFieldsForEditor } from "@/server/field-entities";

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
  const { store } = await requireMember((await params).store);
  const editor = await storeFieldsForEditor(store.id);
  const base = `/admin/${store.slug}/fields`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm underline">
          Custom fields
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Store details</h1>
        <p className="text-sm text-muted">
          Extra information about the whole store, from the groups of custom fields you made for it. A field is shown on
          the site only if you made it public, and you place it in a page, a product layout, a header or a footer.
        </p>
      </div>
      {editor.groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No group of custom fields is on the store yet.{" "}
          <Link href={`${base}/new?entity=store`} className="underline">
            Make one
          </Link>{" "}
          with the store ticked under Where it can be used.
        </p>
      ) : (
        <EntityFieldsCard
          groups={editor.groups}
          data={editor.data}
          lookups={editor.lookups}
          setup={entityFieldsSetup(store)}
          save={saveStoreFieldsAction.bind(null, store.slug)}
          title="Store details"
          intro="Shown on the site when a field is public."
          idPrefix="store-fields"
        />
      )}
    </div>
  );
}
