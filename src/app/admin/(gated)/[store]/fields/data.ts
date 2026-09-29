import type { EditorTerm } from "@/components/admin/field-group-editor";
import type { FieldLanguage } from "@/components/admin/field-editor-dialog";
import type { FieldEntity } from "@/lib/custom-fields";
import { PAGE_ROLES, ROLE_COPY } from "@/lib/page-roles";
import { saveTermFieldsAction, startFieldFileUploadAction, termFieldsAction } from "./actions";
import type { TermFieldsSetup } from "@/components/admin/term-fields";
import { activeFieldGroups } from "@/server/custom-fields";
import { uploadsEnabled } from "@/server/media";
import type { Store } from "@/server/stores";
import { listTerms } from "@/server/taxonomy";

/** The store's categories and tags of every kind of content a group can be on, for the location rules. */
export async function editorTerms(storeId: string): Promise<EditorTerm[]> {
  const entities = ["product", "page", "article"] as const satisfies readonly FieldEntity[];
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

/** What a categories and tags page needs to edit their custom fields (D118, phase 2); nothing when the store has no group for them. */
export async function termFieldsSetup(store: Store): Promise<TermFieldsSetup | undefined> {
  if ((await activeFieldGroups(store.id, "term")).length === 0) return undefined;
  return {
    storeSlug: store.slug,
    locales: store.localization.locales,
    languageNames: Object.fromEntries(storeLanguages(store).map((l) => [l.locale, l.name])),
    uploads: uploadsEnabled(),
    open: termFieldsAction.bind(null, store.slug),
    save: saveTermFieldsAction.bind(null, store.slug),
    startFile: startFieldFileUploadAction.bind(null, store.slug),
  };
}
