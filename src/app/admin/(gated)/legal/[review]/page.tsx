import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { DocsMarkdown } from "@/components/docs/docs-markdown";
import { AdminLink, Button, Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { LEGAL_REVIEWS_WORDS } from "@/lib/admin-words/legal-reviews";
import { compileDocs } from "@/lib/docs-content";
import { parseMarkdown } from "@/lib/docs-markdown";
import { LEGAL_VIEW_MAX, legalReviewOf } from "@/lib/legal-reviews";
import { latestViews, requireLegalReader, reviewText } from "@/server/legal-reviews";

export const metadata: Metadata = { title: "Legal review", robots: { index: false, follow: false } };

const PROBLEMS = ["empty", "long", "missing"] as const;

/**
 * One legal review (D892): the draft as the repository keeps it, then each point the lawyer answers with the newest view on it (who and
 * when) and a form for a new one. The form posts to `./view` (a route, so the review adds no server action); a view is kept beside the
 * earlier ones, never in their place.
 */
export default async function LegalReviewPage({ params, searchParams }: PageProps<"/admin/legal/[review]">) {
  await connection();
  const account = await requireLegalReader();
  const { review: slug } = await params;
  const review = legalReviewOf(slug);
  const text = review ? reviewText(review.slug) : null;
  if (!review || text === null) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = LEGAL_REVIEWS_WORDS[lang];
  const query = await searchParams;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const problem = PROBLEMS.find((p) => p === query.problem) ?? null;
  const views = new Map((await latestViews(review.slug)).map((v) => [v.item, v]));
  // The draft is drawn with the docs' own renderer; it links to no docs page, so an empty index serves.
  const blocks = parseMarkdown(text).blocks;
  const ctx = { index: compileDocs([]).index, lang: lang === "nb" ? ("nb" as const) : ("en" as const), callouts: { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" } };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <AdminLink href="/admin/legal">{w.back}</AdminLink>
      <PageHeader title={review.title} description={review.summary} />
      <Card>
        <article className="docs-article flex flex-col gap-3" data-legal-text>
          <DocsMarkdown blocks={blocks} ctx={ctx} />
        </article>
      </Card>
      <section className="flex flex-col gap-4" aria-labelledby="points">
        <h2 id="points" className="text-title text-ink">
          {w.points}
        </h2>
        <p className="text-body text-ink-2">{w.pointsLead}</p>
        {review.items.map((item) => {
          const view = views.get(item.key);
          return (
            <Card key={item.key}>
              <form id={`item-${item.key}`} method="post" action={`/admin/legal/${review.slug}/view`} className="flex flex-col gap-2" data-legal-item={item.key}>
                <input type="hidden" name="item" value={item.key} />
                <h3 className="text-body-strong text-ink">{item.label}</h3>
                {view ? (
                  <div className="flex flex-col gap-1">
                    <p className="whitespace-pre-wrap text-body text-ink">{view.view}</p>
                    <p className="text-caption text-muted">
                      {fillWords(w.latest, { by: view.by, date: adminDate(PLATFORM_TIME_ZONE, view.at, "dayTime", lang) })}
                      {view.earlier > 0 && ` · ${view.earlier === 1 ? w.earlier.one : fillWords(w.earlier.many, { n: view.earlier })}`}
                    </p>
                  </div>
                ) : (
                  <p className="text-caption text-muted">{w.notYet}</p>
                )}
                {saved === item.key && (
                  <p role="status" className="text-caption text-ink-2">
                    {w.saved}
                  </p>
                )}
                {problem && query.item === item.key && (
                  <p role="alert" className="text-caption text-danger-text">
                    {w.problems[problem]}
                  </p>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  {w.yourView}
                  <textarea name="view" required maxLength={LEGAL_VIEW_MAX} rows={4} className="rounded-md border border-line bg-card px-3 py-2" />
                </label>
                <div>
                  <Button type="submit" size="dense">
                    {w.save}
                  </Button>
                </div>
              </form>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
