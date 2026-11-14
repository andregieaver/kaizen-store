import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { DeleteContentTypeButton } from "@/components/admin/content-type-delete";
import { ContentTypeEditor } from "@/components/admin/content-type-editor";
import type { ContentSite } from "@/components/admin/content-site";
import { Button, ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { emptyType, typeFromPreset, typeToInput } from "@/lib/content-types";
import { contentTypeChoices, getContentType, listContentTypes } from "@/server/content-types";
import { getPageForEdit } from "@/server/pages";

/** The content type screens that draw the type's editor (D326), apart from the lists (`content-views.tsx`): a route loads every client component its modules import (bloat review step 0.10). */

/** A new content type, from scratch or from a starting point (`preset`), made in the admin's language. */
export async function NewContentTypeView({ site, preset }: { site: ContentSite; preset: unknown }) {
  const w = adminText(site.lang, "content");
  const taken = (await listContentTypes(site.owner)).map((t) => t.slug);
  const initial = (typeof preset === "string" && typeFromPreset(preset, site.lang, taken)) || emptyType(site.lang, taken);
  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields", "builder", "website"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: site.base, label: w.type.backToList }} title={w.type.newTitle} />
        <ContentTypeChoices types={await contentTypeChoices(site.owner)}>
          <ContentTypeEditor initial={initial} languages={site.languages} currencies={site.currencies} fixedSlug={false} save={site.actions.saveType} base={site.base} />
        </ContentTypeChoices>
      </div>
    </AdminTextScope>
  );
}

/** A content type's name, web name, fields and pages, its entry page, and deleting it with its entries. */
export async function ContentTypeSettingsView({ site, typeId }: { site: ContentSite; typeId: string }) {
  const type = await getContentType(site.owner, typeId);
  if (!type) notFound();
  const w = adminText(site.lang, "content");
  const { base } = site;
  const layout = type.layoutId ? await getPageForEdit(site.owner, type.layoutId, "entry_layout") : null;
  const design = site.actions.designLayout;
  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields", "builder", "website"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `${base}/${type.id}`, label: w.type.back }} title={fillWords(w.type.settingsTitle, { type: type.name })} />
        <ContentTypeChoices types={await contentTypeChoices(site.owner)}>
          <ContentTypeEditor
            initial={typeToInput(type)}
            languages={site.languages}
            currencies={site.currencies}
            fixedSlug={type.everPublished}
            save={site.actions.saveType}
            base={base}
            actions={
              <DeleteContentTypeButton
                label={w.type.delete}
                question={countWords(type.entries, w.type.deleteAsk, { name: type.name })}
                remove={site.actions.deleteType(type.id)}
              />
            }
          />
        </ContentTypeChoices>
        {design && (
          <Card title={w.layout.title} description={fillWords(w.layout.description, { slug: type.slug })}>
            {!type.hasPages ? (
              <p className="text-sm text-muted">{w.layout.noPages}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-sm text-ink-2">{layout ? (layout.state === "draft" ? w.layout.draft : w.layout.published) : w.layout.standard}</p>
                {layout ? (
                  <ButtonLink href={`${base}/layouts/${layout.id}`}>{w.layout.edit}</ButtonLink>
                ) : (
                  <form action={design(type.id)}>
                    <Button type="submit">{w.layout.design}</Button>
                  </form>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </AdminTextScope>
  );
}
