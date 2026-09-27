import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { MIN_PER_ARM, rate, type Verdict } from "@/lib/experiment-stats";
import { experimentResults, listExperiments, type Comparison, type ExperimentResults } from "@/server/search-experiment";

import { startSearchTestAction, stopSearchTestAction } from "./actions";

export const metadata: Metadata = { title: "Search test" };

const card = "rounded-lg border border-border bg-background p-5";
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)} %`;
const points = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} points`;
const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

const VERDICTS: Record<Verdict, string> = {
  few: `Too few searches yet: at least ${MIN_PER_ARM} in each arm.`,
  better: "Hybrid is better: the whole interval is on hybrid's side.",
  worse: "Hybrid is worse: the whole interval is on keyword's side.",
  even: "No clear difference yet: the interval spans both sides.",
  broken: "Not to be trusted: the split between the arms is off (see the check above).",
};

/**
 * The search test (Phase 2, S5, D77): start it with the share of searches
 * given keyword search alone, and read how hybrid and keyword search
 * compare. Every store's searches take part while it runs.
 */
export default async function SearchTestPage({ searchParams }: PageProps<"/admin/platform/search-test">) {
  const { id } = await searchParams;
  const experiments = await listExperiments();
  const running = experiments.find((e) => e.endedAt === null) ?? null;
  const shown = experiments.find((e) => e.id === id) ?? running ?? experiments[0] ?? null;
  const results = shown ? await experimentResults(shown) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Search test</h1>
        <p className="text-sm text-muted">
          Does hybrid search (words, meaning and understanding) help shoppers more than keyword search alone? While a test runs,
          each search in every store is given one of the two at random. No cookie is set: the unit is the search, and opening a
          result is recorded by the result&apos;s link.
        </p>
      </div>

      <section aria-labelledby="run" className={card}>
        <h2 id="run" className="mb-2 font-medium">
          {running ? "Running" : "Start a test"}
        </h2>
        {running ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Since {date(running.startedAt)}, {percent(running.keywordShare, 0)} of searches get keyword search alone. Run it for
              at least two full weeks, and read it week by week.
            </p>
            <DeleteDiscountButton
              action={stopSearchTestAction}
              code="the search test"
              label="Stop the test"
              question="Stop the search test? Every search gets hybrid search again. The results stay."
            />
          </div>
        ) : (
          <ActionForm action={startSearchTestAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Share of searches given keyword search alone (%)
              <input
                name="keywordPercent"
                type="number"
                min={5}
                max={95}
                step={1}
                defaultValue={50}
                required
                className="min-h-10 w-32 rounded-md border border-border bg-background px-3"
              />
              <span className="font-normal text-muted">
                Half and half finds a difference soonest. A smaller share costs fewer shoppers the better search, if hybrid
                is better, and takes longer.
              </span>
            </label>
            <div>
              <SubmitButton>Start the test</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      {results && <Results results={results} />}

      {experiments.length > 1 && (
        <section aria-labelledby="earlier" className={card}>
          <h2 id="earlier" className="mb-2 font-medium">
            Tests
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {experiments.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/platform/search-test?id=${e.id}`} className="underline" aria-current={e.id === shown?.id ? "page" : undefined}>
                  {date(e.startedAt)} – {e.endedAt ? date(e.endedAt) : "running"}
                </Link>{" "}
                <span className="text-muted">({percent(e.keywordShare, 0)} keyword)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Results({ results }: { results: ExperimentResults }) {
  const { arms, srmP } = results;
  const row = (name: string, comparison: Comparison, betterIs: string) => (
    <tr key={name} className="border-t border-border align-top">
      <th scope="row" className="py-2 pr-4 text-left font-medium">
        {name}
        <span className="block text-xs font-normal text-muted">{betterIs}</span>
      </th>
      <td className="py-2 pr-4 tabular-nums">{percent(rate(comparison.keyword))}</td>
      <td className="py-2 pr-4 tabular-nums">{percent(rate(comparison.hybrid))}</td>
      <td className="py-2 pr-4 tabular-nums">
        {comparison.diff ? (
          <>
            {points(comparison.diff.diff)}
            <span className="block text-xs text-muted">
              95 %: {points(comparison.diff.low)} to {points(comparison.diff.high)}
            </span>
          </>
        ) : (
          "–"
        )}
      </td>
      <td className="py-2">{VERDICTS[comparison.verdict]}</td>
    </tr>
  );
  return (
    <section aria-labelledby="results" className={card}>
      <h2 id="results" className="mb-1 font-medium">
        Results{results.experiment.endedAt ? "" : " so far"}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {arms.keyword.searches} searches with keyword search, {arms.hybrid.searches} with hybrid.{" "}
        {srmP < 0.001 ? (
          <strong className="text-red-700 dark:text-red-400">
            The split does not match the share asked for (p = {srmP.toExponential(1)}): something is dropping or double-counting
            searches, and the results cannot be trusted until it is found.
          </strong>
        ) : (
          `The split matches the share asked for (p = ${srmP.toFixed(2)}).`
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">Measure</th>
              <th scope="col" className="py-2 pr-4 font-medium">Keyword</th>
              <th scope="col" className="py-2 pr-4 font-medium">Hybrid</th>
              <th scope="col" className="py-2 pr-4 font-medium">Difference</th>
              <th scope="col" className="py-2 font-medium">Reading</th>
            </tr>
          </thead>
          <tbody>
            {row("Searches where a result was opened", results.openRate, "Of searches with results; higher is better")}
            {row("Searches that found nothing", results.zeroRate, "Lower is better")}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        The first result opened was on average number {arms.keyword.firstPosition?.toFixed(1) ?? "–"} with keyword search and{" "}
        {arms.hybrid.firstPosition?.toFixed(1) ?? "–"} with hybrid (nearer the top is better).
      </p>
      {results.weeks.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="mb-1 text-sm font-medium">Week by week</h3>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">Week</th>
                <th scope="col" className="py-1 pr-4 font-medium">Searches (keyword / hybrid)</th>
                <th scope="col" className="py-1 pr-4 font-medium">Opened (keyword / hybrid)</th>
                <th scope="col" className="py-1 font-medium">Found nothing (keyword / hybrid)</th>
              </tr>
            </thead>
            <tbody>
              {results.weeks.map((week) => (
                <tr key={week.week} className="border-t border-border tabular-nums">
                  <td className="py-1 pr-4">{week.week}</td>
                  <td className="py-1 pr-4">
                    {week.arms.keyword.searches} / {week.arms.hybrid.searches}
                  </td>
                  <td className="py-1 pr-4">
                    {percent(week.arms.keyword.openRate)} / {percent(week.arms.hybrid.openRate)}
                  </td>
                  <td className="py-1">
                    {percent(week.arms.keyword.zeroRate)} / {percent(week.arms.hybrid.zeroRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
