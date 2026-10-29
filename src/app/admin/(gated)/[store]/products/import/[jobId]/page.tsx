import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { FindingsTable, type FindingItem } from "@/components/admin/data/findings-table";
import { CancelJobButton, ImportApply, ImportOptionsForm } from "@/components/admin/data/import-flow";
import { AppliedSummary, DryRunSummary } from "@/components/admin/data/import-summary";
import { JobTracker } from "@/components/admin/data/job-tracker";
import { JobProgressView } from "@/components/admin/data/job-views";
import { DataPageHead, DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { appliedCountsOfJob, dryCountsOfJob, importStage, isWorking, momentText, severityFilterOf, type SeverityFilter } from "@/lib/data-admin";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { parseImportOptions } from "@/lib/product-import";
import { isJobId, listItems } from "@/server/data-job-store";
import { jobFor } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";
import { getEditorContext } from "@/server/products";

import { applyImportAction, cancelImportAction, checkImportAction } from "../actions";

export const metadata: Metadata = { title: "Import products" };

type Props = PageProps<"/admin/[store]/products/import/[jobId]">;

const PAGE_SIZE = 50;

/**
 * One product import (wave 2, D165, `docs/wave-2-data.md` 2.2): the file, the options, the dry run's findings and counts, the apply with its confirmation,
 * the progress while it works, and the result. The page keeps the job going while it is open (`JobTracker`); the five-minute job takes it up if the page is
 * closed. A job of another store is a 404, the same as an id that is none.
 */
export default async function ImportJobPage({ params, searchParams }: Props) {
  const { store: slug, jobId } = await params;
  const gated = await requirePermission(slug, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const w = adminText(adminLangOf(gated.account.adminLocale), "products").jobPage;
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead backHref={`/admin/${store.slug}/products/import`} backLabel={w.back} title={w.title} intro={w.intro} />
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
  const job = await jobFor(member, jobId);
  if (!job || job.kind !== "product_import") notFound();
  const query = await searchParams;
  const severity: SeverityFilter = severityFilterOf(typeof query.severity === "string" ? query.severity : undefined);
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const stage = importStage(job.status);
  const base = `/admin/${store.slug}/products/import/${job.id}`;
  const showItems = stage === "checked" || stage === "done" || stage === "failed" || stage === "cancelled" || stage === "applying";
  const listed = showItems ? await listItems(store.id, job.id, { severity: severity === "all" ? undefined : severity, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }) : { items: [], total: 0 };
  const items: FindingItem[] = listed.items.map((i) => ({
    seq: i.seq,
    ref: i.ref,
    rows: i.rows,
    outcome: i.outcome,
    will: typeof i.changes.will === "string" ? i.changes.will : null,
    messages: i.messages,
  }));
  const options = parseImportOptions(job.options);
  const editor = stage === "uploaded" || stage === "checked" ? await getEditorContext(store) : null;
  const applied = appliedCountsOfJob(job.counts);
  const dry = dryCountsOfJob(job.counts);
  const view = { id: job.id, kind: job.kind, status: job.status, phase: job.phase, rowsDone: job.rowsDone, rowsTotal: job.rowsTotal, problem: job.problem };
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "products");
  const w = all.jobPage;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const hrefFor = (q: { severity?: SeverityFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q.severity && q.severity !== "all") sp.set("severity", q.severity);
    if (q.page && q.page > 1) sp.set("page", String(q.page));
    const text = sp.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["products"])}>
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" aria-label={w.theFile}>
        <span className="font-medium break-all">{job.inputName ?? w.productFile}</span>
        <span className="text-muted">{job.format === "shopify" ? w.shopifyFile : job.format === "woocommerce" ? w.woocommerceFile : w.kaizenFile}</span>
        <span className="text-muted">{fillWords(w.uploaded, { moment: momentText(job.createdAt, store.timeZone, locale) })}</span>
        <span className="text-muted">{all.jobStatus[job.status]}</span>
      </section>

      {isWorking(job.status) && <JobTracker tickUrl={`${base}/tick`} initial={view} />}
      {isWorking(job.status) && (
        <div>
          <CancelJobButton cancel={cancelImportAction.bind(null, store.slug, job.id)} label={w.cancel} stopping={w.stopping} />
        </div>
      )}
      {(stage === "failed" || stage === "cancelled" || stage === "expired") && <JobProgressView job={view} />}
      {stage === "cancelled" && <Notice>{w.cancelled}</Notice>}
      {stage === "expired" && <Notice>{w.expired}</Notice>}

      {(stage === "uploaded" || stage === "checked") && editor && (
        <ImportOptionsForm
          checked={stage === "checked"}
          check={checkImportAction.bind(null, store.slug, job.id)}
          choices={{
            format: job.format === "shopify" || job.format === "woocommerce" ? job.format : "kaizen",
            markets: editor.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency })),
            operators: editor.operators.map((o) => ({ id: o.id, name: o.name })),
            initial: options,
            audience: editor.audience,
          }}
        />
      )}
      {stage === "checked" && (
        <>
          <DryRunSummary counts={dry} words={all.summary} locale={locale} />
          <ImportApply counts={dry} apply={applyImportAction.bind(null, store.slug, job.id)} cancel={cancelImportAction.bind(null, store.slug, job.id)} />
          <p className="text-sm text-muted">{w.changedOption}</p>
        </>
      )}
      {(stage === "applying" || stage === "done" || stage === "failed" || stage === "cancelled") && (stage === "done" || Object.values(applied).some((n) => n > 0)) && (
        <AppliedSummary counts={applied} jobId={job.id} written={stage === "done"} words={all.summary} locale={locale} />
      )}

      {showItems && (
        <FindingsTable
          items={items}
          total={listed.total}
          severity={severity}
          page={page}
          pageSize={PAGE_SIZE}
          hrefFor={hrefFor}
          problemsHref={`${base}/problems`}
          words={adminText(lang, "bookings").findings}
        />
      )}
      <p className="text-sm">
        <Link href={`/admin/${store.slug}/products`} className="underline underline-offset-2">
          {w.backToProducts}
        </Link>
      </p>
    </AdminTextScope>
  );
}
