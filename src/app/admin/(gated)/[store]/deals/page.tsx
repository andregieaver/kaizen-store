import type { Metadata } from "next";
import Link from "next/link";

import { DealBoard, type BoardColumnView } from "@/components/admin/deals/deal-board";
import { requireFeature } from "@/components/admin/feature-off";
import { ButtonLink, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { boardColumns, daysInStage, whoLine } from "@/lib/deals";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { whenText } from "@/components/admin/activities/activity-view";
import { activityWhen } from "@/lib/activities";
import { nextActivities } from "@/server/activities";
import { ensurePipeline, listDeals } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";

import { placeDealAction } from "./actions";
import { dismissLeadAction, makeLeadDealAction } from "./lead-actions";
import { LeadsList } from "@/components/admin/deals/leads-list";
import { leadsOf } from "@/server/leads";
import { filingAddressOf } from "@/server/email-filing";

export const metadata: Metadata = { title: "Deals" };

const CLOSED_DAYS = 90;

/**
 * The board of deals (S2, D464): Homer sees a column per stage of his one pipeline, then Won and Lost, each with what its deals are worth,
 * and drags a deal on or presses New deal. The store's first pipeline is made on the first visit in his words. Lisa switches pipelines and
 * sets their stages under Pipelines. Every member who may read customers sees it; those who may change them move deals.
 */
export default async function DealsPage({ params, searchParams }: PageProps<"/admin/[store]/deals">) {
  const member = await requirePermission((await params).store, "customers:read");
  const off = requireFeature(member, "sales");
  if (off) return off;
  const { store } = member;
  const query = await searchParams;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "deals");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const main = mainCurrency(store);
  const money = (minor: number) => formatMoney(minor, main, locale, { decimals: "hide_whole" });
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  const pipelines = await ensurePipeline(store.id, {
    name: w.firstPipeline,
    stages: [{ name: w.stageNames.new }, { name: w.stageNames.talking }, { name: w.stageNames.quote_sent, quoteStage: true }],
  });
  const pipeline = pipelines.find((p) => p.id === query.pipeline) ?? pipelines[0];
  const now = new Date();
  const today = todayIn(now, store.timeZone);
  const deals = await listDeals(store, { pipelineId: pipeline.id, closedSince: new Date(now.getTime() - CLOSED_DAYS * 86_400_000) });
  const nexts = await nextActivities(store.id, deals.filter((d) => d.status === "open").map((d) => d.id));
  const nextOf = (dealId: string): BoardColumnView["cards"][number]["next"] => {
    const next = nexts.get(dealId);
    if (!next) return "none";
    const kind = w.activities.kinds[next.kind].toLocaleLowerCase(locale);
    const when = whenText({ ...next, durationMinutes: null }, { now, timeZone: store.timeZone, locale, words: w.activities });
    return { text: fillWords(w.board.next, { kind, when }), late: activityWhen({ id: dealId, doneAt: null, ...next }, now, store.timeZone) === "late" };
  };
  const columns = boardColumns(
    pipeline.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability })),
    deals.map((deal) => ({ id: deal.id, stageId: deal.stageId, status: deal.status, value: deal.value.minor, expectedCloseOn: deal.expectedCloseOn, createdAt: deal.createdAt, deal })),
  );
  const base = `/admin/${store.slug}/deals`;
  const view: BoardColumnView[] = columns.map((column) => ({
    key: column.key,
    title: column.stage?.name ?? w.statuses[column.status],
    status: column.status,
    count: countWords(column.deals.length, w.board.count),
    total: column.total > 0 ? money(column.total) : null,
    weighted: column.status === "open" && column.stage?.probability != null && column.total > 0 ? fillWords(w.board.weighted, { amount: money(column.weightedTotal) }) : null,
    cards: column.deals.map(({ deal }) => {
      const open = deal.status === "open";
      const late = open && deal.expectedCloseOn !== null && deal.expectedCloseOn < today;
      return {
        id: deal.id,
        title: deal.title,
        href: `${base}/${deal.id}`,
        who: whoLine(deal),
        value: deal.value.minor === null ? null : money(deal.value.minor),
        valueNote:
          deal.value.unconverted.length > 0
            ? fillWords(w.board.unconverted, { currencies: deal.value.unconverted.join(", ") })
            : deal.value.source === "estimate"
              ? w.board.estimate
              : null,
        days: open ? countWords(daysInStage(deal.stageEnteredAt, now), w.board.daysInStage) : null,
        closes: open && deal.expectedCloseOn ? fillWords(late ? w.board.late : w.board.closes, { date: day(deal.expectedCloseOn) }) : null,
        late,
        next: open ? nextOf(deal.id) : null,
      };
    }),
  }));
  const canChange = memberCan(member, "customers:write");
  // The leads inbox (S4, D475) beside the board: people who asked for something and are not customers yet.
  const leads = await leadsOf(store.id);
  const showLeads = query.view === "leads";
  // The store's filing address (S5, D476), for those who may change customers: made the first time it is shown.
  const filing = canChange ? await filingAddressOf(store.id) : null;
  const viewTab = (leadsView: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${leadsView === showLeads ? "border-ink bg-ink text-inverse-ink" : "border-line bg-card text-ink"}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {canChange && (
              <ButtonLink kind="main" href={`${base}/new?pipeline=${pipeline.id}`}>
                {w.newDeal}
              </ButtonLink>
            )}
            <ButtonLink kind="quiet" href={`${base}/pipelines`}>
              {w.pipelines}
            </ButtonLink>
          </div>
        }
      />
      <nav aria-label={w.leads.tab} className="flex flex-wrap gap-2">
        <Link href={`${base}?pipeline=${pipeline.id}`} aria-current={showLeads ? undefined : "page"} className={viewTab(false)}>
          {w.leads.board}
        </Link>
        <Link href={`${base}?view=leads`} aria-current={showLeads ? "page" : undefined} className={viewTab(true)}>
          {w.leads.tab}
          {leads.length > 0 && ` (${leads.length})`}
        </Link>
      </nav>
      {showLeads ? (
        <LeadsList
          leads={leads}
          words={w.leads}
          when={(iso) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: store.timeZone })}
          actions={
            canChange
              ? { make: (email) => makeLeadDealAction.bind(null, store.slug, email), dismiss: (email) => dismissLeadAction.bind(null, store.slug, email) }
              : null
          }
        />
      ) : (
        <>
      {pipelines.length > 1 && (
        <nav aria-label={w.pipeline} className="flex flex-wrap gap-2">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`${base}?pipeline=${p.id}`}
              aria-current={p.id === pipeline.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm ${p.id === pipeline.id ? "border-ink bg-ink text-inverse-ink" : "border-line bg-card text-ink"}`}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}
      {deals.length === 0 && <p className="text-body text-ink-2">{w.board.empty}</p>}
      <DealBoard columns={view} words={{ board: w.board, lost: w.lost, statuses: w.statuses }} place={placeDealAction.bind(null, store.slug)} canChange={canChange} />
      <p className="text-sm text-muted">{w.board.closedNote}</p>
      {filing && <p className="text-sm text-muted">{fillWords(w.filing, { address: filing })}</p>}
        </>
      )}
    </div>
  );
}
