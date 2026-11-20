/**
 * The threshold watch's sentences in English (D514, bloat review step 2.50): beside `turnover-watch.ts`, whose `watchText()` the store
 * checkup (the AI manager's and the morning briefing's) says with no language, so the `books` catalogue takes its `watch` group from here
 * and the checkup brings no catalogue. Imports nothing.
 */

export const WATCH_EN = {
  title: "Turnover over the last 12 months",
  description: "From your books. Kaizena Flow tells you on your home before you reach a threshold: the law's, and your own.",
  turnover: "{turnover} over the last 12 months.",
  million: "million",
  ownNear: "Turnover {turnover} over the last 12 months: {note} before {limit}.",
  ownPassed: "Turnover {turnover} over the last 12 months passed {limit}: {note}.",
  legal: {
    vat_registration: {
      near: "Turnover {turnover} over the last 12 months, near {limit}: past it, a business must register for VAT.",
      passed: "Turnover passed {limit} over the last 12 months: a business must register for VAT, if it has not.",
    },
    audit_as: {
      near: "Turnover {turnover} over the last 12 months, near {limit}: past it, an AS may no longer skip the audit. Ask your accountant.",
      passed: "Turnover passed {limit} over the last 12 months: an AS may no longer skip the audit. Ask your accountant.",
    },
  },
  lawTitle: "The law's thresholds",
  lawVat: "{limit}: VAT registration, and the end of the small business exemptions.",
  lawAudit: "{limit}: an AS may skip the audit only below it (with its balance and staff under their limits).",
  ownTitle: "Your own",
  near: "Near",
  past: "Passed",
  ownNone: "None yet. Add the turnover at which you will do something, such as take an accountant.",
  amount: "Amount ({currency})",
  note: "What you will do",
  notePlaceholder: "invite our accountant",
  add: "Add",
  added: "Added.",
  remove: "Remove",
  removed: "Removed.",
  problems: { amount: "Write an amount above zero.", note: "Say what you will do, in up to 120 characters.", gone: "That threshold is gone already." },
};
