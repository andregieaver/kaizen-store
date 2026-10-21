/**
 * Product reviews' words (D301, `docs/wave-5-marketing.md` 9), English: My account's Reviews and the form. Written by hand in nb, sv, da and en.
 */
export const enReviews = {
  cardTitle: "Reviews",
  cardIntro: "Review what you bought, or change a review you wrote.",
  title: "Your reviews",
  intro: "Review what you have bought and received. The store may check a review before it is shown. No one is paid or rewarded for a review.",
  none: "There is nothing to review yet. Once something you bought has reached you, you can review it here.",
  received: (date: string) => `Received ${date}`,
  write: "Write a review",
  change: "Change",
  back: "Your reviews",
  formTitle: (product: string) => `Review ${product}`,
  rating: "Your rating",
  starsOf: (n: number) => `${n} of 5 stars`,
  titleLabel: "Title (optional)",
  bodyLabel: "Your review (optional)",
  nameLabel: "Name shown with your review",
  nameHint: "Shown as you write it here. Your email address is never shown.",
  send: "Send review",
  save: "Save changes",
  delete: "Delete review",
  deleteSure: "Yes, delete it",
  deleteHint: "Your review is deleted for good.",
  status: { pending: "Waiting to be checked", published: "Published", hidden: "Not shown" },
  answerFrom: (store: string) => `Answer from ${store}`,
  sentWaiting: "Thank you. Your review is waiting to be checked by the store.",
  sentShown: "Thank you. Your review is published.",
  deleted: "Your review is deleted.",
  problem: {
    rating: "Choose from one to five stars.",
    title: "The title is too long: at most 120 characters.",
    body: "The review is too long: at most 5,000 characters.",
    name: "Write the name to show with your review.",
    not_reviewable: "This can no longer be reviewed here.",
    limit: "You have written many reviews today. Try again tomorrow.",
    closed: "This store does not take reviews right now.",
  },
};

export type ReviewMessages = typeof enReviews;
