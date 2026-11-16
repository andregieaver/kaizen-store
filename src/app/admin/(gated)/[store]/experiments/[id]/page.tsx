import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DraftActions, DraftPanel, TestActions } from "@/components/admin/experiment-controls";
import { ExperimentResultsView } from "@/components/admin/experiment-results-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { StepPath, type PathStep } from "@/components/admin/home/home-parts";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { experimentCard, type CardState, type ExperimentCard } from "@/lib/experiment-card";
import { experimentProblems, experimentProblemText, partLabelText, targetLabelText, variantNameText } from "@/lib/experiment-words";
import type { Signal } from "@/lib/admin-schemes";
import type { ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import { differenceLine } from "@/lib/version-difference-words";
import { requirePermission } from "@/server/permissions";
import { getExperiment, startProblemsOf, versionDifferences, type ExperimentInfo } from "@/server/experiment-admin";
import { experimentTraffic } from "@/server/experiment-traffic";
import { experimentResults } from "@/server/experiment-results";
import { Chip, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B test" };

const STATE_SIGNAL: Record<CardState, Signal> = {
  draft: "neutral",
  scheduled: "insight",
  learning: "warning",
  answer: "positive",
  broken: "danger",
  applied: "positive",
  discarded: "neutral",
};

/** The test's path (round 1's `StepPath`): made, started, learning, answer, decided, each with its caption. */
function pathOf(test: ExperimentInfo, card: ExperimentCard, w: ExperimentsMessages, date: (iso: string) => string, readyAround: string | null): PathStep[] {
  const p = w.card.path;
  const s = card.state;
  const started = test.status !== "draft" && test.status !== "scheduled";
  const decided = s === "applied" || s === "discarded";
  const answered = s === "answer" || decided;
  return [
    { label: p.made, caption: date(test.createdAt), state: "done" },
    {
      label: p.started,
      caption: test.startedAt ? date(test.startedAt) : test.scheduledStart ? fillWords(p.startsOn, { date: date(test.scheduledStart) }) : undefined,
      state: started ? "done" : "current",
    },
    {
      label: p.learning,
      caption: started && !answered ? fillWords(p.dayOf, { days: card.progress.days, min: card.progress.minDays }) : undefined,
      state: !started ? "todo" : answered || card.progress.reached || s === "broken" ? "done" : "current",
    },
    {
      label: p.answer,
      caption: s === "broken" ? p.wrong : answered ? p.ready : readyAround ? fillWords(p.around, { date: readyAround }) : undefined,
      state: answered ? "done" : s === "broken" ? "current" : "todo",
    },
    {
      label: p.decided,
      caption: s === "applied" ? fillWords(p.used, { name: test.variants.find((v) => v.key === test.appliedVariant)?.name ?? "" }) : s === "discarded" ? p.kept : undefined,
      state: decided ? "done" : answered && test.status === "stopped" ? "current" : "todo",
    },
  ];
}

/** One A/B test (D148, a record since D657): set up while it is a draft; once started, its stage, path, answer and the one next step. */
export default async function ExperimentPage({ params }: PageProps<"/admin/[store]/experiments/[id]">) {
  const { store: slug, id } = await params;
  const { store, account } = await requirePermission(slug, "marketing:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const date = (iso: string) => dateFormat.format(new Date(iso));
  const test = await getExperiment(store.id, id);
  if (!test) notFound();
  const base = `/admin/${store.slug}/experiments`;
  const goal = w.goals[test.goal];
  const now = new Date();
  const started = test.status !== "draft" && test.status !== "scheduled";
  const [results, differences] = started
    ? await Promise.all([experimentResults(store, test, now, { words: w, numberLocale: locale }), versionDifferences(store.id, test)])
    : [null, {}];
  const card = experimentCard({ status: test.status, goal: test.goal, minDays: test.minDays, minVisitors: test.minVisitors, results, now });
  const readyAround = card.progress.readyAround ? date(`${card.progress.readyAround}T12:00:00Z`) : null;
  const builder = adminText(lang, "builder");
  const differenceWords = Object.fromEntries(Object.entries(differences).map(([key, list]) => [key, list.map((d) => differenceLine(d, builder))]));
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
  const target = targetLabelText(test.page.kind, test.page.slug, test.page.title, test.page.role, w);
  const ended = test.status === "applied"
    ? fillWords(w.card.actions.applied, { name: shown.variants.find((v) => v.key === test.appliedVariant)?.name ?? w.run.aVersion })
    : test.status === "discarded"
      ? w.card.actions.discarded
      : test.stopReason === "guardrail"
        ? w.card.actions.guardrail
        : test.status === "stopped" && test.stopReason === "planned_end"
          ? w.card.actions.plannedStop
          : null;

  if (test.status === "draft") {
    // A draft as a record (D658): what stands in the way of a start, what each version changes, and how long it takes at the shop's traffic.
    const [left, changes, traffic] = await Promise.all([
      startProblemsOf(store.id, test.id),
      versionDifferences(store.id, test),
      experimentTraffic(store, [{ id: test.page.id, slug: test.page.slug, title: test.page.title, kind: test.page.kind, role: test.page.role }]),
    ]);
    // The checklist says a version is unchanged and the page unpublished itself; the rest of what the start checks found is listed under it.
    const shownByChecklist = (p: string) => /still the same as the original|^Publish the page before testing it|^Choose the (button|form)/.test(p);
    const problems = experimentProblems(left.filter((p) => !shownByChecklist(p)), w);
    const changeWords = Object.fromEntries(Object.entries(changes).map(([key, list]) => [key, list.map((d) => differenceLine(d, builder))]));
    const allChanged = test.variants.every((v) => v.key === "a" || v.changed);
    const steps: PathStep[] = [
      { label: w.card.path.made, caption: date(test.createdAt), state: "done" },
      { label: w.draftCard.pathChange, state: allChanged ? "done" : "current" },
      { label: w.draftCard.pathStart, state: allChanged ? "current" : "todo" },
      { label: w.card.path.learning, state: "todo" },
      { label: w.card.path.answer, state: "todo" },
    ];
    return (
      <AdminTextScope texts={adminTexts(lang, ["experiments"])}>
        <div className="flex flex-col gap-6">
          <PageHeader
            back={{ href: base, label: w.page.back }}
            eyebrow={w.card.eyebrow}
            status={
              <Chip signal="neutral" dot>
                {w.card.states.draft}
              </Chip>
            }
            title={<>{test.name}</>}
            meta={[target, part && fillWords(w.page.testing, { part }), goal.label]}
            description={test.hypothesis ? <>&ldquo;{test.hypothesis}&rdquo;</> : undefined}
            actions={<DraftActions store={store.slug} test={shown} ready={left.length === 0} />}
          />
          <StepPath label={w.card.path.label} steps={steps} />
          <DraftPanel store={store.slug} test={shown} markets={markets} differences={changeWords} problems={problems} ready={left.length === 0} traffic={traffic} />
        </div>
      </AdminTextScope>
    );
  }

  return (
    <AdminTextScope texts={adminTexts(lang, ["experiments"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: w.page.back }}
          eyebrow={w.card.eyebrow}
          status={
            <Chip signal={STATE_SIGNAL[card.state]} dot>
              {w.card.states[card.state]}
            </Chip>
          }
          title={<>{test.name}</>}
          meta={[target, part && fillWords(w.page.testing, { part }), goal.label]}
          description={
            (test.hypothesis || ended) && (
              <>
                {test.hypothesis && <span className="block">&ldquo;{test.hypothesis}&rdquo;</span>}
                {ended && <span className="block text-ink">{ended}</span>}
              </>
            )
          }
          actions={<TestActions store={store.slug} test={shown} next={card.next} best={card.best} />}
        />
        <StepPath label={w.card.path.label} steps={pathOf(test, card, w, date, readyAround)} />
        {test.status === "scheduled" && (
          <p className="max-w-[75ch] text-body text-ink-2">
            {w.run.scheduledText}
          </p>
        )}
        {results && (
          <ExperimentResultsView
            test={shown}
            results={results}
            card={card}
            differences={differenceWords}
            base={base}
            locale={store.markets[0]?.locale ?? "nb-NO"}
            words={w}
            numberLocale={locale}
            readyAround={readyAround}
          />
        )}
      </div>
    </AdminTextScope>
  );
}
