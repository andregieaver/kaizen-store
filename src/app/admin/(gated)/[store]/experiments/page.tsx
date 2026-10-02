import type { Metadata } from "next";
import Link from "next/link";

import { targetLabel } from "@/lib/ab-site";
import { GOAL_WORDS, STATUS_WORDS, type ExperimentStatus } from "@/lib/experiments";
import { requireMember } from "@/server/auth";
import { listExperiments } from "@/server/experiment-admin";

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

/** The store's A/B tests (D148): what is running, what waits to be started and what has been decided. */
export default async function ExperimentsPage({ params }: PageProps<"/admin/[store]/experiments">) {
  const { store } = await requireMember((await params).store);
  const tests = await listExperiments(store.id);
  const base = `/admin/${store.slug}/experiments`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">A/B tests</h1>
          <p className="max-w-2xl text-sm text-muted">
            Try two versions of a page, a row or component of it, your header or footer, or a product layout on real visitors and keep the one that works better.
            Half of the visitors see it as it is, the other half a version you change; Kaizen counts who adds to the cart and who buys, and tells you in plain words when there is a winner. Only visitors who have
            accepted statistics cookies take part; everyone else sees the page as it is.
          </p>
        </div>
        <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background">
          New test
        </Link>
      </div>
      {tests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No tests yet. Pick a page, say what you want more of, and change one thing: a heading, a picture, a button.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="px-4 py-2 font-normal">Test</th>
                <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">Page</th>
                <th scope="col" className="hidden px-4 py-2 font-normal md:table-cell">Goal</th>
                <th scope="col" className="hidden px-4 py-2 font-normal md:table-cell">Started</th>
                <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">Visitors</th>
                <th scope="col" className="px-4 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${t.id}`} className="font-medium underline-offset-2 hover:underline">
                      {t.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      {t.part ? `${t.part.label} · ` : ""}
                      {t.variants.length} versions
                    </span>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">{targetLabel(t.page.kind, t.page.slug, t.page.title, t.page.role)}</td>
                  <td className="hidden px-4 py-2 md:table-cell">{GOAL_WORDS[t.goal].label}</td>
                  <td className="hidden px-4 py-2 md:table-cell">
                    {t.startedAt ? date.format(new Date(t.startedAt)) : t.scheduledStart ? `Starts ${date.format(new Date(t.scheduledStart))}` : "—"}
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">{t.exposed.toLocaleString("en-GB")}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[t.status]}`}>
                      {STATUS_WORDS[t.status]}
                      {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
