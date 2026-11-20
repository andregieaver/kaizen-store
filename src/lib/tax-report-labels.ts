/**
 * A tax report's refusals in English (bloat review step 2.50): beside `tax-report-words.ts`, whose `rateProblemText()` matches the server's
 * English to say it in the admin's language, and which the tax views import in the browser, so the `tax-reports` catalogue takes its
 * `problems` from here and those views bring no catalogue. Imports nothing.
 */

export const TAX_REPORT_PROBLEMS_EN = {
  invalid: "That is not a currency the ECB publishes a rate for, or not a day from 2021-07-01.",
  future: "That day has not come yet.",
  notPublished: "The ECB has not published a rate for that day yet. It publishes about 16:00 Central European Time on working days.",
  unavailable: "The ECB could not be reached just now. Nothing was changed. Try again, or enter a rate yourself.",
  limit: "Too many rates have been asked of the ECB from this store in the last hour. Try again later, or enter a rate yourself.",
  chooseCurrency: "Choose a currency.",
  dayFormat: "Use a date as year-month-day.",
  ownerFetch: "Only an owner can fetch a rate for a return.",
  ownerEnter: "Only an owner can enter a rate for a return.",
  euro: "The euro needs no rate.",
  dayFrom: "A rate is for a day from {day}.",
  rateShape: "The rate is a positive number with at most six decimals: units of the currency per 1 euro.",
  reasonMin: "Say why, in at least {n} characters (it is shown wherever the rate is used).",
  reasonMax: "The reason is at most {n} characters.",
  pastDay: "A rate is entered for a day that has passed, not for one that has not come.",
};
