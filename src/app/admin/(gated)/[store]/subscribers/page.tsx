import type { Metadata } from "next";
import Link from "next/link";

import { Button, Card, CARD_CLASS, Chip, KpiTile, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { SUBSCRIBER_STATUSES, type SubscriberStatus } from "@/lib/marketing-consent";
import { listSubscribers, subscriberCounts } from "@/server/marketing-subscribers";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Subscribers" };

type Props = PageProps<"/admin/[store]/subscribers">;

const SIGNAL: Record<SubscriberStatus, "positive" | "warning" | "neutral"> = { subscribed: "positive", pending: "warning", unsubscribed: "neutral" };

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
  const [at, id] = first(query.before).split("_");
  const before = at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
  const [counts, page] = await Promise.all([subscriberCounts(store.id), listSubscribers(store.id, { query: q, status, before })]);
  const base = `/admin/${store.slug}/subscribers`;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const ws = w.subscribers;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const n = (v: number) => v.toLocaleString(numbers);
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { dateStyle: "medium", timeZone: store.timeZone });
  const filter = (next: { status?: SubscriberStatus | null; before?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = next.status === undefined ? status : next.status;
    if (s) p.set("status", s);
    if (next.before) p.set("before", next.before);
    const text = p.toString();
    return text ? `${base}?${text}` : base;
  };
  const last = page.rows.at(-1);
  const total = counts.subscribed + counts.pending + counts.unsubscribed;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ws.title}
        description={ws.description}
        actions={
          memberCan(member, "owner") && total > 0 ? (
            <form method="post" action={`${base}/export`}>
              <Button type="submit">{ws.export}</Button>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label={w.segments.wantYourEmails} value={n(counts.subscribed)} href={filter({ status: "subscribed" })} />
        <KpiTile label={ws.statuses.pending} value={n(counts.pending)} context={ws.waitingContext} href={filter({ status: "pending" })} />
        <KpiTile label={ws.left} value={n(counts.unsubscribed)} href={filter({ status: "unsubscribed" })} />
      </div>

      {total === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          {ws.empty}
        </p>
      ) : (
        <Card
          compact
          title={status ? ws.statuses[status] : ws.everyone}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              <input type="search" name="q" defaultValue={q} placeholder={ws.search} aria-label={ws.search} className="min-h-10 w-64 rounded-md border border-line px-3" />
              <Button type="submit">{ws.searchButton}</Button>
              {(q || status) && (
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
                    sub={[row.name, ws.sources[row.source], row.status === "subscribed" && !row.confirmed && row.source === "form" ? ws.notConfirmed : null].filter(Boolean).join(" · ")}
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
