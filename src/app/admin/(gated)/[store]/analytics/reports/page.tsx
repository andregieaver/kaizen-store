import type { Metadata } from "next";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminLink, ButtonLink, Card, CARD_CLASS, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { ReadyKey } from "@/lib/report-catalogue";
import type { AdminAreaMessages } from "@/lib/admin-text";
import { CUSTOM_REPORTS_WORDS } from "@/lib/admin-words/custom-reports";
import { analyticsContext } from "@/server/analytics-context";
import { readyAnswers, type ReadyAnswer } from "@/server/report-answers";
import { listSavedReports } from "@/server/saved-reports";

export const metadata: Metadata = { title: "Reports" };

/** The ready reports under the questions they answer (round 9, D630). */
const QUESTIONS: { key: "sells" | "where" | "pay" | "when"; reports: ReadyKey[] }[] = [
  { key: "sells", reports: ["sales_by_product", "sales_by_variant", "sales_by_category"] },
  { key: "where", reports: ["sales_by_country", "sales_by_currency", "sales_by_channel"] },
  { key: "pay", reports: ["sales_by_payment_method", "discount_codes"] },
  { key: "when", reports: ["sales_by_day", "new_and_returning"] },
];

type Words = AdminAreaMessages["customReports"];

/**
 * Analytics → Reports (wave 8 unit A, D345; drawn for Homer in round 9, D630): the store's saved reports first, then the ready ones under
 * four questions, each with its answer for the last 30 days (read after the page is shown). Homer opens a ready report; Lisa builds her own.
 * A report itself is drawn at `reports/view`.
 */
export default async function ReportsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/reports">) {
  const ctx = await analyticsContext((await params).store, await searchParams);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const w = CUSTOM_REPORTS_WORDS[ctx.lang];
  const saved = await listSavedReports(ctx.store.id);
  const view = `${ctx.base}/analytics/reports/view`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.page.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{w.page.lead}</span>
            {w.page.leadRest}
          </span>,
        ]}
        actions={
          <ButtonLink kind="secondary" href={`${view}?new=1`}>
            {w.page.buildOwn}
          </ButtonLink>
        }
      />
      {saved.length > 0 && (
        <Card title={w.page.savedTitle} compact>
          <List label={w.page.savedTitle}>
            {saved.map((report) => (
              <ListRow key={report.id} href={`${view}?id=${report.id}`}>
                <RowLead title={report.title} />
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      <Suspense fallback={<Questions words={w} view={view} answers={{}} />}>
        <AnsweredQuestions ctx={ctx} words={w} view={view} />
      </Suspense>
    </div>
  );
}

async function AnsweredQuestions({ ctx, words, view }: { ctx: Awaited<ReturnType<typeof analyticsContext>>; words: Words; view: string }) {
  const answers = await readyAnswers(ctx.store, ctx.lang, ADMIN_LANG_FACTS[ctx.lang].locale);
  return <Questions words={words} view={view} answers={answers} />;
}

function Questions({ words: w, view, answers }: { words: Words; view: string; answers: Partial<Record<ReadyKey, ReadyAnswer>> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(30rem,100%),1fr))] gap-4">
      {QUESTIONS.map((q) => (
        <section key={q.key} aria-labelledby={`q-${q.key}`} className={`flex flex-col px-6 py-5 ${CARD_CLASS}`}>
          <h2 id={`q-${q.key}`} className="mb-1.5 text-title text-ink">
            {w.page.questions[q.key]}
          </h2>
          <ul className="flex flex-col">
            {q.reports.map((key) => {
              const answer = answers[key];
              return (
                <li key={key} className="border-b border-line last:border-0">
                  <AdminLink href={`${view}?ready=${key}`} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 hover:[&_.name]:underline">
                    <span className="name text-body text-ink">{w.page.short[key]}</span>
                    {answer && (
                      <span className="text-caption text-ink-2">
                        {answer === "none" ? w.page.noSales : fillWords(w.page.answer, { label: answer.label, share: answer.share })}
                      </span>
                    )}
                  </AdminLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
