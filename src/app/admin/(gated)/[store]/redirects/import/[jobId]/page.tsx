import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { FindingItem } from "@/components/admin/data/findings-table";
import { CancelJobButton } from "@/components/admin/data/import-flow";
import { JobTracker } from "@/components/admin/data/job-tracker";
import { JobProgressView } from "@/components/admin/data/job-views";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { RedirectImportApply, RedirectImportOptions } from "@/components/admin/redirects/redirect-import-flow";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { RedirectApplied, RedirectDryRun, RedirectFindings } from "@/components/admin/redirects/redirect-import-views";
import { appliedCountsOfJob, importStage, isWorking, momentText, severityFilterOf, type SeverityFilter } from "@/lib/data-admin";
import { STATUS_WORDS } from "@/lib/data-job";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { pageOf, redirectPaths } from "@/lib/redirect-admin";
import { parseRedirectOptions } from "@/lib/redirect-plan";
import { isJobId, listItems } from "@/server/data-job-store";
import { jobFor, redirectDryCountsOf } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";

import { applyRedirectImportAction, cancelRedirectImportAction, checkRedirectImportAction } from "../actions";

export const metadata: Metadata = { title: "Redirect import" };

type Props = PageProps<"/admin/[store]/redirects/import/[jobId]">;

const PAGE_SIZE = 50;

/**
 * One redirect import (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4): the file, its option, the dry run's findings and counts line by line, the
 * apply with its confirmation, the progress while it works, and the result. The page keeps the job going while it is open (`JobTracker`); the five-minute job
 * takes it up if the page is closed. A job of another store, or of another kind, is a 404, the same as an id that is none.
 */
export default async function RedirectImportJobPage({ params, searchParams }: Props) {
  const { store: slug, jobId } = await params;
  const { store, account } = await requirePermission(slug, "website:read");
  const w = adminText(adminLangOf(account.adminLocale), "redirects");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="import"
        title={w.import.jobTitle}
        intro={w.import.jobIntro}
        back={{ href: redirectPaths(store.slug).import, label: w.import.title }}
        words={w}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} jobId={jobId} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, jobId, searchParams }: { storeSlug: string; jobId: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  if (!memberCan(member, "website:write") || !isJobId(jobId)) notFound();
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "redirects");
  const i = w.import;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const job = await jobFor(member, jobId);
  if (!job || job.kind !== "redirect_import") notFound();
  const query = await searchParams;
  const severity: SeverityFilter = severityFilterOf(typeof query.severity === "string" ? query.severity : undefined);
  const page = pageOf(typeof query.page === "string" ? query.page : "1");
  const stage = importStage(job.status);
  const base = `${redirectPaths(store.slug).import}/${job.id}`;
  const showItems = stage === "checked" || stage === "done" || stage === "failed" || stage === "cancelled" || stage === "applying";
  const listed = showItems ? await listItems(store.id, job.id, { severity: severity === "all" ? undefined : severity, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }) : { items: [], total: 0 };
  const items: FindingItem[] = listed.items.map((i) => ({
    seq: i.seq,
    ref: i.kind === "file" ? null : i.ref,
    rows: i.rows,
    outcome: i.outcome,
    will: typeof i.changes.will === "string" ? i.changes.will : null,
    messages: i.messages,
  }));
  const options = parseRedirectOptions(job.options);
  const applied = appliedCountsOfJob(job.counts);
  const dry = redirectDryCountsOf(job);
  const view = { id: job.id, kind: job.kind, status: job.status, phase: job.phase, rowsDone: job.rowsDone, rowsTotal: job.rowsTotal, problem: job.problem };
  const hrefFor = (q: { severity?: SeverityFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q.severity && q.severity !== "all") sp.set("severity", q.severity);
    if (q.page && q.page > 1) sp.set("page", String(q.page));
    const text = sp.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["redirects"])}>
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" aria-label={i.theFile}>
        <span className="font-medium break-all">{job.inputName ?? i.redirectFile}</span>
        {job.rowsTotal !== null && stage !== "uploaded" && <span className="text-muted">{fillWords(i.lines, { n: job.rowsTotal.toLocaleString(locale) })}</span>}
        <span className="text-muted">{fillWords(i.uploaded, { when: momentText(job.createdAt, store.timeZone, locale) })}</span>
        <span className="text-muted">{STATUS_WORDS[job.status]}</span>
      </section>

      {isWorking(job.status) && <JobTracker tickUrl={`${base}/tick`} initial={view} />}
      {isWorking(job.status) && (
        <div>
          <CancelJobButton cancel={cancelRedirectImportAction.bind(null, store.slug, job.id)} label={i.cancelImport} />
        </div>
      )}
      {(stage === "failed" || stage === "cancelled" || stage === "expired") && <JobProgressView job={view} />}
      {stage === "cancelled" && <Notice>{i.cancelled}</Notice>}
      {stage === "expired" && <Notice>{i.expired}</Notice>}

      {(stage === "uploaded" || stage === "checked") && (
        <RedirectImportOptions initial={options.existing} checked={stage === "checked"} check={checkRedirectImportAction.bind(null, store.slug, job.id)} />
      )}
      {stage === "checked" && (
        <>
          <RedirectDryRun counts={dry} words={w} locale={locale} />
          <RedirectImportApply counts={dry} apply={applyRedirectImportAction.bind(null, store.slug, job.id)} cancel={cancelRedirectImportAction.bind(null, store.slug, job.id)} />
          <p className="text-sm text-muted">{i.changedOption}</p>
        </>
      )}
      {(stage === "applying" || stage === "done" || stage === "failed" || stage === "cancelled") && (stage === "done" || Object.values(applied).some((n) => n > 0)) && (
        <RedirectApplied counts={applied} jobId={job.id} written={stage === "done"} words={w} locale={locale} />
      )}

      {showItems && (
        <RedirectFindings items={items} total={listed.total} severity={severity} page={page} pageSize={PAGE_SIZE} hrefFor={hrefFor} problemsHref={`${base}/problems`} words={w} locale={locale} />
      )}
      <p className="text-sm">
        <Link href={redirectPaths(store.slug).list} className="underline underline-offset-2">
          {w.common.backToList}
        </Link>
      </p>
    </AdminTextScope>
  );
}
