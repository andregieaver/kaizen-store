import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { DeleteContentTypeButton } from "@/components/admin/content-type-delete";
import { ContentTypeEditor } from "@/components/admin/content-type-editor";
import type { ContentSite } from "@/components/admin/content-site";
import { EntryEditor } from "@/components/admin/entry-editor";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import {
  CONTENT_TYPE_PRESETS,
  emptyType,
  entryStatus,
  entryTitle,
  typeFromPreset,
  typeToInput,
  type EntryStatus,
} from "@/lib/content-types";
import { getEntry, listEntries } from "@/server/content-entries";
import { contentTypeChoices, getContentType, listContentTypes } from "@/server/content-types";
import { getPageForEdit } from "@/server/pages";

/**
 * Website → Content's screens (D326), one set for a store and for Kaizena Flow's own site (H4): each route checks who may see it, builds the
 * owner's `ContentSite` (its languages, its uploads and its bound actions) and draws the view. The views read through the owner only.
 */

const SIGNAL: Record<EntryStatus, "neutral" | "positive" | "warning"> = { draft: "neutral", published: "positive", changed: "warning" };

/** The owner's content types: each with its number of entries and a way to add one; with none, starting points to begin from. */
export async function ContentListView({ site }: { site: ContentSite }) {
  const w = adminText(site.lang, "content");
  const types = await listContentTypes(site.owner);
  const { base } = site;
  const presets = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CONTENT_TYPE_PRESETS.map((preset) => {
        const words = w.presets[preset.key as keyof typeof w.presets];
        return (
          <a key={preset.key} href={`${base}/new?preset=${preset.key}`} className={`flex flex-col gap-1 p-5 hover:bg-sunken ${CARD_CLASS}`}>
            <span className="text-body-strong text-ink">{words.name}</span>
            <span className="text-sm text-muted">{words.description}</span>
          </a>
        );
      })}
    </div>
  );

  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.list.title}
          description={w.list.description}
          actions={
            <ButtonLink href={`${base}/new`} kind="main" size="header">
              {w.list.create}
            </ButtonLink>
          }
        />
        {types.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{w.list.empty}</p>
            {presets}
          </div>
        ) : (
          <>
            <Card compact>
              <List label={w.list.label}>
                {types.map((type) => (
                  <ListRow key={type.id}>
                    <RowLead title={type.name} href={`${base}/${type.id}`} sub={<span className="font-mono">/{type.slug}</span>} />
                    <RowFact className="hidden sm:block">{countWords(type.entries, w.list.entries)}</RowFact>
                    {type.hasPages && (
                      <RowFact className="hidden md:block">
                        <Chip>{w.list.withPages}</Chip>
                      </RowFact>
                    )}
                    <RowActions>
                      <ButtonLink href={`${base}/${type.id}/new`} kind="secondary" size="dense">
                        {w.list.addEntry}
                      </ButtonLink>
                    </RowActions>
                  </ListRow>
                ))}
              </List>
            </Card>
            <details>
              <summary className="cursor-pointer text-sm text-muted">{w.list.startFrom}</summary>
              <div className="mt-3">{presets}</div>
            </details>
          </>
        )}
      </div>
    </AdminTextScope>
  );
}

/** A new content type, from scratch or from a starting point (`preset`), made in the admin's language. */
export async function NewContentTypeView({ site, preset }: { site: ContentSite; preset: unknown }) {
  const w = adminText(site.lang, "content");
  const taken = (await listContentTypes(site.owner)).map((t) => t.slug);
  const initial = (typeof preset === "string" && typeFromPreset(preset, site.lang, taken)) || emptyType(site.lang, taken);
  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields"])}>
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
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields", "builder"])}>
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

/** A content type's entries in the owner's order: each with its status, found by title, moved earlier or later. */
export async function ContentEntriesView({ site, typeId, q }: { site: ContentSite; typeId: string; q: unknown }) {
  const type = await getContentType(site.owner, typeId);
  if (!type) notFound();
  const w = adminText(site.lang, "content");
  const main = site.languages[0]?.locale ?? "en";
  const query = typeof q === "string" ? q.trim().toLowerCase() : "";
  const all = (await listEntries(site.owner, type.id)).map((entry) => ({ entry, title: entryTitle(type, entry.draft.data, main, main) }));
  const shown = query ? all.filter((e) => e.title.toLowerCase().includes(query)) : all;
  const { base } = site;
  const when = new Intl.DateTimeFormat(site.lang === "nb" ? "nb-NO" : "en-GB", { dateStyle: "medium" });

  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: w.type.backToList }}
          title={type.name}
          meta={[countWords(type.entries, w.list.entries), type.hasPages ? `/${type.slug}/…` : null]}
          actions={
            <>
              <ButtonLink href={`${base}/${type.id}/settings`} kind="secondary" size="header">
                {w.entries.editType}
              </ButtonLink>
              <ButtonLink href={`${base}/${type.id}/new`} kind="main" size="header">
                {w.entries.newEntry}
              </ButtonLink>
            </>
          }
        />
        {all.length > 0 && (
          <form className="flex max-w-md gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={w.entries.search}
              aria-label={w.entries.search}
              className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
            />
          </form>
        )}
        {shown.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>{query ? w.entries.noMatch : w.entries.none}</p>
        ) : (
          <Card compact>
            <List label={w.entries.label}>
              {shown.map(({ entry, title }, index) => {
                const status = entryStatus(entry);
                const name = title || w.entries.untitled;
                return (
                  <ListRow key={entry.id}>
                    <RowLead title={name} href={`${base}/${type.id}/${entry.id}`} sub={type.hasPages ? <span className="font-mono">/{type.slug}/{entry.slug}</span> : undefined} />
                    <RowFact>
                      <Chip signal={SIGNAL[status]}>{w.status[status]}</Chip>
                    </RowFact>
                    <RowFact className="hidden md:block">{fillWords(w.entries.changed, { when: when.format(new Date(entry.updatedAt)) })}</RowFact>
                    {!query && (
                      <RowActions>
                        <form action={site.actions.move(entry.id, "earlier")}>
                          <Button type="submit" kind="quiet" size="dense" disabled={index === 0} aria-label={fillWords(w.entries.moveEarlier, { title: name })}>
                            {w.entries.earlier}
                          </Button>
                        </form>
                        <form action={site.actions.move(entry.id, "later")}>
                          <Button type="submit" kind="quiet" size="dense" disabled={index === shown.length - 1} aria-label={fillWords(w.entries.moveLater, { title: name })}>
                            {w.entries.later}
                          </Button>
                        </form>
                      </RowActions>
                    )}
                  </ListRow>
                );
              })}
            </List>
          </Card>
        )}
      </div>
    </AdminTextScope>
  );
}

/** An entry of a content type, or a new one (`entryId` null): its fields, address and search texts, and publishing. */
export async function EntryView({ site, typeId, entryId }: { site: ContentSite; typeId: string; entryId: string | null }) {
  const type = await getContentType(site.owner, typeId);
  if (!type) notFound();
  const entry = entryId ? await getEntry(site.owner, entryId) : null;
  if (entryId && (!entry || entry.typeId !== type.id)) notFound();
  const w = adminText(site.lang, "content");
  const locales = site.languages.map((l) => l.locale);
  const main = locales[0] ?? "en";
  const status = entry ? entryStatus(entry) : null;
  const title = entry ? entryTitle(type, entry.draft.data, main, main) || w.entries.untitled : fillWords(w.entry.newTitle, { type: type.name });
  const base = `${site.base}/${type.id}`;

  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields", "builder"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: fillWords(w.entry.back, { type: type.name }) }}
          title={title}
          status={status ? <Chip signal={SIGNAL[status]}>{w.status[status]}</Chip> : undefined}
        />
        <EntryEditor
          type={{ id: type.id, name: type.name, slug: type.slug, fields: type.fields, titleField: type.titleField, hasPages: type.hasPages }}
          entry={entry && status ? { id: entry.id, slug: entry.slug, draft: entry.draft, status } : null}
          locales={locales}
          languageNames={Object.fromEntries(site.languages.map((l) => [l.locale, l.name]))}
          lookups={await site.lookups()}
          uploadImage={site.uploadImage}
          startFile={site.startFile}
          save={site.actions.saveEntry}
          publish={site.actions.publish}
          unpublish={site.actions.unpublish}
          remove={site.actions.removeEntry(type.id)}
          base={base}
        />
      </div>
    </AdminTextScope>
  );
}
