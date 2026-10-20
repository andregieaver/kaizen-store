import type { Metadata } from "next";
import Link from "next/link";

import { Button, Card, CARD_CLASS, Chip, KpiTile, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { SOURCE_WORDS, STATUS_WORDS, SUBSCRIBER_STATUSES, type SubscriberStatus } from "@/lib/marketing-consent";
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
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: store.timeZone });
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
        title="Subscribers"
        description="People who asked for your emails with news and offers, with the words they agreed to and when. They join from your sign-up forms, checkout and My account, and every email you send them will have a link to leave."
        actions={
          memberCan(member, "owner") && total > 0 ? (
            <form method="post" action={`${base}/export`}>
              <Button type="submit">Export</Button>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Want your emails" value={counts.subscribed.toLocaleString("en-GB")} href={filter({ status: "subscribed" })} />
        <KpiTile label="Waiting for their link" value={counts.pending.toLocaleString("en-GB")} context="They have not opened the confirmation email yet." href={filter({ status: "pending" })} />
        <KpiTile label="Left" value={counts.unsubscribed.toLocaleString("en-GB")} href={filter({ status: "unsubscribed" })} />
      </div>

      {total === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          Nobody yet. Add a newsletter form to a page, and people can also tick the box at checkout or switch it on in My account.
        </p>
      ) : (
        <Card
          compact
          title={status ? STATUS_WORDS[status] : "Everyone"}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              <input type="search" name="q" defaultValue={q} placeholder="Search by email or name" aria-label="Search by email or name" className="min-h-10 w-64 rounded-md border border-line px-3" />
              <Button type="submit">Search</Button>
              {(q || status) && (
                <Link href={base} className="text-body text-ink-2 underline-offset-2 hover:underline">
                  Show everyone
                </Link>
              )}
            </form>
          }
        >
          {page.rows.length === 0 ? (
            <p className="p-4 text-body text-muted">Nobody matches.</p>
          ) : (
            <List label="Subscribers">
              {page.rows.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={<span className="block max-w-80 truncate">{row.email}</span>}
                    href={`${base}/${row.id}`}
                    sub={[row.name, SOURCE_WORDS[row.source], row.status === "subscribed" && !row.confirmed && row.source === "form" ? "not confirmed by email" : null].filter(Boolean).join(" · ")}
                  />
                  <RowFact className="hidden sm:block">{date(row.at)}</RowFact>
                  <Chip signal={SIGNAL[row.status]} dot>
                    {STATUS_WORDS[row.status]}
                  </Chip>
                </ListRow>
              ))}
            </List>
          )}
          {page.more && last && (
            <div className="mt-4">
              <Link href={filter({ before: `${last.at}_${last.id}` })} className="text-body text-ink-2 underline-offset-2 hover:underline">
                Older
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
