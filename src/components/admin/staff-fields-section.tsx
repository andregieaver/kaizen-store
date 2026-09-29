import { EntityFieldsCard } from "@/components/admin/entity-fields-card";
import { entityFieldsSetup } from "@/app/admin/(gated)/[store]/fields/data";
import { staffFieldsForEditor, type StaffEntity } from "@/server/field-entities";
import type { SaveResult } from "@/server/settings";
import type { Store } from "@/server/stores";

const WORDS: Record<StaffEntity, { thing: string; more: string }> = {
  customer: {
    thing: "customer",
    more: "Personal data: it goes with the customer if they delete their account.",
  },
  order: {
    thing: "order",
    more: "Kept with the order, which stays for bookkeeping: keep personal details out of it that you do not need.",
  },
};

/**
 * The custom fields of a customer or an order on its admin page (D120): every
 * active group made for that kind of thing, filled in by staff. They are for
 * staff only and never shown to shoppers or on the site. Draws nothing when the
 * store has no such group, or the thing is not the store's own.
 */
export async function StaffFieldsSection({
  store,
  entity,
  id,
  save,
}: {
  store: Store;
  entity: StaffEntity;
  id: string;
  save: (changes: unknown) => Promise<SaveResult>;
}) {
  const editor = await staffFieldsForEditor(store.id, entity, id);
  if (!editor || editor.groups.length === 0) return null;
  return (
    <EntityFieldsCard
      groups={editor.groups}
      data={editor.data}
      lookups={editor.lookups}
      setup={entityFieldsSetup(store)}
      save={save}
      intro={`Only staff see this, never the shopper. ${WORDS[entity].more}`}
      idPrefix={`${entity}-fields`}
    />
  );
}
