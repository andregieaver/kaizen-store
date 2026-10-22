import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { CancelJobButton } from "@/components/admin/data/import-flow";
import { JobTracker } from "@/components/admin/data/job-tracker";
import { JobProgressView } from "@/components/admin/data/job-views";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockCheck, StockImportApply } from "@/components/admin/inventory/stock-import-flow";
import { StockApplied, StockDryRun, StockFindings, type StockItem } from "@/components/admin/inventory/stock-import-views";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { appliedCountsOfJob, importStage, isWorking, severityFilterOf, type SeverityFilter } from "@/lib/data-admin";
import { inventoryPaths } from "@/lib/inventory-admin";
import { momentIn } from "@/lib/inventory-words";
import { isJobId, listItems } from "@/server/data-job-store";
import { inventoryDryCountsOf, jobFor } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";

import { applyStockImportAction, cancelStockImportAction, checkStockImportAction } from "../actions";

export const metadata: Metadata = { title: "Stock import" };

type Props = PageProps<"/admin/[store]/inventory/import/[jobId]">;

const PAGE_SIZE = 50;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * One stock import (wave 3, D172, `docs/wave-3-inventory.md` 2.4): the file, the check's findings and counts, the apply with its confirmation, the progress
 * while it works, and the result. The page keeps the job going while it is open (`JobTracker`); the five-minute job takes it up if the page is closed. A job
 * of another store is a 404, the same as an id that is none.
 */
export default async function StockImportJobPage({ params, searchParams }: Props) {
  const { store: slug, jobId } = await params;
  const gated = await requirePermission(slug, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.job;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="import" title={w.title} intro={w.intro} back={{ href: inventoryPaths(store.slug).import, label: w.back }} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} jobId={jobId} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, jobId, searchParams }: { storeSlug: string; jobId: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "products:read");
  if (!memberCan(member, "products:write") || !isJobId(jobId)) notFound();
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "inventory").import;
  const w = t.job;
  const job = await jobFor(member, jobId);
  if (!job || job.kind !== "inventory_import") notFound();
  const query = await searchParams;
  const severity: SeverityFilter = severityFilterOf(typeof query.severity === "string" ? query.severity : undefined);
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const stage = importStage(job.status);
  const base = `${inventoryPaths(store.slug).import}/${job.id}`;
  const showItems = stage === "checked" || stage === "done" || stage === "failed" || stage === "cancelled" || stage === "applying";
  const listed = showItems ? await listItems(store.id, job.id, { severity: severity === "all" ? undefined : severity, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }) : { items: [], total: 0 };
  const items: StockItem[] = listed.items.map((i) => ({
    seq: i.seq,
    ref: i.kind === "stock" ? i.ref : null,
    rows: i.rows,
    outcome: i.outcome,
    will: typeof i.changes.will === "string" ? i.changes.will : null,
    location: typeof i.changes.location === "string" ? i.changes.location : null,
    current: num(i.changes.current),
    next: num(i.changes.next),
    change: num(i.changes.change),
    messages: i.messages,
  }));
  const applied = appliedCountsOfJob(job.counts);
  const dry = inventoryDryCountsOf(job);
  const view = { id: job.id, kind: job.kind, status: job.status, phase: job.phase, rowsDone: job.rowsDone, rowsTotal: job.rowsTotal, problem: job.problem };
  const hrefFor = (q: { severity?: SeverityFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q.severity && q.severity !== "all") sp.set("severity", q.severity);
    if (q.page && q.page > 1) sp.set("page", String(q.page));
    const text = sp.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" aria-label={w.file}>
        <span className="font-medium break-all">{job.inputName ?? w.stockFile}</span>
        <span className="text-muted">{fillWords(w.uploaded, { when: momentIn(job.createdAt, store.timeZone, ADMIN_LANG_FACTS[lang].locale) })}</span>
        <span className="text-muted">{t.jobStatus[job.status]}</span>
      </section>

      {isWorking(job.status) && <JobTracker tickUrl={`${base}/tick`} initial={view} />}
      {isWorking(job.status) && (
        <div>
          <CancelJobButton cancel={cancelStockImportAction.bind(null, store.slug, job.id)} label={w.cancelImport} />
        </div>
      )}
      {(stage === "failed" || stage === "cancelled" || stage === "expired") && <JobProgressView job={view} />}
      {stage === "cancelled" && <Notice>{w.cancelled}</Notice>}
      {stage === "expired" && <Notice>{w.expired}</Notice>}

      {(stage === "uploaded" || stage === "checked") && <StockCheck checked={stage === "checked"} check={checkStockImportAction.bind(null, store.slug, job.id)} />}
      {stage === "checked" && (
        <>
          <StockDryRun counts={dry} lang={lang} />
          <StockImportApply counts={dry} apply={applyStockImportAction.bind(null, store.slug, job.id)} cancel={cancelStockImportAction.bind(null, store.slug, job.id)} />
        </>
      )}
      {(stage === "applying" || stage === "done" || stage === "failed" || stage === "cancelled") && (stage === "done" || applied.updated + applied.unchanged + applied.skipped + applied.failed > 0) && (
        <StockApplied counts={applied} jobId={job.id} written={stage === "done"} lang={lang} />
      )}

      {showItems && <StockFindings items={items} total={listed.total} severity={severity} page={page} pageSize={PAGE_SIZE} hrefFor={hrefFor} problemsHref={`${base}/problems`} lang={lang} />}
      <p className="text-sm">
        <Link href={inventoryPaths(store.slug).list} className="underline underline-offset-2">
          {w.back}
        </Link>
      </p>
    </AdminTextScope>
  );
}
