import { AdminTextScope } from "@/components/admin/admin-text";
import { EntityFieldsCard } from "@/components/admin/entity-fields-card";
import { entityFieldsSetup } from "@/app/admin/(gated)/[store]/fields/data";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";
import { staffFieldsForEditor, type StaffEntity } from "@/server/field-entities";
import type { SaveResult } from "@/server/settings";
import type { Store } from "@/server/stores";


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
  // In the account's language (D312 A5), as the page around it is.
  const lang = await requestAdminLang();
  const w = adminText(lang, "fields").form;
  return (
    <AdminTextScope texts={adminTexts(lang, ["fields"])}>
    <EntityFieldsCard
      groups={editor.groups}
      data={editor.data}
      lookups={editor.lookups}
      setup={entityFieldsSetup(store, ADMIN_LANG_FACTS[lang].locale)}
      save={save}
      intro={fillWords(w.staffOnly, { more: entity === "customer" ? w.customerMore : w.orderMore })}
      idPrefix={`${entity}-fields`}
    />
    </AdminTextScope>
  );
}
