import type { ReviewMessages } from "@/lib/messages/en-reviews";
import { reviewPictureUrl } from "@/lib/review-view";
import type { OwnReview } from "@/server/reviews";

import type { FormPicture, ReviewFormWords } from "./review-form";

/** The review form's words in the market's language (D301 9.3, G4), for the account's page and a request email's page alike. */
export const reviewFormWords = (r: ReviewMessages, review: OwnReview | null): ReviewFormWords => ({
  rating: r.rating,
  stars: [1, 2, 3, 4, 5].map((n) => r.starsOf(n)),
  titleLabel: r.titleLabel,
  bodyLabel: r.bodyLabel,
  nameLabel: r.nameLabel,
  nameHint: r.nameHint,
  submit: review ? r.save : r.send,
  problems: r.problem,
  pictures: {
    label: r.picturesLabel,
    hint: r.picturesHint,
    add: r.pictureAdd,
    remove: r.pictureRemove,
    preparing: r.picturePreparing,
    unreadable: r.pictureUnreadable,
    hidden: r.pictureHidden,
    alt: r.pictureAlt("{0}"),
  },
});

/**
 * The review's own pictures as its form shows them (G4), or null when the store has no place for pictures. `shown`: the author is signed in, so
 * the picture route shows them their own small copies; from a request email's link they are named, not shown.
 */
export const reviewFormPictures = (review: OwnReview | null, on: boolean, shown: boolean): FormPicture[] | null =>
  on ? (review?.pictures ?? []).map((p) => ({ id: p.id, url: shown ? reviewPictureUrl(p.id, true) : null, hidden: p.hidden })) : null;
