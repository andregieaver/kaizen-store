import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CustomerCheck, CustomerImportApply } from "@/components/admin/customer-import-flow";
import { CustomerApplied, CustomerDryRun, CustomerFindings, type CustomerItem } from "@/components/admin/customer-import-views";
import { CancelJobButton } from "@/components/admin/data/import-flow";
import { JobTracker } from "@/components/admin/data/job-tracker";
import { JobProgressView } from "@/components/admin/data/job-views";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { appliedCountsOfJob, importStage, isWorking, severityFilterOf, type SeverityFilter } from "@/lib/data-admin";
import { momentIn } from "@/lib/inventory-words";
import { isJobId, listItems } from "@/server/data-job-store";
import { historyDryCountsOf, jobFor } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";

import { applyHistoryImportAction, cancelHistoryImportAction, checkHistoryImportAction } from "../actions";

export const metadata: Metadata = { title: "Order history import" };

type Props = PageProps<"/admin/[store]/orders/history-import/[jobId]">;

const PAGE_SIZE = 50;

/**
 * One order history import (wave 11 unit E, D384): the file, the check's findings and counts, the import with its confirmation, the progress
 * while it works, and the result, on the customer import's views. The page keeps the job going while it is open (`JobTracker`); the
 * five-minute job takes it up if the page is closed. A job of another store, or of another kind, is a 404.
 */
export default async function OrderHistoryImportJobPage({ params, searchParams }: Props) {
  const { store: slug, jobId } = await params;
  const member = await requireOwnerRole(slug);
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "orders").historyImport.job;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${member.store.slug}/orders/history-import`, label: w.back }} title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={member.store.slug} jobId={jobId} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, jobId, searchParams }: { storeSlug: string; jobId: string; searchParams: Props["searchParams"] }) {
  const member = await requireOwnerRole(storeSlug);
  if (!isJobId(jobId)) notFound();
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const shared = adminText(lang, "inventory").import;
  const job = await jobFor(member, jobId);
  if (!job || job.kind !== "order_history_import") notFound();
  const own = adminText(lang, "orders").historyImport;
  const query = await searchParams;
  const severity: SeverityFilter = severityFilterOf(typeof query.severity === "string" ? query.severity : undefined);
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const stage = importStage(job.status);
  const base = `/admin/${store.slug}/orders/history-import/${job.id}`;
  const showItems = stage === "checked" || stage === "done" || stage === "failed" || stage === "cancelled" || stage === "applying";
  const listed = showItems ? await listItems(store.id, job.id, { severity: severity === "all" ? undefined : severity, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }) : { items: [], total: 0 };
  const items: CustomerItem[] = listed.items.map((i) => ({
    seq: i.seq,
    rows: i.rows,
    outcome: i.outcome,
    will: typeof i.changes.will === "string" ? i.changes.will : null,
    file: i.kind === "file",
    messages: i.messages,
  }));
  const applied = appliedCountsOfJob(job.counts);
  const dry = historyDryCountsOf(job);
  const view = { id: job.id, kind: job.kind, status: job.status, phase: job.phase, rowsDone: job.rowsDone, rowsTotal: job.rowsTotal, problem: job.problem };
  const hrefFor = (q: { severity?: SeverityFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q.severity && q.severity !== "all") sp.set("severity", q.severity);
    if (q.page && q.page > 1) sp.set("page", String(q.page));
    const text = sp.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["inventory", "customers"])}>
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" aria-label={shared.job.file}>
        <span className="font-medium break-all">{job.inputName ?? own.job.title}</span>
        <span className="text-muted">{fillWords(shared.job.uploaded, { when: momentIn(job.createdAt, store.timeZone, ADMIN_LANG_FACTS[lang].locale) })}</span>
        <span className="text-muted">{shared.jobStatus[job.status]}</span>
      </section>

      {isWorking(job.status) && <JobTracker tickUrl={`${base}/tick`} initial={view} />}
      {isWorking(job.status) && (
        <div>
          <CancelJobButton cancel={cancelHistoryImportAction.bind(null, store.slug, job.id)} label={shared.job.cancelImport} />
        </div>
      )}
      {(stage === "failed" || stage === "cancelled" || stage === "expired") && <JobProgressView job={view} />}
      {stage === "cancelled" && <Notice>{shared.job.cancelled}</Notice>}
      {stage === "expired" && <Notice>{shared.job.expired}</Notice>}

      {(stage === "uploaded" || stage === "checked") && <CustomerCheck checked={stage === "checked"} check={checkHistoryImportAction.bind(null, store.slug, job.id)} />}
      {stage === "checked" && (
        <>
          <CustomerDryRun counts={{ toCreate: dry.toCreate, toUpdate: dry.already, withProblems: dry.withProblems }} lang={lang} words={own} />
          <CustomerImportApply
            counts={{ toCreate: dry.toCreate, toUpdate: 0, withProblems: dry.withProblems }}
            words={own}
            apply={applyHistoryImportAction.bind(null, store.slug, job.id)}
            cancel={cancelHistoryImportAction.bind(null, store.slug, job.id)}
          />
        </>
      )}
      {(stage === "applying" || stage === "done" || stage === "failed" || stage === "cancelled") && (stage === "done" || applied.created + applied.unchanged + applied.skipped + applied.failed > 0) && (
        <CustomerApplied counts={{ created: applied.created, updated: applied.unchanged, skipped: applied.skipped, failed: applied.failed }} written={stage === "done"} lang={lang} words={own} />
      )}

      {showItems && <CustomerFindings items={items} total={listed.total} severity={severity} page={page} pageSize={PAGE_SIZE} hrefFor={hrefFor} problemsHref={`${base}/problems`} lang={lang} words={own} />}
      <p className="text-sm">
        <Link href={`/admin/${store.slug}/orders`} className="underline underline-offset-2">
          {own.back}
        </Link>
      </p>
    </AdminTextScope>
  );
}
