import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, secondary } from "@/components/admin/data/ui";
import { NotFoundTable } from "@/components/admin/redirects/not-found-table";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { NOT_FOUND_SCREEN_ROWS, NOT_FOUND_WINDOWS } from "@/lib/data-limits";
import { WINDOW_ORDER, redirectPaths, reportHref, reportSummaryWords, uncountedWords, windowWords } from "@/lib/redirect-admin";
import { redirectSentences } from "@/lib/redirects";
import { notFoundReport } from "@/server/not-found";
import { memberCan, requirePermission } from "@/server/permissions";

import { ignoreMissingAction, redirectMissingAction, restoreMissingAction } from "./actions";

export const metadata: Metadata = { title: "Pages not found" };

type Props = PageProps<"/admin/[store]/redirects/404s">;

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

/**
 * The report of pages not found (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.3): the addresses shoppers and robots asked for that the store did
 * not have and no redirect covered, for the last 7, 30 or 90 days, most asked first. Each row offers up to three suggested targets as one-click redirects
 * (found in code from the store's own addresses), a short form for another target, and Ignore. The counts are what the server saw, so they say "at least"; a
 * file of the report downloads at once. Needs the right to read the website; changing needs the right to change it. The report holds addresses and counts,
 * never an IP address, a user agent, a cookie, a referrer or a query string.
 */
export default async function NotFoundReportPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "website:read");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="report"
        title="Pages not found"
        intro="The addresses shoppers and search engines asked for that this store did not have. Fix the ones that matter with a redirect to the page they were looking for."
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  const { store } = member;
  const query = await searchParams;
  const asked = Number.parseInt(first(query.days), 10);
  const days = (NOT_FOUND_WINDOWS as readonly number[]).includes(asked) ? asked : NOT_FOUND_WINDOWS[0];
  const showCovered = first(query.covered) === "1";
  const showIgnored = first(query.ignored) === "1";
  const canWrite = memberCan(member, "website:write");
  const report = await notFoundReport(member, { days, showCovered, showIgnored });
  const base = redirectPaths(store.slug).report;
  const uncounted = report ? uncountedWords(report.uncounted) : null;
  const actions = {
    redirect: redirectMissingAction.bind(null, store.slug),
    ignore: ignoreMissingAction.bind(null, store.slug),
    restore: restoreMissingAction.bind(null, store.slug),
  };
  return (
    <>
      <nav aria-label="Period" className="flex flex-wrap items-center gap-2 text-sm">
        {WINDOW_ORDER.map((d) => (
          <Link key={d} href={reportHref(base, { days: d, covered: showCovered, ignored: showIgnored })} aria-current={days === d ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-surface aria-[current=page]:font-semibold">
            {windowWords(d)}
          </Link>
        ))}
        <span className="mx-2 text-muted" aria-hidden="true">
          |
        </span>
        <Link href={reportHref(base, { days, covered: !showCovered, ignored: showIgnored })} className="underline underline-offset-2">
          {showCovered ? "Hide the addresses that have a redirect" : "Show the addresses that have a redirect"}
        </Link>
        <Link href={reportHref(base, { days, covered: showCovered, ignored: !showIgnored })} className="underline underline-offset-2">
          {showIgnored ? "Hide the ignored addresses" : "Show the ignored addresses"}
        </Link>
        <form method="post" action={`${base}/export`} className="ml-auto">
          <input type="hidden" name="days" value={days} />
          {showCovered && <input type="hidden" name="covered" value="1" />}
          {showIgnored && <input type="hidden" name="ignored" value="1" />}
          <button type="submit" className={secondary}>
            Download as CSV
          </button>
        </form>
      </nav>
      {report === null ? null : (
        <>
          <p className="text-sm" role="status">
            {reportSummaryWords(report.rows.length, report.distinct, days)}
          </p>
          {uncounted && <p className={`${card} !p-3 text-sm`}>{uncounted}</p>}
          {report.rows.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">
              {report.distinct === 0 && !showCovered && !showIgnored
                ? "Nothing to fix. Addresses that were asked for and not found will be listed here, most asked first."
                : "No address to show with these choices."}
            </p>
          ) : (
            <NotFoundTable
              rows={report.rows.map((r) => ({ path: r.path, requests: r.requests, crawlers: r.crawlers, lastAsked: r.lastAsked, covered: r.covered, ignored: r.ignored, suggestions: r.suggestions.map((s) => ({ kind: s.kind, path: s.path, title: s.title })) }))}
              timeZone={store.timeZone}
              actions={actions}
              canWrite={canWrite}
            />
          )}
          {report.rows.length >= NOT_FOUND_SCREEN_ROWS && <p className={hint}>The {NOT_FOUND_SCREEN_ROWS.toLocaleString("en-GB")} most asked-for addresses are shown. The file has up to 5,000.</p>}
          <Notice title="How to read the counts">
            <ul className="list-disc pl-5">
              <li>
                {redirectSentences.atLeast} Requests are counted as the server saw them, at most once a second for each address, so a count is at least what happened.
              </li>
              <li>{report.note}</li>
              <li>Only the address and the day are kept, for 90 days: no IP address, browser, cookie, referrer or query string. Addresses that could identify a person, working pages and the files robots probe for are never recorded.</li>
              <li>Suggestions are found from your own products, categories, tags, pages and articles by comparing words, never by an AI. Look at the target before you press: a redirect is permanent.</li>
            </ul>
          </Notice>
        </>
      )}
    </>
  );
}
