import type { EditorTerm } from "@/components/admin/field-group-editor";
import type { FieldLanguage } from "@/components/admin/field-editor-dialog";
import type { FieldEntity } from "@/lib/custom-fields";
import { PAGE_ROLES, ROLE_COPY } from "@/lib/page-roles";
import type { Store } from "@/server/stores";
import { listTerms } from "@/server/taxonomy";

/** The store's categories and tags of every kind of content a group can be on, for the location rules. */
export async function editorTerms(storeId: string): Promise<EditorTerm[]> {
  const entities: FieldEntity[] = ["product", "page", "article"];
  const lists = await Promise.all(entities.map((entity) => listTerms({ storeId, contentType: entity })));
  return lists.flatMap((terms, i) =>
    terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind, parentId: t.parentId, entity: entities[i] })),
  );
}

/** The special pages a rule can ask about, named as the admin names them. */
export const roleOptions = (): { value: string; label: string }[] =>
  PAGE_ROLES.map((role) => ({ value: role, label: ROLE_COPY[role].name }));

/** The store's languages, the main one first, named in English. */
export function storeLanguages(store: Store): FieldLanguage[] {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return store.localization.locales.map((locale) => ({ locale, name: names.of(locale) ?? locale }));
}
