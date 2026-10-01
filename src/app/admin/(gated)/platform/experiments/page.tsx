import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { GOAL_WORDS, STATUS_WORDS, type ExperimentStatus } from "@/lib/experiments";
import { daysBetween } from "@/lib/platform-experiments";
import { requirePlatformAdmin } from "@/server/auth";
import { platformExperiments } from "@/server/platform-experiments";
import { platformUnitTests } from "@/server/platform-unit-tests";

export const metadata: Metadata = { title: "A/B tests" };

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

const BADGE: Record<ExperimentStatus, string> = {
  draft: "border border-border text-muted",
  scheduled: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  running: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  stopped: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  applied: "bg-foreground text-background",
  discarded: "border border-border text-muted",
};

const KIND_WORDS: Record<string, string> = { page: "Page", layout: "Product layout", header: "Header", footer: "Footer" };

/**
 * Every store's A/B tests (D148, phase 5): what is running, what waits for a decision and what needs a look. Read-only: a
 * platform admin spots a stuck or harmful test here and tells the store; the store's owner changes it.
 */
export default async function PlatformExperimentsPage({ searchParams }: PageProps<"/admin/platform/experiments">) {
  await connection();
  await requirePlatformAdmin();
  const { show } = await searchParams;
  const everything = show === "all";
  const [{ tests, overview, truncated }, own] = await Promise.all([platformExperiments(everything), platformUnitTests()]);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">A/B tests</h1>
        <p className="max-w-2xl text-sm text-muted">
          The A/B tests of every store. Tests that need a look come first: a version that lowers orders, visitors divided unevenly, a test
          nobody sees, one past its end or stopped and forgotten. You can read them here; the store&apos;s owner starts, stops and changes them.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Running", overview.running, `in ${overview.stores} ${overview.stores === 1 ? "store" : "stores"}`],
          ["Scheduled", overview.scheduled, "waiting for their start"],
          ["Stopped", overview.stopped, "waiting for a decision"],
          ["Need a look", overview.needAttention, "see the notes below"],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-lg border border-border bg-background p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-semibold">{value}</dd>
            <dd className="text-xs text-muted">{note}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3 text-sm">
        <Link href="/admin/platform/experiments" aria-current={everything ? undefined : "page"} className={everything ? "underline" : "font-medium"}>
          Active
        </Link>
        <Link href="/admin/platform/experiments?show=all" aria-current={everything ? "page" : undefined} className={everything ? "font-medium" : "underline"}>
          Everything
        </Link>
      </div>

      {tests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          {everything ? "No store has made a test yet." : "No test is running, scheduled or waiting for a decision."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="px-4 py-2 font-normal">Store</th>
                <th scope="col" className="px-4 py-2 font-normal">Test</th>
                <th scope="col" className="hidden px-4 py-2 font-normal md:table-cell">Goal</th>
                <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">Age</th>
                <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">Visitors</th>
                <th scope="col" className="px-4 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/admin/platform/stores/${t.store.slug}`} className="font-medium underline-offset-2 hover:underline">
                      {t.store.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="block text-xs text-muted">
                      {KIND_WORDS[t.target.type] ?? "Page"}
                      {t.target.type === "page" ? ` /${t.target.slug}` : ""} · {t.versions} versions
                    </span>
                    {t.headline && <span className="mt-1 block text-xs">{t.headline}</span>}
                    {t.flags.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-red-700 dark:text-red-300">
                        {t.flags.map((f) => (
                          <li key={f.kind}>{f.words}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">{GOAL_WORDS[t.goal].label}</td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    {t.startedAt ? `${daysBetween(t.startedAt, t.stoppedAt ?? now)} days` : t.scheduledStart ? `Starts ${date.format(t.scheduledStart)}` : "—"}
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    {t.exposed.toLocaleString("en-GB")}
                    {t.split && (
                      <span className="block text-xs text-muted">{t.split.map((s) => `${s.key.toUpperCase()} ${s.visitors.toLocaleString("en-GB")}`).join(" · ")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[t.status]}`}>
                      {STATUS_WORDS[t.status]}
                      {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                    </span>
                    {t.stopReason === "guardrail" && t.status === "stopped" && <span className="mt-1 block text-xs text-muted">Guardrail</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && <p className="text-sm text-muted">Only the newest 300 tests are shown.</p>}

      <section aria-labelledby="own" className="flex flex-col gap-3">
        <div>
          <h2 id="own" className="text-lg font-semibold">
            Tests that run on their own
          </h2>
          <p className="max-w-2xl text-sm text-muted">
            The search test and each store&apos;s held-out recommendations. They count searches and tabs, not visitors who accepted cookies, and keep no id of
            anyone; they are read here by the same arithmetic as a page test.
          </p>
        </div>
        {own.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
            No search test is running, and no store has recommendations with a held-out ranking and tabs to count.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
            {own.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {t.name}
                    {t.store && (
                      <>
                        {" · "}
                        <Link href={`/admin/platform/stores/${t.store.slug}`} className="underline-offset-2 hover:underline">
                          {t.store.name}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {t.kind === "search" ? (t.status === "running" ? `Running since ${date.format(t.startedAt ?? now)} · every store` : "Ended") : "Running all the time · last 30 days"}
                  </span>
                </div>
                <span>{t.headline}</span>
                <span className="text-xs text-muted">{t.detail}</span>
                {t.flags.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-300">
                    {t.flags.map((f) => (
                      <li key={f.kind}>{f.words}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
