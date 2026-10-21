import type { ShownReview } from "@/lib/review-view";

import { StarRating } from "./star-rating";

/** The words a review is drawn with, in the page's language; `{0}` is filled with the source, what was bought or the store. */
export type ReviewWords = { verified: string; imported: string; bought: string; answerFrom: string };

const fill = (template: string, value: string) => template.replace("{0}", value);

/**
 * One published review (D301 9.5): stars, title, text, name, day, what was bought, *Verified purchase* or *Imported from …*, and the store's
 * answer. Its words are text in their own language (`lang`), never HTML and never translated. Drawn the same on the server and by *Show more*.
 */
export function ReviewItem({ review, words, locale, store }: { review: ShownReview; words: ReviewWords; locale: string; store: string }) {
  const day = new Date(`${review.writtenOn}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <li className="flex flex-col gap-1 py-4" data-review={review.id}>
      <StarRating stars={review.rating} />
      {review.title && (
        <p className="font-medium" lang={review.locale}>
          {review.title}
        </p>
      )}
      {review.body && (
        <p className="whitespace-pre-line" lang={review.locale}>
          {review.body}
        </p>
      )}
      <p className="text-sm text-muted">
        {[review.authorName, day, review.verified ? words.verified : review.importedFrom ? fill(words.imported, review.importedFrom) : null, review.bought ? fill(words.bought, review.bought) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {review.answer && (
        <div className="mt-2 border-l-2 border-border pl-3 text-sm">
          <p className="text-muted">{fill(words.answerFrom, store)}</p>
          <p className="whitespace-pre-line">{review.answer}</p>
        </div>
      )}
    </li>
  );
}
