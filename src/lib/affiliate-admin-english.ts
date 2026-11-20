/**
 * The affiliate program's English sentences (D131) that code with no language reads too (bloat review step 2.50): the AI manager's tools and
 * the tests read them here, and the `loyalty` catalogue (`admin-messages/loyalty.en.ts`) takes them from here, so neither brings both
 * languages of the catalogue. Imports nothing.
 */

export const AFFILIATE_EXPLANATION = "Signed-in customers get their own link to share. When a friend orders for the first time through it, the friend gets a welcome discount and the customer who shared it earns bonus credits. Only new customers count, and credits are taken back if the order is refunded or cancelled.";

export const AFFILIATE_NEEDS_BONUS = "The reward is bonus credits, so the referral program works only while the bonus program is on. Turn the bonus program on under Bonus credits first.";

export const AFFILIATE_RULES = {
  decimal: ".",
  friend: "A friend gets {percent}% off the goods in their first order{max}.",
  friendMax: ", at most {amount}",
  noFriend: "A friend gets no welcome discount.",
  every: "every order",
  first: "the friend's first order",
  firstN: "the friend's first {n} orders",
  reward: "The customer who shared the link earns {percent}% of what the friend pays online for goods, as bonus credits, for {who}. The credits can be used {wait}.",
  rightAfter: "right after the friend pays",
  after: "{days} after the friend pays",
  noReward: "The customer who shared the link earns nothing: the reward is 0%.",
  cap: "One customer can earn at most {amount} a month.",
  cookie: "A visitor's link is remembered for {days}, if they allow marketing cookies.",
  days: { one: "{n} day", many: "{n} days" },
  example: "A first order of {goods} in goods: the friend saves {off} and pays {pays}; the customer who shared the link earns {reward} in credits.",
};

export const AFFILIATE_OVERVIEW = {
  heading: "Referrals at a glance",
  affiliates: "Customers with a link",
  visits: "Visits to links, last 30 days",
  orders: "Orders through links, last 30 days",
  rewarded: "Credits earned by referrers, last 30 days",
  outstanding: "Referral credits usable now",
  outstandingHint: "What the store still owes in price reductions for referrals.",
  pending: "Referral credits pending",
  pendingHint: "Earned, but waiting for the return period.",
  rejected: "Orders that earned nothing, last 30 days",
};
