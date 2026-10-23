import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { MIN_PER_ARM, rate } from "@/lib/experiment-stats";
import { experimentResults, listExperiments, type Comparison, type ExperimentResults, type Verdict } from "@/server/search-experiment";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";
import { requirePlatformAdmin } from "@/server/auth";

import { startSearchTestAction, stopSearchTestAction } from "./actions";

export const metadata: Metadata = { title: "Search test" };

const card = "rounded-lg border border-line bg-card p-5";
type Words = PlatformToolsMessages["searchTest"];
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)} %`;
const points = (value: number, w: Words) => fillWords(w.points, { n: `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}` });
const dateIn = (locale: string) => (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
const verdictWords = (verdict: Verdict, w: Words) => fillWords(w.verdicts[verdict], { n: MIN_PER_ARM });

/**
 * The search test (Phase 2, S5, D77): start it with the share of searches
 * given keyword search alone, and read how hybrid and keyword search
 * compare. Every store's searches take part while it runs.
 */
export default async function SearchTestPage({ searchParams }: PageProps<"/admin/platform/search-test">) {
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").searchTest;
  const date = dateIn(ADMIN_LANG_FACTS[lang].locale);
  const { id } = await searchParams;
  const experiments = await listExperiments();
  const running = experiments.find((e) => e.endedAt === null) ?? null;
  const shown = experiments.find((e) => e.id === id) ?? running ?? experiments[0] ?? null;
  const results = shown ? await experimentResults(shown) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.intro}</>}
      />

      <section aria-labelledby="run" className={card}>
        <h2 id="run" className="mb-2 text-title text-ink">
          {running ? w.running : w.start}
        </h2>
        {running ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>{fillWords(w.since, { date: date(running.startedAt), share: percent(running.keywordShare, 0) })}</p>
            <DeleteDiscountButton
              action={stopSearchTestAction}
              code={w.stopCode}
              label={w.stop}
              question={w.stopQuestion}
            />
          </div>
        ) : (
          <ActionForm action={startSearchTestAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.share}
              <input
                name="keywordPercent"
                type="number"
                min={5}
                max={95}
                step={1}
                defaultValue={50}
                required
                className="min-h-10 w-32 rounded-md border border-line bg-card px-3"
              />
              <span className="font-normal text-muted">{w.shareText}</span>
            </label>
            <div>
              <SubmitButton>{w.startButton}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      {results && <Results results={results} w={w} />}

      {experiments.length > 1 && (
        <section aria-labelledby="earlier" className={card}>
          <h2 id="earlier" className="mb-2 text-title text-ink">
            {w.tests}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {experiments.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/platform/search-test?id=${e.id}`} className="underline" aria-current={e.id === shown?.id ? "page" : undefined}>
                  {date(e.startedAt)} – {e.endedAt ? date(e.endedAt) : w.runningLower}
                </Link>{" "}
                <span className="text-muted">{fillWords(w.keywordShare, { share: percent(e.keywordShare, 0) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Results({ results, w }: { results: ExperimentResults; w: Words }) {
  const { arms, srmP } = results;
  const row = (name: string, comparison: Comparison, betterIs: string) => (
    <tr key={name} className="border-t border-line align-top">
      <th scope="row" className="py-2 pr-4 text-left font-medium">
        {name}
        <span className="block text-xs font-normal text-muted">{betterIs}</span>
      </th>
      <td className="py-2 pr-4 tabular-nums">{percent(rate(comparison.keyword))}</td>
      <td className="py-2 pr-4 tabular-nums">{percent(rate(comparison.hybrid))}</td>
      <td className="py-2 pr-4 tabular-nums">
        {comparison.diff ? (
          <>
            {points(comparison.diff.diff, w)}
            <span className="block text-xs text-muted">{fillWords(w.interval, { low: points(comparison.diff.low, w), high: points(comparison.diff.high, w) })}</span>
          </>
        ) : (
          "–"
        )}
      </td>
      <td className="py-2">{verdictWords(comparison.verdict, w)}</td>
    </tr>
  );
  return (
    <section aria-labelledby="results" className={card}>
      <h2 id="results" className="mb-1 text-title text-ink">
        {w.results}
        {results.experiment.endedAt ? "" : w.soFar}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {fillWords(w.searches, { keyword: arms.keyword.searches, hybrid: arms.hybrid.searches })}{" "}
        {srmP < 0.001 ? (
          <strong className="text-danger-text">{fillWords(w.splitOff, { p: srmP.toExponential(1) })}</strong>
        ) : (
          fillWords(w.splitOk, { p: srmP.toFixed(2) })
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">{w.measure}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{w.keyword}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{w.hybrid}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{w.difference}</th>
              <th scope="col" className="py-2 font-medium">{w.reading}</th>
            </tr>
          </thead>
          <tbody>
            {row(w.opened, results.openRate, w.openedBetter)}
            {row(w.zero, results.zeroRate, w.lowerBetter)}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        {fillWords(w.firstOpened, { keyword: arms.keyword.firstPosition?.toFixed(1) ?? "–", hybrid: arms.hybrid.firstPosition?.toFixed(1) ?? "–" })}
      </p>
      {results.weeks.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="mb-1 text-body-strong text-ink">{w.weekByWeek}</h3>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">{w.week}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{w.weekSearches}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{w.weekOpened}</th>
                <th scope="col" className="py-1 font-medium">{w.weekZero}</th>
              </tr>
            </thead>
            <tbody>
              {results.weeks.map((week) => (
                <tr key={week.week} className="border-t border-line tabular-nums">
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
