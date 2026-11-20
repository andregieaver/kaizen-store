/**
 * What stands in the way of closing a store and what is worth knowing first, in English (D171, bloat review step 2.50): beside
 * `store-closure.ts`, whose closing service speaks English to the platform and the AI manager, so the `settings` catalogue takes its
 * `close.blockers` and `close.warnings` from here and a shopper's route that reads `store-closure.ts` brings no catalogue. Imports nothing.
 */

export const CLOSURE_BLOCKERS = {
  paidUnshipped: {
    one: "{n} paid order has goods still to send. Send it or cancel and refund it.",
    many: "{n} paid orders have goods still to send. Send them or cancel and refund them.",
  },
  subscriptions: { one: "{n} subscription is still running. Cancel it first.", many: "{n} subscriptions are still running. Cancel them first." },
  deliveries: { one: "{n} weekly delivery list is still running. Cancel it first.", many: "{n} weekly delivery lists are still running. Cancel them first." },
};

export const CLOSURE_WARNINGS = {
  openCheckouts: { one: "{n} order is waiting for payment. Closing cancels it.", many: "{n} orders are waiting for payment. Closing cancels them." },
  futureBookings: {
    one: "{n} booking is still to come. Closing does not cancel it: contact the customers.",
    many: "{n} bookings are still to come. Closing does not cancel them: contact the customers.",
  },
  openReturns: {
    one: "{n} return is still open. You can keep handling it while the store is closed.",
    many: "{n} returns are still open. You can keep handling them while the store is closed.",
  },
  livePlan: "The Kaizena Flow plan ends when the period you have paid for is over. Nothing is refunded.",
  domains: {
    one: "{n} domain of the store's own is released. You add it again if you reopen.",
    many: "{n} domains of the store's own are released. You add them again if you reopen.",
  },
  stripe: "Money Stripe holds for you is paid out as usual: check your Stripe dashboard for the balance.",
};

/** Both, as `closureBlockers()` and `closureWarnings()` read them. */
export const CLOSURE_EN = { blockers: CLOSURE_BLOCKERS, warnings: CLOSURE_WARNINGS };
