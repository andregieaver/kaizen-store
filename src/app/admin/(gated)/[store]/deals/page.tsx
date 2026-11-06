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
import { ensurePipeline, listDeals } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";

import { placeDealAction } from "./actions";

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
      };
    }),
  }));
  const canChange = memberCan(member, "customers:write");

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
    </div>
  );
}
