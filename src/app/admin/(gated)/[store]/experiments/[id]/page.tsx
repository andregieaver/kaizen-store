import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftPanel, RunPanel } from "@/components/admin/experiment-controls";
import { ExperimentResultsView } from "@/components/admin/experiment-results-view";
import { GOAL_WORDS, STATUS_WORDS } from "@/lib/experiments";
import { requireMember } from "@/server/auth";
import { getExperiment } from "@/server/experiment-admin";
import { experimentResults } from "@/server/experiment-results";

export const metadata: Metadata = { title: "A/B test" };

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

/** One A/B test (D148): set up while it is a draft, watched and decided once it has started. */
export default async function ExperimentPage({ params }: PageProps<"/admin/[store]/experiments/[id]">) {
  const { store: slug, id } = await params;
  const { store } = await requireMember(slug);
  const test = await getExperiment(store.id, id);
  if (!test) notFound();
  const base = `/admin/${store.slug}/experiments`;
  const goal = GOAL_WORDS[test.goal];
  const results = test.status === "draft" || test.status === "scheduled" ? null : await experimentResults(store, test);
  const seen = new Set<string>();
  const markets = store.markets.flatMap((m) => (seen.has(m.code) ? [] : (seen.add(m.code), [{ code: m.code.toLowerCase(), name: m.name }])));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={base} className="w-fit text-sm underline">
          A/B tests
        </Link>
        <h1 className="text-2xl font-semibold">{test.name}</h1>
        <p className="text-sm text-muted">
          {STATUS_WORDS[test.status]} · /{test.page.slug}
          {test.part && ` · testing ${test.part.label}`} · {goal.label}
          {test.startedAt && ` · started ${date.format(new Date(test.startedAt))}`}
          {test.stoppedAt && ` · stopped ${date.format(new Date(test.stoppedAt))}`}
        </p>
        {test.hypothesis && <p className="max-w-3xl text-sm">&ldquo;{test.hypothesis}&rdquo;</p>}
      </div>
      {test.status === "draft" ? (
        <DraftPanel store={store.slug} test={test} markets={markets} />
      ) : (
        <>
          <RunPanel store={store.slug} test={test} />
          {results && <ExperimentResultsView test={test} results={results} locale={store.markets[0]?.locale ?? "nb-NO"} />}
        </>
      )}
    </div>
  );
}
