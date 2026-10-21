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
};
