import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { entryStatus, entryTitle, type EntryStatus } from "@/lib/content-types";
import { listEntries } from "@/server/content-entries";
import { getContentType } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";

import { moveEntryAction } from "../actions";

export const metadata: Metadata = { title: "Content type entries" };

const SIGNAL: Record<EntryStatus, "neutral" | "positive" | "warning"> = { draft: "neutral", published: "positive", changed: "warning" };

/** A content type's entries in the store's order (D326): each with its status, found by title, moved earlier or later. */
export default async function ContentTypePage({ params, searchParams }: PageProps<"/admin/[store]/content/[typeId]">) {
  const { store: slug, typeId } = await params;
  const { store, account } = await requirePermission(slug, "website:read");
  const type = await getContentType(store.id, typeId);
  if (!type) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "content");
  const main = store.localization.locales[0];
  const q = (await searchParams).q;
  const query = typeof q === "string" ? q.trim().toLowerCase() : "";
  const all = (await listEntries(store.id, type.id)).map((entry) => ({ entry, title: entryTitle(type, entry.draft.data, main, main) }));
  const shown = query ? all.filter((e) => e.title.toLowerCase().includes(query)) : all;
  const base = `/admin/${store.slug}/content`;
  const when = new Intl.DateTimeFormat(lang === "nb" ? "nb-NO" : "en-GB", { dateStyle: "medium" });

  return (
    <AdminTextScope texts={adminTexts(lang, ["content"])}>
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
                        <form action={moveEntryAction.bind(null, store.slug, entry.id, "earlier")}>
                          <Button type="submit" kind="quiet" size="dense" disabled={index === 0} aria-label={fillWords(w.entries.moveEarlier, { title: name })}>
                            {w.entries.earlier}
                          </Button>
                        </form>
                        <form action={moveEntryAction.bind(null, store.slug, entry.id, "later")}>
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
