import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DraftPanel, RunPanel } from "@/components/admin/experiment-controls";
import { ExperimentResultsView } from "@/components/admin/experiment-results-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { experimentProblemText, partLabelText, targetLabelText, variantNameText } from "@/lib/experiment-words";
import { requirePermission } from "@/server/permissions";
import { getExperiment } from "@/server/experiment-admin";
import { experimentResults } from "@/server/experiment-results";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B test" };

/** One A/B test (D148): set up while it is a draft, watched and decided once it has started. */
export default async function ExperimentPage({ params }: PageProps<"/admin/[store]/experiments/[id]">) {
  const { store: slug, id } = await params;
  const { store, account } = await requirePermission(slug, "marketing:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const test = await getExperiment(store.id, id);
  if (!test) notFound();
  const base = `/admin/${store.slug}/experiments`;
  const goal = w.goals[test.goal];
  const results = test.status === "draft" || test.status === "scheduled" ? null : await experimentResults(store, test, new Date(), { words: w, numberLocale: locale });
  const part = test.part ? partLabelText(test.part.label, w) : null;
  // What the page's parts read: the test's own words in the language (its part's label, its versions' names and a stored schedule problem).
  const shown = {
    ...test,
    part: test.part ? { ...test.part, label: part ?? test.part.label } : test.part,
    variants: test.variants.map((v) => ({ ...v, name: variantNameText(v.name, w) })),
    scheduleProblem: test.scheduleProblem ? experimentProblemText(test.scheduleProblem, w) : test.scheduleProblem,
  };
  const seen = new Set<string>();
  const markets = store.markets.flatMap((m) => (seen.has(m.code) ? [] : (seen.add(m.code), [{ code: m.code.toLowerCase(), name: m.name }])));

  return (
    <AdminTextScope texts={adminTexts(lang, ["experiments"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <PageHeader
          back={{ href: base, label: w.page.back }}
          title={<>{test.name}</>}
          description={
            <>
              {w.status[test.status]} · {targetLabelText(test.page.kind, test.page.slug, test.page.title, test.page.role, w)}
              {part && ` · ${fillWords(w.page.testing, { part })}`} · {goal.label}
              {test.startedAt && ` · ${fillWords(w.page.started, { date: date.format(new Date(test.startedAt)) })}`}
              {test.stoppedAt && ` · ${fillWords(w.page.stopped, { date: date.format(new Date(test.stoppedAt)) })}`}
            </>
          }
        />
        {test.hypothesis && <p className="max-w-3xl text-sm">&ldquo;{test.hypothesis}&rdquo;</p>}
      </div>
      {test.status === "draft" ? (
        <DraftPanel store={store.slug} test={shown} markets={markets} />
      ) : (
        <>
          <RunPanel store={store.slug} test={shown} />
          {results && <ExperimentResultsView test={shown} results={results} locale={store.markets[0]?.locale ?? "nb-NO"} words={w} numberLocale={locale} />}
        </>
      )}
    </div>
    </AdminTextScope>
  );
}
