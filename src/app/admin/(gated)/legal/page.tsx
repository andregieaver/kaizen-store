import type { Metadata } from "next";
import { connection } from "next/server";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { LEGAL_REVIEWS_WORDS } from "@/lib/admin-words/legal-reviews";
import { LEGAL_REVIEWS } from "@/lib/legal-reviews";
import { latestViews, requireLegalReader } from "@/server/legal-reviews";

export const metadata: Metadata = { title: "Legal reviews", robots: { index: false, follow: false } };

/**
 * Legal reviews (D892): the drafts written for a lawyer, each with how many of its points have a view. Open to the platform's owners and
 * its lawyers only (`requireLegalReader()`); a lawyer lands here after signing in and sees nothing else of the platform.
 */
export default async function LegalReviewsPage() {
  await connection();
  const account = await requireLegalReader();
  const w = LEGAL_REVIEWS_WORDS[adminLangOf(account.adminLocale)];
  const answered = await Promise.all(LEGAL_REVIEWS.map(async (r) => new Set((await latestViews(r.slug)).map((v) => v.item)).size));
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader title={w.title} description={w.lead} />
      {LEGAL_REVIEWS.length === 0 ? (
        <EmptyState title={w.none} />
      ) : (
        LEGAL_REVIEWS.map((r, i) => (
          <Card key={r.slug}>
            <div className="flex flex-col gap-2" data-legal-review={r.slug}>
              <h2 className="text-title text-ink">{r.title}</h2>
              <p className="text-body text-ink-2">{r.summary}</p>
              <p className="text-caption text-muted">{fillWords(w.answered, { n: answered[i], all: r.items.length })}</p>
              <div>
                <ButtonLink kind="main" href={`/admin/legal/${r.slug}`}>
                  {w.open}
                </ButtonLink>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
