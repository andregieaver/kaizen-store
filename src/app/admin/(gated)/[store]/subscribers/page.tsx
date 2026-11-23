import type { Metadata } from "next";
import Link from "next/link";

import { engagementLevel } from "@/lib/engagement";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, KpiTile, List, ListRow, PageHeader, RowFact, RowLead, Select } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { SUBSCRIBER_STATUSES, type SubscriberStatus } from "@/lib/marketing-consent";
import { listSubscribers, newsletterFormPages, subscriberCounts, subscriberSources } from "@/server/marketing-subscribers";
import { countWords } from "@/lib/admin-fill";
import { featureOn } from "@/lib/store-features";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { memberCan, requirePermission } from "@/server/permissions";
import { listTopics, topicCounts } from "@/server/marketing-topics";
import { TopicsCard } from "@/components/admin/topics-card";

import { archiveTopicAction, moveTopicAction, saveTopicAction } from "./actions";

export const metadata: Metadata = { title: "Subscribers" };

type Props = PageProps<"/admin/[store]/subscribers">;

const SIGNAL: Record<SubscriberStatus, "positive" | "warning" | "neutral"> = { subscribed: "positive", pending: "warning", unsubscribed: "neutral" };

const row = "flex min-h-16 flex-wrap items-center justify-between gap-3 py-3";

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3.4): how many people want the store's emails, and who, newest first.
 * Opening one shows what they agreed to and when. Nobody is added here: people join from the store's forms, checkout or My account.
 */
export default async function SubscribersPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const query = await searchParams;
  const q = first(query.q).slice(0, 100);
  const status = (SUBSCRIBER_STATUSES as readonly string[]).includes(first(query.status)) ? (first(query.status) as SubscriberStatus) : null;
  // Narrowed to one form's sign-ups or one page's (D850): the form by its id, the page by its path on the site.
  const form = first(query.form).slice(0, 64) || null;
  const path = first(query.page).startsWith("/") ? first(query.page).slice(0, 500) : null;
  const [at, id] = first(query.before).split("_");
  const before = at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
  const [counts, page, formPages, sources, topics, topicReach] = await Promise.all([
    subscriberCounts(store.id),
    listSubscribers(store.id, { query: q, status, form, path, before }),
    newsletterFormPages(store.id),
    subscriberSources(store.id),
    listTopics(store.id, true),
    topicCounts(store.id),
  ]);
  const base = `/admin/${store.slug}/subscribers`;
  const lang = adminLangOf(member.account.adminLocale);
  const w = MARKETING_WORDS[lang];
  const ws = w.subscribers;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const tongues = new Intl.DisplayNames([numbers], { type: "language" });
  const n = (v: number) => v.toLocaleString(numbers);
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { dateStyle: "medium", timeZone: store.timeZone });
  const filter = (next: { status?: SubscriberStatus | null; before?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = next.status === undefined ? status : next.status;
    if (s) p.set("status", s);
    if (form) p.set("form", form);
    if (path) p.set("page", path);
    if (next.before) p.set("before", next.before);
    const text = p.toString();
    return text ? `${base}?${text}` : base;
  };
  const last = page.rows.at(-1);
  const total = counts.subscribed + counts.pending + counts.unsubscribed;
  const shop = featureOn(store, "shop");
  // A form record since deleted has a uuid; a page's own sign-up form from before forms were records (D705 F2) has its block's id.
  const formName = (f: { id: string; name: string | null }) => f.name ?? (/^[0-9a-f-]{36}$/.test(f.id) ? ws.formGone : ws.pageForm);
  const chosenForm = form ? sources.forms.find((f) => f.id === form) : undefined;
  const narrowed = Boolean(q || status || form || path);

  // After the member is known: the engagement words count days from now (M2.8).
  const now = new Date();
  return (
    <div className="flex flex-col gap-6">
      {/* Round 13 (D639): the list in a sentence, how people join as rows, counters only when not zero. */}
      <PageHeader
        title={ws.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{counts.subscribed === 0 ? ws.leadNone : countWords(counts.subscribed, ws.leadSome, { n: n(counts.subscribed) })}</span>
            {counts.subscribed === 0 && counts.pending === 0 ? ws.leadNoneRest : counts.pending > 0 ? countWords(counts.pending, ws.leadWaiting, { n: n(counts.pending) }) : ""}
          </span>,
        ]}
        actions={
          memberCan(member, "owner") && total > 0 ? (
            <form method="post" action={`${base}/export`}>
              <Button type="submit">{ws.export}</Button>
            </form>
          ) : undefined
        }
      />

      {total > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {counts.subscribed > 0 && <KpiTile label={w.segments.wantYourEmails} value={n(counts.subscribed)} href={filter({ status: "subscribed" })} />}
          {counts.pending > 0 && <KpiTile label={ws.statuses.pending} value={n(counts.pending)} context={ws.waitingContext} href={filter({ status: "pending" })} />}
          {counts.unsubscribed > 0 && <KpiTile label={ws.left} value={n(counts.unsubscribed)} href={filter({ status: "unsubscribed" })} />}
        </div>
      )}

      <section aria-labelledby="ways" className={`px-6 py-3 ${CARD_CLASS}`}>
        <h2 id="ways" className="mt-2 mb-1 text-title text-ink">{ws.waysTitle}</h2>
        <ul className="divide-y divide-line">
          <li className={row}>
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">{ws.formRow}</span>
              <span className="text-caption text-ink-2">{formPages === 0 ? ws.formNone : countWords(formPages, ws.formSome)}</span>
            </span>
            {formPages === 0 ? (
              memberCan(member, "website:write") && (
                <ButtonLink kind={total === 0 ? "main" : "secondary"} href={store.frontPageId ? `/admin/${store.slug}/pages/${store.frontPageId}` : `/admin/${store.slug}/pages`}>
                  {store.frontPageId ? ws.formAdd : ws.formAddPages}
                </ButtonLink>
              )
            ) : (
              <span className="text-caption text-positive-text">{ws.inPlace}</span>
            )}
          </li>
          <li className={row}>
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">{ws.checkoutRow}</span>
              <span className="text-caption text-ink-2">{shop ? ws.checkoutSub : ws.offWithShop}</span>
            </span>
            {shop && <span className="text-caption text-positive-text">{ws.inPlace}</span>}
          </li>
          <li className={row}>
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">{ws.accountRow}</span>
              <span className="text-caption text-ink-2">{shop ? ws.accountSub : ws.offWithShop}</span>
            </span>
            {shop && <span className="text-caption text-positive-text">{ws.inPlace}</span>}
          </li>
        </ul>
      </section>

      {/* The store's email topics (M4.2, D882): what it writes about, and how many readers each reaches. */}
      <TopicsCard
        storeSlug={store.slug}
        locales={store.localization.locales.map((code) => ({ code, name: tongues.of(code) ?? code }))}
        topics={topics.map((t) => ({ ...t, readers: topicReach.get(t.id) ?? 0 }))}
        canWrite={memberCan(member, "marketing:write")}
        numbers={numbers}
        save={saveTopicAction}
        archive={archiveTopicAction}
        move={moveTopicAction}
      />

      {total > 0 && (
        <Card
          compact
          title={chosenForm ? formName(chosenForm) : status ? ws.statuses[status] : ws.everyone}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              {sources.forms.length > 0 && (
                <Select name="form" defaultValue={form ?? ""} aria-label={ws.formFilter} className="max-w-56" data-subscriber-form-filter>
                  <option value="">{ws.anyForm}</option>
                  {sources.forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {formName(f)} ({n(f.n)})
                    </option>
                  ))}
                </Select>
              )}
              {sources.pages.length > 0 && (
                <Select name="page" defaultValue={path ?? ""} aria-label={ws.pageFilter} className="max-w-56" data-subscriber-page-filter>
                  <option value="">{ws.anyPage}</option>
                  {sources.pages.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.path} ({n(p.n)})
                    </option>
                  ))}
                </Select>
              )}
              <input type="search" name="q" defaultValue={q} placeholder={ws.search} aria-label={ws.search} className="min-h-10 w-64 rounded-md border border-line px-3" />
              <Button type="submit">{ws.searchButton}</Button>
              {narrowed && (
                <Link href={base} className="text-body text-ink-2 underline-offset-2 hover:underline">
                  {ws.showEveryone}
                </Link>
              )}
            </form>
          }
        >
          {page.rows.length === 0 ? (
            <p className="p-4 text-body text-muted">{ws.nobodyMatches}</p>
          ) : (
            <List label={ws.list}>
              {page.rows.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={<span className="block max-w-80 truncate">{row.email}</span>}
                    href={`${base}/${row.id}`}
                    sub={[
                      row.name,
                      // A form's sign-up says which form and page (D850).
                      row.form ? formName(row.form) : ws.sources[row.source],
                      row.path,
                      row.status === "subscribed" && !row.confirmed && row.source === "form" ? ws.notConfirmed : null,
                      // Their engagement in words (M2.8), from their latest press on a link; only for those on the list.
                      row.status === "subscribed" ? ws.engagement[engagementLevel(row.joinedAt, row.lastClickAt, now, row.pausedAt)] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <RowFact className="hidden sm:block">{date(row.at)}</RowFact>
                  <Chip signal={SIGNAL[row.status]} dot>
                    {ws.statuses[row.status]}
                  </Chip>
                </ListRow>
              ))}
            </List>
          )}
          {page.more && last && (
            <div className="mt-4">
              <Link href={filter({ before: `${last.at}_${last.id}` })} className="text-body text-ink-2 underline-offset-2 hover:underline">
                {ws.older}
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
