/**
 * A published review as the product page, *Show more* and the structured data read it (D301 9.5). Plain data, no server or zod imports, so the
 * browser's *Show more* draws the same shape the server does.
 */
export type ShownReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  /** The language it was written in: its words are drawn with this `lang`, never translated. */
  locale: string;
  /** The day it was written (`YYYY-MM-DD`): an import's day on the other service, else the day here. */
  writtenOn: string;
  /** What the buyer bought (*Shirt, M*), or null. */
  bought: string | null;
  verified: boolean;
  importedFrom: string | null;
  answer: string | null;
  /** Its pictures staff did not hide, in the author's order (G4), served by `/api/reviews/picture/{id}` while the review is published. */
  pictures: ShownPicture[];
};

/** A review's picture: its id and its size in pixels, so its small copy takes its room before it loads. */
export type ShownPicture = { id: string; width: number; height: number };

/** The address of a review's picture, or of its small copy (480 px). */
export const reviewPictureUrl = (id: string, small = false) => `/api/reviews/picture/${id}${small ? "?size=480" : ""}`;
