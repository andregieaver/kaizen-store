import type { Messages } from "@/lib/i18n";
import type { RatingSummary } from "@/lib/reviews";
import type { ReviewFacts } from "@/server/review-facts";

import { ReviewItem, type ReviewWords } from "./review-item";
import { ReviewsMore } from "./reviews-more";
import { StarRating } from "./star-rating";

/** The average to one decimal in the page's language (*4,3* in Norwegian). */
const averageText = (summary: RatingSummary, locale: string) =>
  (summary.average ?? 0).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const reviewWords = (m: Messages): ReviewWords => ({
  verified: m.reviews.verified,
  imported: m.reviews.imported("{0}"),
  bought: m.reviews.bought("{0}"),
  answerFrom: m.reviews.answerFrom("{0}"),
  picture: m.reviews.pictureAlt("{0}"),
});

/** The product part `rating` (D301 9.5): the stars, the average and how many reviews, linking to the reviews below. */
export function ProductRating({ facts, m, locale, anchor }: { facts: ReviewFacts; m: Messages; locale: string; anchor: string }) {
  const { summary } = facts;
  return (
    <a href={`#${anchor}`} className="inline-flex items-center gap-2 text-sm hover:underline">
      <StarRating stars={summary.average ?? 0} />
      <span>{m.reviews.average(averageText(summary, locale))}</span>
      <span className="text-muted">({m.reviews.count(summary.count)})</span>
    </a>
  );
}

/**
 * The product part `reviews` (D301 9.5): the average, how many gave each number of stars, the newest ten published reviews with *Show more*, and
 * *How reviews are checked*. Only published reviews of this product; their words are text, never HTML.
 */
export function ProductReviews({
  facts,
  m,
  locale,
  store,
  endpoint,
  id,
  heading,
}: {
  facts: ReviewFacts;
  m: Messages;
  locale: string;
  store: string;
  endpoint: string;
  /** The section's id, which the `rating` part links to. */
  id: string;
  heading: React.ReactNode;
}) {
  const { summary, latest, publish } = facts;
  const words = reviewWords(m);
  const r = m.reviews;
  const most = Math.max(1, ...summary.counts);
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`} className="font-heading text-xl">
        {heading ?? r.heading}
      </h2>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-3xl font-heading">{averageText(summary, locale)}</p>
          <StarRating stars={summary.average ?? 0} />
          <p className="text-sm text-muted">{r.count(summary.count)}</p>
        </div>
        <ul className="flex min-w-48 flex-1 flex-col gap-1 text-sm" aria-label={r.heading}>
          {summary.counts.map((n, i) => (
            <li key={5 - i} className="flex items-center gap-2">
              <span className="w-24 shrink-0">{r.starsOf(5 - i)}</span>
              <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                <span className="block h-full bg-current opacity-60" style={{ width: `${(n / most) * 100}%` }} />
              </span>
              <span className="w-8 text-right tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="divide-y divide-border">
        {latest.map((review) => (
          <ReviewItem key={review.id} review={review} words={words} locale={locale} store={store} />
        ))}
      </ul>
      {summary.count > latest.length && latest.length > 0 && (
        <ReviewsMore
          endpoint={endpoint}
          firstAfter={latest[latest.length - 1].id}
          words={{ ...words, more: r.more, failed: r.failed }}
          locale={locale}
          store={store}
        />
      )}
      <details className="text-sm">
        <summary className="cursor-pointer underline">{r.checked.heading}</summary>
        <div className="mt-2 flex flex-col gap-2 text-muted">
          <p>{r.checked.buyers}</p>
          <p>{publish === "at_once" ? r.checked.atOnce : r.checked.afterCheck}</p>
          <p>{r.checked.reward}</p>
          {latest.some((review) => !review.verified) && <p>{r.checked.imported}</p>}
        </div>
      </details>
    </section>
  );
}
