import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { ContentTypeEditor } from "@/components/admin/content-type-editor";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { emptyType, typeFromPreset } from "@/lib/content-types";
import { moneyCurrencies } from "@/lib/field-money";
import { contentTypeChoices, listContentTypes } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";

import { storeLanguages } from "../../fields/data";
import { saveContentTypeAction } from "../actions";

export const metadata: Metadata = { title: "New content type" };

/** A new content type (D326), from scratch or from a starting point (`?preset=`), made in the admin's language. */
export default async function NewContentTypePage({ params, searchParams }: PageProps<"/admin/[store]/content/new">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "content");
  const preset = (await searchParams).preset;
  const taken = (await listContentTypes(store.id)).map((t) => t.slug);
  const initial = (typeof preset === "string" && typeFromPreset(preset, lang, taken)) || emptyType(lang, taken);
  const base = `/admin/${store.slug}/content`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["content", "fields"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: w.type.backToList }} title={w.type.newTitle} />
        <ContentTypeChoices types={await contentTypeChoices(store.id)}>
          <ContentTypeEditor
            initial={initial}
            languages={storeLanguages(store, lang === "nb" ? "nb" : "en")}
            currencies={moneyCurrencies(store)}
            fixedSlug={false}
            save={saveContentTypeAction.bind(null, store.slug)}
            base={base}
          />
        </ContentTypeChoices>
      </div>
    </AdminTextScope>
  );
}
