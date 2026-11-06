import type { Widen } from "./common.en";

/**
 * The words of the store's own books (B2, D478): Settings → Books. Only the server page and its actions read them, so they are a server-only
 * area (`SERVER_AREAS` in `admin-text.ts`). `{name}` placeholders are filled by `fillWords()`; a count is a `{ one, many }` pair read by
 * `countWords()`.
 */
export const booksEn = {
  title: "Books",
  intro: "Your own books, kept here from your invoices and credit notes as you issue them: every entry numbered, balanced and never changed after.",
  open: {
    title: "Keep your books here too",
    text: "We post every invoice and credit note you issue to your own books here, on the same accounts as Tripletex, so the two can be compared before you leave it.",
    from: "Books from",
    fromHelp: "The day your books start. With Tripletex connected, the day it starts booking.",
    button: "Open the books",
    ownerOnly: "Only the store's owner opens the books.",
    opened: "The books are open.",
  },
  facts: {
    title: "{name}",
    number: "Organisation number {number}",
    since: "Books from {day}, in {currency}",
    locked: "Locked through {day}",
    open: "Nothing locked yet",
  },
  waiting: {
    title: "Waiting for you",
    count: { one: "{n} document could not be posted yet", many: "{n} documents could not be posted yet" },
    kinds: { work_invoice: "Invoice", work_credit_note: "Credit note", shop_invoice: "Shop invoice", shop_credit_note: "Shop credit note" } as Record<string, string>,
    problems: {
      currency: "in another currency than the books (coming next)",
      vat_unmapped: "a VAT kind with no account",
      totals: "its amounts do not add up",
      nothing: "nothing to post",
      locked: "its day is locked",
      open: "its day is outside the books",
      account: "an account is not in the chart",
      unreadable: "it could not be read",
    } as Record<string, string>,
    since: "since {day}",
  },
  trial: {
    title: "Trial balance",
    from: "From",
    to: "To",
    show: "Show",
    account: "Account",
    before: "Before",
    debit: "Debit",
    credit: "Credit",
    after: "After",
    total: "Total",
    result: "Result for the period: {amount}",
    empty: "Nothing posted in these days yet.",
    unbalanced: "These books do not balance. Tell us: this should never happen.",
  },
  lock: {
    title: "Lock the books",
    text: "Nothing dated on or before the day is posted after it, as when a VAT term is reported. Moving the day back is possible, and recorded.",
    through: "Locked through",
    button: "Lock",
    done: "Locked.",
    invalid: "Choose a day after the books open.",
  },
  problems: {
    forbidden: "Only the store's owner does this.",
    open: "The books are open already.",
    no_pack: "Books are kept here for Norwegian businesses first.",
    date: "Choose a real day.",
  },
};

export type BooksMessages = Widen<typeof booksEn>;
