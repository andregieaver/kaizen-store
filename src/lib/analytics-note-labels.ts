/**
 * The analytics reports' notes in English (D152, D312, bloat review step 2.50): the data servers write their notes in these words, the AI
 * manager and the CSV read them so, and `sayIn()` (`analytics-say.ts`) matches them to say a note in the admin's language. The `screens`
 * catalogue takes its `analyticsNotes` from here, so the report servers bring no catalogue. Imports nothing.
 */

export const ANALYTICS_NOTES_EN = {
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
};
