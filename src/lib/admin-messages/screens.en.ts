import { ANALYTICS_TABLES } from "../analytics-export";
import { STOREFRONT_ROUTES } from "../storefront-api";

import type { Widen } from "./common.en";

/**
 * The words of screens drawn on the server alone (D312): the owner's account pages, print pages and previews, the export pages' notes,
 * and the parts of other screens no client part reads. Only server code reads them, so they are a server-only area (`SERVER_AREAS` in
 * `admin-text.ts`), out of every admin screen's first scripts (`e2e/signed-in/admin-scripts.spec.ts`). `{name}` placeholders are filled by
 * `fillWords()`; a count is a `{ one, many }` pair read by `countWords()`.
 */
export const screensEn = {
  /** Your account's Appearance page (D99, D221, D222). */
  appearance: {
    title: "Appearance",
    forYou: "How the admin looks for you",
    storesKeep: "Your stores keep the colours set under Design",
    every: "Every scheme",
    everyText: "Each scheme in light and in dark, with the admin's buttons, labels, cards, figures, bars and lists. The names and figures in them are examples.",
  },
  /** What the export pages say about their files (D165, `docs/wave-2-data.md` 2.3), and why an export was not made. */
  exportNotes: {
    personalData: "This file contains personal data. Keep it only as long as you need it; it is deleted from here after {days} days.",
    neverEmailed: "A file is never sent by email. When a large export is ready you get an email with a link to this page, and download the file here.",
    noConsent: "This file is not a mailing list. Who agreed to marketing email is on the Subscribers page, with the words they agreed to and when.",
    mainCurrency: "The main-currency columns are indicative. They use the store's exchange rate at the time the file is made, and are blank for a currency the store has no rate for. They are not for a tax return.",
    notStatement: "This file is not a statement of account, an invoice register or a return. Your accountant's documents are the invoices and credit notes and the VAT, OSS and IOSS files.",
    testPayment: "Orders paid in Stripe's test mode are in the file and marked test_payment = true. They are try-outs, not sales: leave those rows out of anything you give your accountant.",
    problems: {
      forbidden: "You do not have access to this.",
      options: "The choices for the export could not be read. Check them and try again.",
      too_big: "This export has more than {max} rows. Choose a narrower period or filter.",
      too_many: "{n} exports are already being made for this store. Wait for one to finish.",
      not_logged: "The activity log could not be written, so no file was made. Try again.",
      no_orders: "None of those order numbers belong to this store.",
      failed: "The export could not be made. Try again.",
    },
  },
  /** What the AI's ranking against the plain one adds up to (D139), with what to do next. */
  recommendVerdicts: {
    tooFew: "Too few visitors to say yet: wait for at least {n} in each ranking (the plain ranking's share is the smaller one, so raise it if this takes too long).",
    none: "No clear difference between the AI's order and the plain one yet. Keep it running, or switch the AI off to save its tokens if it stays that way.",
    plain: "The plain ranking is doing better than the AI's order on this measure: consider switching the AI off for recommendations.",
    ai: "The AI's order is doing clearly better than the plain ranking on this measure: keep it on.",
  },
  /** The owner's Billing (D107): the plans of every store they own. */
  ownerBilling: {
    title: "Billing",
    description: "The plan of each store you own, what it costs and when it renews. Change a plan in the store's own billing.",
    none: "You do not own a store yet, so there are no plans to show.",
    perMonth: "Plans per month ({currency})",
    yearlyCounted: "Yearly plans counted by the month",
    withoutPlan: "Stores without a plan",
    plans: "Your stores' plans",
    noPlan: "No plan",
    per: "{price} / {interval}",
    ends: "Ends {date}",
    renews: "Renews {date}",
    fee: "{fee} % fee on sales",
    manage: "Manage",
  },
  /** Duplicating one of the account's stores (D129): the page around the wizard. */
  copyPage: {
    back: "Your stores",
    title: "Duplicate {name}",
    titleAny: "Duplicate a store",
    description: "Make a new store from this one. Choose what comes along; the new store starts closed and you are its owner.",
    limit: "You can own up to {max} stores. Contact Kaizena Flow for more.",
  },
  /** A shop invoice's or credit note's print page (D159). */
  invoicePrint: {
    invoiceGone: "This invoice has been anonymised",
    invoiceGoneText: "The retention period has passed, so the buyer's details were removed from this invoice. Its number, date and amounts are kept.",
    backInvoices: "Back to the invoices",
    creditNoteGone: "This credit note has been anonymised",
    creditNoteGoneText: "The retention period has passed, so the buyer's details were removed from this credit note. Its number, date and amounts are kept.",
    backCreditNotes: "Back to the credit notes",
  },
  /** Why an order has no invoice yet (`ELIGIBILITY_WORDS`, `WAITING_WORDS`), as staff read it (D159). */
  invoiceReasons: {
    eligibility: {
      copied: "History copied from another store is never invoiced.",
      host: "A host's order is invoiced by the host, not by the store.",
      not_paid: "The order has not been paid, so it has no invoice.",
      test_mode: "Paid in Stripe's test mode: a test order gets no invoice, so the legal numbers are not used up.",
      disabled: "Invoicing is switched off for this store, or the order was paid before it was switched on.",
      zero_total: "The order's total is 0, so there is nothing to invoice.",
      ok: "The order is eligible for an invoice.",
    } as Record<string, string>,
    waiting: {
      seller_details: "Complete your business details (legal name, address, organisation number, country, and a VAT number when you are registered).",
      tax_profile_missing: "Save your tax profile, so it is known whether you are registered for VAT.",
      vat_charged_not_registered: "The order charged VAT, but your tax profile says you are not registered for VAT, and an invoice may not state VAT then. Correct the tax profile, or ask your accountant.",
      no_exchange_rate: "The invoice needs the VAT in your country's currency, and the store has no rate between the two currencies.",
      invoice_failed: "Making the invoice failed; it is tried again every five minutes. The error is in the order's history.",
    } as Record<string, string>,
  },
  /** One of Kaizena Flow's installed themes on its own pages (D252): the bar over the preview. */
  themePreview: {
    bar: "Preview of “{theme}”{live} on {page}: nothing is saved, and visitors do not see it",
    live: ", the live theme,",
    page: "“{title}”",
    noPage: "no page",
    back: "Back to the theme",
    pages: "Pages to preview",
    nothing: "Kaizena Flow has no published page to show yet.",
  },
  /** One of Kaizena Flow's pages chosen for a place of its own (D143). */
  pagePlace: {
    shows: "{name} shows",
    untitled: "Untitled",
    notPublished: " (not published)",
    save: "Save",
    start: "Start from a new page",
    startHint: "Makes a page like the standard one, publishes it here and opens it in the builder.",
    unpublished: "This page is not published, so visitors see {standard} until you publish it again.",
  },
  /** A product layout's preview with one of the store's products (D79). */
  layoutPreview: {
    noProduct: "Add a product with a price to see the layout with it.",
    shownWith: "Shown with",
    show: "Show",
  },
  /** What a store whose online shop is off says while orders can still be withdrawn from or returned (D178). */
  afterSale: {
    withdrawable: { one: "{n} order can still be withdrawn from or returned", many: "{n} orders can still be withdrawn from or returned" },
    openReturns: { one: "{n} return is still open", many: "{n} returns are still open" },
    and: ", and ",
    note: "The online shop is off. {parts}, so Orders and Returns stay here until they are done, and the storefront keeps its withdrawal link.",
    orders: "Orders",
    returns: "Returns",
  },
  /** The products page's part of the unit price (D160): the products that still need a content. */
  unitGaps: {
    notice: { one: "{n} active product still needs its content for the price per kg or litre.", many: "{n} active products still need their content for the price per kg or litre." },
    show: "Show them",
    none: "No product needs content for the unit price.",
    intro: "These products are on sale without a price per kg or litre. They stay on sale and the shop shows no unit price for them, until you give each shipped variant its content in the product's editor; saving one before then is refused.",
    caption: "Products that need content for the unit price",
    product: "Product",
    why: "Why",
    variants: "Variants without content",
    byMeasure: "Sold by measure",
    category: "Category {category}",
  },
  /** Where refunded or cancelled units go back to (D172), on the order's refund and cancel forms. */
  putBack: {
    noRecord: "No record of where these were taken from: they go back to {location}.",
    allBack: "Everything taken has already gone back: any more goes to {location}.",
    movedOne: "Taken from {parts}. {moved} is not active, so those units go back to {location}.",
    movedMany: "Taken from {parts}. {moved} are not active, so those units go back to {location}.",
    and: " and ",
    back: "They go back where they were taken from: {parts}.",
  },
  /** What Work's settings say about turning it off: it hides, and nothing is lost. */
  workSwitchOff: {
    note: "Turning Work off hides it here and in the store. Everything you saved is kept, and turning it on again brings it back.{keeps}",
    keeps: " It has {parts}.",
    invoices: { one: "{n} issued invoice", many: "{n} issued invoices" },
    timers: { one: "{n} running timer", many: "{n} running timers" },
    and: " and ",
  },
  /** The owner's AI usage page (D106): what the page says around the report. */
  ownerUsage: {
    ownerIntro: "What the AI used for {who}, {period}. Kaizena Flow's AI is included in your plan; usage on a key of your own is billed by that provider.",
    yourStores: "the stores you own",
    allMyStores: "All my stores",
    storeNav: "Store",
    noneOwned: "You do not own a store yet, so there is no usage to show.",
  },
  /** The bar over a template's preview (D125). */
  templatePreview: {
    previewBar: "Preview — nothing is saved or copied",
    kindFor: "{kind} for {types}",
    previewLine: "{name} · {what} · by {publisher}",
  },
  /** Work's report totals: what each figure counts. */
  workReport: {
    withoutVat: "without VAT",
    withoutVatCredited: "without VAT, after {amount} credited",
    paidSub: "on those invoices, with VAT",
    owedSub: "still owed on them, with VAT",
  },
  /** Why the WordPress plugin's approval address is not one (`readApproval()` in `src/lib/wordpress.ts`), by its code. */
  wordpressProblems: {
    site: "The site's address is missing, or is not an https address.",
    return: "The return address does not belong to the site.",
    state: "The request has no valid state.",
    challenge: "The request has no valid code challenge.",
  },
  /** The storefront API's routes on Settings, API (`STOREFRONT_ROUTES` in `src/lib/storefront-api.ts`, whose words the published contract keeps), by `what`. */
  storefrontRoutes: Object.fromEntries(STOREFRONT_ROUTES.map((route) => [route.what, route.text])) as Record<string, string>,
  /** The analytics tables' captions (`ANALYTICS_TABLES` in `src/lib/analytics-export.ts`), which the Download CSV button names for a screen reader. */
  analyticsCaptions: Object.fromEntries(Object.entries(ANALYTICS_TABLES).map(([id, table]) => [id, table.caption])) as Record<string, string>,
  /**
   * Analytics' notes (D152): the reports in `src/server/analytics-*-data.ts` write them from these English templates for the page, the AI
   * manager and the exports alike, and a page in another language says them in its own with `noteIn()` (`src/lib/analytics-notes.ts`), which
   * knows a note by its English template. A count is a `{ one, many }` pair; `phrases` are the parts a template takes as a value.
   */
  analyticsNotes: {
    traffic: {
      countingOff: "Visit counting is off, so visits, the funnel and where orders came from are not known. Switch it on in the analytics settings.",
      noneCounted: "No visit has been counted yet.",
      partial: "Visits have been counted since {day}, so these figures cover only the days from then.",
      outside: {
        one: "{n} paid order falls outside the days with counted visits and is left out of the rates.",
        many: "{n} paid orders fall outside the days with counted visits and are left out of the rates.",
      },
      unconverted: {
        one: "{n} paid order in {currencies} could not be converted, so it is left out.",
        many: "{n} paid orders in {currencies} could not be converted, so they are left out.",
      },
      staff: {
        one: "{n} staff-made paid order (a draft order) is left out of these tables and of conversion: it was not a visit. It is in the period's revenue and in the Marketing page's channel table as Staff-made.",
        many: "{n} staff-made paid orders (draft orders) are left out of these tables and of conversion: they were not visits. They are in the period's revenue and in the Marketing page's channel table as Staff-made.",
      },
      exchanges: {
        one: "{n} paid exchange order (a replacement for a return) is left out of these tables and of conversion: it was not a visit. It is in the period's revenue and in the Marketing page's channel table as Exchanges.",
        many: "{n} paid exchange orders (replacements for a return) are left out of these tables and of conversion: they were not visits. They are in the period's revenue and in the Marketing page's channel table as Exchanges.",
      },
      landing: "Only the {n} landing pages with most visits are shown.",
      costsMissing: "Product costs are missing for some channels' sales, so their contribution and the blended one are not shown.",
      spendOutside: "Spend entered for days with no counted visits is left out of CAC and ROAS.",
    },
    search: {
      revenue:
        "Revenue after a search counts paid orders placed after the search from a cart of the same visit. Searches are tied to a visit only while visit counting is on, and never when the shopper's browser asks not to be tracked.",
      revenueOff: "Revenue after a search is counted only while visit counting is on: no search in this period is tied to a visit.",
    },
    refunds: {
      notSeen:
        "Refunds made in Stripe's or Mollie's own dashboard are included once the provider reports them, with the reason it was given there; a refund the provider cannot match to an order here is not. Other reasons are what staff wrote.",
      unconverted: {
        one: "{n} refund in {currencies} is left out: the store has no exchange rate for it.",
        many: "{n} refunds in {currencies} are left out: the store has no exchange rate for it.",
      },
      revenueUnconverted: "Paid orders in {currencies} are left out of revenue: the store has no exchange rate for it.",
      productsTruncated: "More than {n} refunds were made: the products are made of the biggest ones.",
      reasonsTruncated: "The reasons are made of the biggest refunds only: there were very many different texts.",
    },
    returns: {
      notSeen: "Returns made without Kaizena Flow's withdrawal function or a return request (a parcel sent back with no message) are not included.",
      unconverted: {
        one: "{n} order or return in {currencies} is left out: the store has no exchange rate for it.",
        many: "{n} orders and returns in {currencies} are left out: the store has no exchange rate for it.",
      },
      timingTruncated: "More than {n} returns were refunded in this period: the times are made of the latest ones.",
      maturity: "Orders from the last {n} days can still be returned, so the rates for this period are still rising and are not final.",
      notTracked:
        "No return has been recorded in Kaizena Flow yet, so there is nothing to rate. Returns made through the withdrawal function or a return request appear here.",
      noneSold: { orders: "No goods orders were sold in this period.", units: "No goods units were sold in this period." },
      tooFew: {
        orders: {
          one: "Only {n} order in this period: a rate needs at least {min}, or one return would swing it.",
          many: "Only {n} orders in this period: a rate needs at least {min}, or one return would swing it.",
        },
        units: {
          one: "Only {n} unit in this period: a rate needs at least {min}, or one return would swing it.",
          many: "Only {n} units in this period: a rate needs at least {min}, or one return would swing it.",
        },
      },
      timingNone: "No return was refunded in this period that has {what}.",
      timingFew: {
        one: "Only {n} return refunded with {what}: a typical time needs at least {min}.",
        many: "Only {n} returns refunded with {what}: a typical time needs at least {min}.",
      },
      reasonsNone: "None of the returns in this period has a reason. A withdrawal asks for none, and a shopper is never asked first.",
      reasonsFew: {
        one: "Only {n} return has a reason: shares need at least {min}, so only counts are shown.",
        many: "Only {n} returns have a reason: shares need at least {min}, so only counts are shown.",
      },
      reasonsSome: "{given} of {total} returns have a reason; shares are of those. A withdrawal asks for none.",
      exchangeNotTracked: "No return has been exchanged in Kaizena Flow yet. An exchange is made on a return's page, and appears here once it is settled.",
      exchangeNoneMade: "No return was made in this period.",
      exchangeFew: {
        one: "Only {n} return made in this period: a share needs at least {min}.",
        many: "Only {n} returns made in this period: a share needs at least {min}.",
      },
    },
    subscriptions: {
      unconverted: {
        oneOne: "{s} subscription and {o} order in {currencies} are left out: the store has no exchange rate for it.",
        oneMany: "{s} subscription and {o} orders in {currencies} are left out: the store has no exchange rate for it.",
        manyOne: "{s} subscriptions and {o} order in {currencies} are left out: the store has no exchange rate for it.",
        manyMany: "{s} subscriptions and {o} orders in {currencies} are left out: the store has no exchange rate for it.",
      },
      unvalued: {
        one: "{n} subscription with an unusable renewal interval is left out of the figures.",
        many: "{n} subscriptions with an unusable renewal interval are left out of the figures.",
      },
      truncated: "There are more than {n} different prices: the most common are counted.",
      undated: {
        one: "{n} cancelled subscription has no end date and is left out of churn and the movements.",
        many: "{n} cancelled subscriptions have no end date and are left out of churn and the movements.",
      },
      paused: {
        one: '{n} paused subscription is not in the MRR now, but is counted as active at the start: the difference is in "other".',
        many: '{n} paused subscriptions are not in the MRR now, but are counted as active at the start: the difference is in "other".',
      },
    },
    discounts: {
      unconverted: {
        one: "{n} paid order in {currencies} is left out: the store has no exchange rate for it.",
        many: "{n} paid orders in {currencies} are left out: the store has no exchange rate for it.",
      },
      couponsTruncated: "More than {n} codes were used: the biggest by revenue are shown.",
    },
    /** The cohort sentence of `cohortTrend()` (`src/lib/analytics-customers.ts`, which a client part also imports, so it writes them itself). */
    customers: {
      trendUnknown: "Not enough customers yet to say whether newer customers come back more or less than older ones.",
      trendBetter: "Newer customers come back more often: {recent} of newer customers had bought again by month {offset}, against {older} of older ones.",
      trendWorse: "Newer customers come back less often: {recent} of newer customers had bought again by month {offset}, against {older} of older ones.",
      trendFlat: "Newer and older customers come back about as often: {recent} of newer customers had bought again by month {offset}, against {older} of older ones.",
    },
    phrases: {
      requestDate: "a request date",
      goodsReceivedFirst: "the goods received first",
      noReasonGiven: "No reason given",
    },
  },
};

export type ScreensMessages = Widen<typeof screensEn>;
