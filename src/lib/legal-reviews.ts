/**
 * The drafts an outside lawyer reads and answers under Legal reviews (D892): each a document in the repository, written "for the owner and a
 * lawyer", and the points in it the lawyer gives a view on (a country's row, a question). The views are kept with who wrote them and when
 * (`platform_legal_views`); the document itself stays the repository's. Pure.
 */

export type LegalReviewItem = { key: string; label: string };

export type LegalReview = {
  slug: string;
  title: string;
  /** What it is for, in a line. */
  summary: string;
  /** The document, from the repository's root (traced into the review's route, `next.config.ts`). */
  file: string;
  items: readonly LegalReviewItem[];
};

export const LEGAL_REVIEWS: readonly LegalReview[] = [
  {
    slug: "outreach-rules",
    title: "Contacting businesses by country",
    summary: "The rules the outreach tool would follow before it may write to a company (email plan P5.3).",
    file: "docs/outreach-rules.md",
    items: [
      { key: "NO", label: "Norway" },
      { key: "SE", label: "Sweden" },
      { key: "DK", label: "Denmark" },
      { key: "FI", label: "Finland" },
      { key: "DE", label: "Germany" },
      { key: "FR", label: "France" },
      { key: "q1", label: "Question 1: our reading and the first email" },
      { key: "q2", label: "Question 2: sole traders" },
      { key: "q3", label: "Question 3: legitimate interest and 90 days" },
      { key: "q4", label: "Question 4: one do-not-contact list" },
      { key: "q5", label: "Question 5: who is the controller" },
      { key: "q6", label: "Question 6: which countries next" },
      { key: "overall", label: "Anything else" },
    ],
  },
];

/** A review by its slug, or null. */
export const legalReviewOf = (slug: string): LegalReview | null => LEGAL_REVIEWS.find((r) => r.slug === slug) ?? null;

/** The most a view may say, in characters. */
export const LEGAL_VIEW_MAX = 4000;
