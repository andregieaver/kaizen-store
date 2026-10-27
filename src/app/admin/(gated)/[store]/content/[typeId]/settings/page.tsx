import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeEditor } from "@/components/admin/content-type-editor";
import { DeleteContentTypeButton } from "@/components/admin/content-type-delete";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { typeToInput } from "@/lib/content-types";
import { moneyCurrencies } from "@/lib/field-money";
import { getContentType } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";

import { storeLanguages } from "../../../fields/data";
import { deleteContentTypeAction, saveContentTypeAction } from "../../actions";

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
  return (
    <AdminTextScope texts={adminTexts(lang, ["content", "fields"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `${base}/${type.id}`, label: w.type.back }} title={fillWords(w.type.settingsTitle, { type: type.name })} />
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
      </div>
    </AdminTextScope>
  );
}
