/**
 * What the Tripletex connection says to an owner, in English (bloat review step 2.50): beside `tripletex-errors.ts`, which re-exports it for its
 * functions, so the admin's `notifications` catalogue takes it from here and imports no code. Imports nothing.
 */

/**
 * What each failure says to an owner, in plain words, with what to do, by `TripletexFailure.key`; `transient` and `rule` for any other
 * key of that class. The admin's catalogues give the same keys in each language (`notifications` → `integrations.tripletex.failures`).
 */
export const FAILURE_WORDS = {
  http_401: "Tripletex no longer accepts the token. Make a new one in Tripletex and paste it on the Tripletex page.",
  http_403: "The token may not do this in Tripletex. Give it access to accounting (vouchers, customers and accounts), then press Try again.",
  http_404: "This was deleted in Tripletex. Post it again, or leave it out.",
  closed_period: "Tripletex has closed the accounting period for this date. Open the period in Tripletex (or ask your accountant), then press Try again.",
  rate_limit: "Tripletex asked us to slow down. It will go through by itself in a few minutes.",
  timeout: "Tripletex did not answer. It will be tried again by itself.",
  network: "Tripletex did not answer. It will be tried again by itself.",
  redirect: "Tripletex answered from another address, which is not followed. It will be tried again.",
  revision: "The customer was changed in Tripletex at the same moment. It will be tried again.",
  duplicate: "Tripletex already has this. It is looked up and linked.",
  no_consumer_token:
    "This token is made for the Kaizena Flow app, which Tripletex has not approved yet. In Tripletex, make an API token under Company → API tokens instead, and paste that.",
  bad_answer: "Tripletex answered with something we could not read. It will be tried again.",
  not_connected: "Connect Tripletex first.",
  transient: "Tripletex had a problem on its side. It will be tried again by itself.",
  rule: "Tripletex refused it. See what it said below, fix it in Tripletex or in the Tripletex settings, then press Try again.",
} as const;

/** Why a document waits before anything is sent (`BlockCode` of `tripletex-map.ts`, and the connection's own reasons), in words. */
export const BLOCK_WORDS = {
  currency_unsupported: "Only invoices in Norwegian kroner are sent to Tripletex for now. Book this one by hand.",
  vat_unmapped: "This document has a kind of VAT the Tripletex settings do not place yet. Choose where it goes under Tripletex → Customise.",
  totals_mismatch: "The lines do not add up to the total, so nothing was sent. Contact support.",
  nothing_to_book: "There is nothing to book on this document.",
  waiting_for_invoice: "Waits until its invoice is in Tripletex.",
  settings_problem: "The Tripletex settings need a look before this can be sent.",
  customer_missing: "The client this document is for could not be read. Contact support.",
  document_missing: "The document could not be read. Contact support.",
} as const;
