import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { docsPageAt } from "@/lib/docs-content";
import { docsUrl } from "@/lib/docs-host";
import { DOCS_SEARCH_SUB, docsSearchQueryString, NO_FILTERS } from "@/lib/docs-search";
import { requirePlatformReader } from "@/server/auth";
import { docsIndex } from "@/server/docs";
import { listDocsFeedback, tallyDocsFeedback } from "@/server/docs-feedback";
import { listDocsMisses } from "@/server/docs-search";

import { removeDocsCommentAction, removeDocsMissAction } from "./actions";

export const metadata: Metadata = { title: "Docs feedback" };

const PATH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4}$/;
const when = (at: string) => at.slice(0, 16).replace("T", " ");
const control = "min-h-10 rounded-lg border border-edge bg-card px-3 text-sm";

/**
 * What readers of the docs said (D442): each page's yes and no counted (the pages with the most no first), then the answers newest first,
 * filtered by page, by yes or no and by having a sentence (the filters in the address). A sentence that names someone is taken away here.
 * Then the docs' gap list (D443): the searches that found nothing in the docs, the most often first, each to try again or take off the list.
 */
export default async function DocsFeedbackPage({ searchParams }: PageProps<"/admin/platform/docs/feedback">) {
  await connection();
  const admin = await requirePlatformReader();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").docsFeedback;
  const query = await searchParams;
  const path = typeof query.page === "string" && PATH.test(query.page) ? query.page : null;
  const helpful = query.helpful === "yes" ? true : query.helpful === "no" ? false : null;
  const withComment = query.sentence === "1";
  const [tally, rows, misses] = await Promise.all([tallyDocsFeedback(), listDocsFeedback({ path, helpful, withComment }), listDocsMisses()]);
  const index = docsIndex();
  const title = (p: string) => docsPageAt(index, p, "en")?.title ?? p;
  const total = tally.reduce((sum, t) => sum + t.yes + t.no, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} meta={[`${total} · ${w.answers.toLowerCase()}`]} />
      <Card title={w.byPage}>
        {tally.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-caption">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4">{w.page}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{w.yes}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{w.no}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{w.sentences}</th>
                  <th scope="col" className="py-2 pr-4">{w.latest}</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((t) => (
                  <tr key={t.path} className="border-t border-line">
                    <td className="py-2 pr-4">
                      <a href={`?page=${encodeURIComponent(t.path)}`} className="underline-offset-2 hover:underline">
                        {title(t.path)}
                      </a>
                      <span className="block text-muted">{t.path}</span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.yes}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.no}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.comments}</td>
                    <td className="py-2 pr-4 tabular-nums">{when(t.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={w.misses} description={w.missesHint}>
        {misses.length === 0 ? (
          <p className="text-sm text-muted">{w.missesNone}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-caption">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4">{w.query}</th>
                  <th scope="col" className="py-2 pr-4">{w.language}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{w.times}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{w.guideTimes}</th>
                  <th scope="col" className="py-2 pr-4">{w.first}</th>
                  <th scope="col" className="py-2 pr-4">{w.latest}</th>
                  <th scope="col" className="py-2 pr-4">
                    <span className="sr-only">{w.removeMiss}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {misses.map((miss) => (
                  <tr key={`${miss.lang}:${miss.query}`} className="border-t border-line align-top">
                    <td className="py-2 pr-4">
                      {/* What a reader typed: shown as text, never as HTML. */}
                      <a
                        href={docsUrl(`${DOCS_SEARCH_SUB}${docsSearchQueryString({ q: miss.query, filters: { ...NO_FILTERS, lang: [miss.lang] }, sort: "relevance" })}`, miss.lang)}
                        className="underline-offset-2 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        title={w.tryIt}
                      >
                        {miss.query}
                      </a>
                    </td>
                    <td className="py-2 pr-4">{miss.lang === "nb" ? w.norwegian : w.english}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{miss.misses}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{miss.guideMisses}</td>
                    <td className="py-2 pr-4 tabular-nums">{when(miss.firstAt)}</td>
                    <td className="py-2 pr-4 tabular-nums">{when(miss.lastAt)}</td>
                    <td className="py-2 pr-4">
                      <ActionForm action={removeDocsMissAction.bind(null, miss.query, miss.lang)} className="flex items-center gap-2" successMessage={w.missRemoved}>
                        <SubmitButton variant="secondary">{w.removeMiss}</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-caption text-muted">{w.removeMissHint}</p>
          </div>
        )}
      </Card>
      <Card title={w.answers}>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {w.page}
            <select name="page" defaultValue={path ?? ""} className={control}>
              <option value="">{w.allPages}</option>
              {tally.map((t) => (
                <option key={t.path} value={t.path}>
                  {title(t.path)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.filter}
            <select name="helpful" defaultValue={helpful === null ? "" : helpful ? "yes" : "no"} className={control}>
              <option value="">{w.any}</option>
              <option value="yes">{w.onlyYes}</option>
              <option value="no">{w.onlyNo}</option>
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="sentence" value="1" defaultChecked={withComment} />
            {w.withSentence}
          </label>
          <button type="submit" className={`${control} font-medium`}>
            {w.apply}
          </button>
        </form>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{tally.length === 0 ? w.none : w.noneFound}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip signal={row.helpful ? "positive" : "warning"}>{row.helpful ? w.yes : w.no}</Chip>
                  <a href={docsUrl(row.path, row.lang)} className="underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
                    {title(row.path)}
                  </a>
                  {row.lang === "nb" && <Chip signal="neutral">{w.norwegian}</Chip>}
                  <span className="text-muted tabular-nums">{when(row.createdAt)}</span>
                </p>
                {row.comment && (
                  <>
                    {/* The reader's own words: shown as text, never as HTML. */}
                    <p className="text-sm whitespace-pre-line">{row.comment}</p>
                    <ActionForm action={removeDocsCommentAction.bind(null, row.id)} className="flex flex-wrap items-center gap-2" successMessage={w.removed}>
                      <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                      <span className="text-caption text-muted">{w.removeHint}</span>
                    </ActionForm>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
