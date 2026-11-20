/**
 * What the Fiken connection says to an owner, in English (bloat review step 2.50): beside `fiken-errors.ts` (which re-exports
 * the failure and block words for its functions) and `fiken-setup.ts`, so the admin's `fiken` catalogue takes it from here and imports no code. Imports nothing but types.
 */
import type { FikenAccountProblem } from "./fiken-setup";

/**
 * What each failure says to an owner, in plain words, with what to do, by `FikenFailure.key`; `transient` and `rule` for any other key of
 * that class. The admin's `fiken` catalogue gives the same keys in each language.
 */
export const FIKEN_FAILURE_WORDS = {
  http_401: "Fiken no longer lets Kaizena Flow in. Connect Fiken again on the Fiken page; everything that waited is sent then.",
  http_403: "Fiken refused it for this company. Check that the API module is on under Settings → Module access in Fiken, then press Try again.",
  http_404: "This was deleted in Fiken. Post it again, or leave it out.",
  closed_period: "The accounting period for this date is locked in Fiken. Open it in Fiken (or ask your accountant), then press Try again.",
  rate_limit: "Fiken asked us to slow down. It will go through by itself in a few minutes.",
  timeout: "Fiken did not answer. It will be tried again by itself.",
  network: "Fiken did not answer. It will be tried again by itself.",
  redirect: "Fiken answered from another address, which is not followed. It will be tried again.",
  number_taken: "Fiken already has another sale with this number. Check it in Fiken: if it is this one, delete the other or leave this out.",
  bad_answer: "Fiken answered with something we could not read. It will be tried again.",
  not_connected: "Connect Fiken first.",
  transient: "Fiken had a problem on its side. It will be tried again by itself.",
  rule: "Fiken refused it. See what it said below, fix it in Fiken or in the Fiken settings, then press Try again.",
} as const;

/** Why a document waits before anything is sent (`FikenBlockCode` and the connection's own reasons), in words. */
export const FIKEN_BLOCK_WORDS = {
  currency_unsupported: "Only invoices in Norwegian kroner are sent to Fiken for now. Book this one by hand.",
  vat_unmapped: "This document has a kind of VAT the Fiken settings do not place yet. Choose where it goes under Fiken → Customise.",
  totals_mismatch: "The lines do not add up to the total, so nothing was sent. Contact support.",
  nothing_to_book: "There is nothing to book on this document.",
  waiting_for_invoice: "Waits until its invoice is in Fiken.",
  settings_problem: "The Fiken settings need a look before this can be sent.",
  customer_missing: "The client this document is for could not be read. Contact support.",
  document_missing: "The document could not be read. Contact support.",
} as const;

/** What each problem says to an owner, in plain words. */
export const FIKEN_PROBLEM_WORDS: Record<FikenAccountProblem, string> = {
  missing: "Nothing is chosen for this yet.",
  account_missing: "The account is not in your Fiken chart of accounts.",
  wrong_range: "The account is not one sales can be booked on (3000–3999, or 2000–2999 for gift cards).",
};
