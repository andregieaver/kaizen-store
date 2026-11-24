/**
 * The words of Legal reviews (D892): the drafts an outside lawyer reads and answers. Server-only: the pages are drawn on the server and post
 * plain forms.
 */
export const legalReviewsEn = {
  title: "Legal reviews",
  lead: "Drafts written for a lawyer to read. Each says what the code does or would do; your view on each point is kept with your name and the date.",
  none: "No drafts are waiting.",
  open: "Read and answer",
  answered: "{n} of {all} points answered",
  back: "All legal reviews",
  points: "Your view, point by point",
  pointsLead: "Write your view on each point. A new view does not erase the earlier one: it is kept beside it, newest first.",
  yourView: "Your view",
  save: "Keep this view",
  saved: "Kept.",
  latest: "{by}, {date}",
  earlier: { one: "1 earlier view kept", many: "{n} earlier views kept" },
  notYet: "No view yet.",
  problems: { empty: "Write your view first.", long: "That is too long: keep it to 4,000 characters.", missing: "That point is not part of this review." },
};

export type LegalReviewsMessages = typeof legalReviewsEn;
