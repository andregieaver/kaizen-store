import type { Widen } from "./common.en";

/**
 * The words of changing the business behind a store (B8, D473): the section on Settings → Company, its form and its checklist. Only the
 * server page reads them, so they are a server-only area (`SERVER_AREAS` in `admin-text.ts`). `{name}` placeholders are filled by
 * `fillWords()`; a count is a `{ one, many }` pair read by `countWords()`.
 */
export const businessEn = {
  section: "Changing the business behind the store",
  intro: "When your sole proprietorship becomes a limited company, or another business takes over the store, plan it here. From the day you choose, invoices, receipts and the store's pages name the new business.",
  start: "Plan a change of business",

  legalName: "The new business's legal name",
  form: "Kind of business",
  forms: {
    enk: "Sole proprietorship (ENK)",
    as: "Limited company (AS)",
    asa: "Public limited company (ASA)",
    nuf: "Branch of a foreign company (NUF)",
    da: "Partnership with shared liability (DA)",
    ans: "General partnership (ANS)",
    sa: "Cooperative (SA)",
    other: "Another kind",
  },
  startsOn: "From",
  startsOnHint: "The first day the new business sells. A change from a sole proprietorship to a limited company usually starts on 1 January.",
  organisationNumber: "Organisation number",
  organisationNumberHint: "Leave it empty until the new business is registered. The change waits for it.",
  vatRegistered: "The new business is registered for VAT",
  vatNumber: "VAT number",
  vatNumberHint: "Written from the organisation number when left empty.",
  more: "More: address and invoice numbers",
  address: "Business address from that day",
  addressHint: "Leave it empty to keep {address}.",
  prefixes: "Invoice numbers",
  prefixesHint: "The numbers go on from where they are, with no gap. Give the new business a prefix of its own if your accountant asks for one.",
  seriesNames: { invoice: "Invoices", credit_note: "Credit notes", work_invoice: "Work invoices", work_credit_note: "Work credit notes" },
  keeps: "Keeps {prefix}",
  save: "Plan the change",
  saveChange: "Save",
  saved: "Saved.",
  cancel: "Call off the change",
  cancelled: "Called off.",

  becoming: "Your business becomes {name} on {date}",
  daysLeft: { one: "{n} day left.", many: "{n} days left." },
  fromToday: "From today.",
  overdue: "Its day has come, but it cannot take effect until what is missing is added. Until then, documents name the business as it is.",
  missing: { organisation_number: "Add the new business's organisation number.", vat_number: "Add the new business's VAT number." },
  edit: "Change the details",
  checklist: "What to set up for {name}",
  steps: {
    numbers: { title: "Organisation number", text: "The new business's number from the Register of Business Enterprises." },
    vat: { title: "VAT registration", text: "The VAT number invoices state from the day." },
    series: { title: "Invoice numbers", text: "Kaizena Flow does this: the new business's invoices go on from {start}." },
    bank: { title: "Bank account", text: "Put the new business's account number on Work invoices.", link: "Work settings" },
    payments: { title: "Payments", text: "Tell Stripe and your payment providers about the new business, or connect its own account.", link: "Payments" },
    accounting: { title: "Accounting", text: "Book into the new business's company in your accounting system.", link: "Integrations" },
    legal: { title: "Terms and privacy notice", text: { one: "{n} of your legal pages still names {name}.", many: "{n} of your legal pages still name {name}." }, textDone: "No legal page names the business as it is.", link: "Legal pages" },
    plan: { title: "Kaizena Flow's invoices", text: "The new business's name and number on the invoices for your plan.", link: "Billing" },
    clients: { title: "Tell your clients", text: "Let the businesses you invoice know who invoices them from the day." },
    einvoices: { title: "E-invoices (EHF)", text: "Kaizena Flow registers the new business on the Peppol network when e-invoices go live." },
  },
  doneLabel: "Done",
  markDone: "Mark {step} done",
  markOpen: "Mark {step} not done",
  history: "Earlier changes",
  /** The tax reports' note when a period spans a change (step 3). */
  split: {
    text: "This period spans the change of business on {date}. Each business reports its own part:",
    part: "{name}'s part",
    vatOnly: "Open each part in the VAT report.",
  },
  since: "{name} since {date}",
  before: "Before: {name}",

  problems: {
    legal_name: "Give the new business's legal name, at most 200 characters.",
    form: "Choose the kind of business.",
    organisation_number: "That organisation number is not valid.",
    vat_number: "That VAT number is not valid for the store's country.",
    postal_address: "Write the address in 5 to 300 characters.",
    starts_on: "Choose a day after today, within two years.",
    prefix: "A prefix is up to 10 letters, digits or . _ / -.",
    same: "That is the business behind the store already.",
    forbidden: "Only the store's owner can change the business behind it.",
    not_found: "There is no planned change.",
  },
};

export type BusinessMessages = Widen<typeof businessEn>;
