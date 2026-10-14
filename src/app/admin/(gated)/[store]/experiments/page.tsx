import type { Metadata } from "next";
import Link from "next/link";

import { targetLabel } from "@/lib/ab-site";
import { GOAL_WORDS, STATUS_WORDS, type ExperimentStatus } from "@/lib/experiments";
import { requirePermission } from "@/server/permissions";
import { listExperiments } from "@/server/experiment-admin";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B tests" };

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

const BADGE: Record<ExperimentStatus, string> = {
  draft: "border border-line text-muted",
  scheduled: "bg-insight-soft text-insight-text",
  running: "bg-positive-soft text-positive-text",
  stopped: "bg-warning-soft text-warning-text",
  applied: "bg-brand text-brand-ink",
  discarded: "border border-line text-muted",
};

/** The store's A/B tests (D148): what is running, what waits to be started and what has been decided. */
export default async function ExperimentsPage({ params }: PageProps<"/admin/[store]/experiments">) {
  const { store } = await requirePermission((await params).store, "marketing:read");
  const tests = await listExperiments(store.id);
  const base = `/admin/${store.slug}/experiments`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="A/B tests"
          description={<>Try two versions of a page, a row or component of it, your header or footer, or a product layout on real visitors and keep the one that works better. Half of the visitors see it as it is, the other half a version you change; Kaizen counts who adds to the cart and who buys, and tells you in plain words when there is a winner. Only visitors who have accepted statistics cookies take part; everyone else sees the page as it is.</>}
        />
        <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          New test
        </Link>
      </div>
      {tests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          No tests yet. Pick a page, say what you want more of, and change one thing: a heading, a picture, a button.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
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
                <tr key={t.id} className="border-b border-line last:border-0">
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
