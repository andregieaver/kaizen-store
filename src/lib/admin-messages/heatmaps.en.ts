/**
 * The owner's words for heatmaps (D656, `docs/heatmaps-and-recordings.md` step 5): the switch on Analytics → Settings and what its action
 * answers. Server-only (`SERVER_AREAS`): the settings view is drawn on the server.
 */
export const heatmapsEn = {
  title: "Heatmaps",
  description: "See where visitors click, how far down they scroll and what holds their attention, page by page and for each version of an A/B test.",
  on: "On",
  off: "Off",
  stateOn: "Measuring the visitors who allow statistics.",
  stateOff: "Nothing is measured.",
  whatTitle: "What is measured",
  what: [
    "Clicks, on the part of the page they land on, and which did nothing (dead clicks) or came in quick bursts (rage clicks)",
    "How far down each page visitors scroll",
    "How long each part of a page is on screen while a visitor is there",
  ],
  notTitle: "What is not",
  not: [
    "No visitor is identified or followed: only each day's totals are kept",
    "Nothing from the cart, checkout, account pages, forms, the chat or search results",
    "Nobody who uses Global Privacy Control or Do Not Track, or has not allowed statistics",
  ],
  askAgainTitle: "Visitors are asked again",
  askAgain: "When heatmaps start, your visitors are asked about statistics cookies again, and the banner says heatmaps are part of them.",
  keep: "Daily totals are kept for 13 months, and clicks per spot for 90 days.",
  turnOn: "Switch heatmaps on",
  turnOff: "Switch heatmaps off",
  nowOn: "Heatmaps are on. Visitors are asked about statistics again.",
  nowOff: "Heatmaps are off. Nothing more is measured; what was measured is kept until its time is up.",
  choose: "Choose on or off.",
};

export type HeatmapsMessages = typeof heatmapsEn;
