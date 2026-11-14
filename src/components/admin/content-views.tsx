import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import type { ContentSite } from "@/components/admin/content-site";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import {
  CONTENT_TYPE_PRESETS,
  entryStatus,
  entryTitle,
  type EntryStatus,
} from "@/lib/content-types";
import { listEntries } from "@/server/content-entries";
import { getContentType, listContentTypes } from "@/server/content-types";

/**
 * Website → Content's screens (D326), one set for a store and for Kaizena Flow's own site (H4): each route checks who may see it, builds the
 * owner's `ContentSite` (its languages, its uploads and its bound actions) and draws the view. The views read through the owner only.
 */

export const SIGNAL: Record<EntryStatus, "neutral" | "positive" | "warning"> = { draft: "neutral", published: "positive", changed: "warning" };

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
