import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { ContentTypeEditor } from "@/components/admin/content-type-editor";
import { DeleteContentTypeButton } from "@/components/admin/content-type-delete";
import { Button, ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { typeToInput } from "@/lib/content-types";
import { moneyCurrencies } from "@/lib/field-money";
import { contentTypeChoices, getContentType } from "@/server/content-types";
import { getPageForEdit } from "@/server/pages";
import { requirePermission } from "@/server/permissions";

import { storeLanguages } from "../../../fields/data";
import { deleteContentTypeAction, designEntryLayoutAction, saveContentTypeAction } from "../../actions";

export const metadata: Metadata = { title: "Content type settings" };

/** A content type's name, web name, fields and pages (D326), and deleting it with its entries. */
export default async function ContentTypeSettingsPage({ params }: PageProps<"/admin/[store]/content/[typeId]/settings">) {
  const { store: slug, typeId } = await params;
  const { store, account } = await requirePermission(slug, "website:read");
  const type = await getContentType(store.id, typeId);
  if (!type) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "content");
  const base = `/admin/${store.slug}/content`;
  const layout = type.layoutId ? await getPageForEdit(store.id, type.layoutId, "entry_layout") : null;
  return (
    <AdminTextScope texts={adminTexts(lang, ["content", "fields"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `${base}/${type.id}`, label: w.type.back }} title={fillWords(w.type.settingsTitle, { type: type.name })} />
        <ContentTypeChoices types={await contentTypeChoices(store.id)}>
          <ContentTypeEditor
            initial={typeToInput(type)}
            languages={storeLanguages(store, lang === "nb" ? "nb" : "en")}
            currencies={moneyCurrencies(store)}
            fixedSlug={type.everPublished}
            save={saveContentTypeAction.bind(null, store.slug)}
            base={base}
            actions={
              <DeleteContentTypeButton
                label={w.type.delete}
                question={countWords(type.entries, w.type.deleteAsk, { name: type.name })}
                remove={deleteContentTypeAction.bind(null, store.slug, type.id)}
              />
            }
          />
        </ContentTypeChoices>
        <Card title={w.layout.title} description={fillWords(w.layout.description, { slug: type.slug })}>
          {!type.hasPages ? (
            <p className="text-sm text-muted">{w.layout.noPages}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-ink-2">{layout ? (layout.state === "draft" ? w.layout.draft : w.layout.published) : w.layout.standard}</p>
              {layout ? (
                <ButtonLink href={`${base}/layouts/${layout.id}`}>{w.layout.edit}</ButtonLink>
              ) : (
                <form action={designEntryLayoutAction.bind(null, store.slug, type.id)}>
                  <Button type="submit">{w.layout.design}</Button>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </AdminTextScope>
  );
}
