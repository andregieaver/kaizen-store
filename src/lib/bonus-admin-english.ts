/**
 * The bonus program's English sentences (D130) that code with no language reads too (bloat review step 2.50): the AI manager's tools and the
 * tests read them here, and the `loyalty` catalogue (`admin-messages/loyalty.en.ts`) takes them from here, so neither brings both languages
 * of the catalogue. Imports nothing.
 */

export const BONUS_EXPLANATION = "Customers who are signed in earn credits on what they buy and use them as a price reduction on a later order. Guests earn nothing. Credits wait for the return period before they can be used, and a refund takes back what the refunded part earned.";

export const BONUS_ACCOUNTING_NOTE = "Credits are a price reduction when they are used. Talk to your accountant about how to book credits that are still unused.";

export const BONUS_RULES = {
  decimal: ".",
  earn: "You earn {percent}% back in bonus credits on what you pay for goods, and the credits are usable {wait}.",
  none: "Customers earn no bonus credits: credits back is 0%.",
  use: "Credits come off the price of goods at checkout, up to the store's limit on each order. You pay shipping yourself.",
  useExpires:
    "Credits come off the price of goods at checkout, up to the store's limit on each order; you pay shipping yourself. Credits you do not use expire {months} after you earn them, the oldest first.",
  limit: "The store's limit: credits can pay for up to {percent}% of an order's goods.{least} 1 credit is worth 1 {currency}.",
  least: " At least {amount} is used at a time.",
  reminder: "Customers are emailed a reminder before their credits expire.",
  rightAfter: "right after you pay",
  after: "{days} after you pay",
  days: { one: "{n} day", many: "{n} days" },
  months: { one: "{n} month", many: "{n} months" },
  level: "{name}: from {from} paid for goods in the last 12 months, less refunds, customers earn {percent}% back.",
  signup: "A customer who opens an account gets {amount} in bonus credits once, usable at once.",
  birthday: "On their birthday, a customer who gave it on My account gets {amount} in bonus credits, usable at once.",
};

export const BONUS_OVERVIEW = {
  heading: "Credits at a glance",
  outstanding: "Outstanding credits",
  outstandingHint: "Usable now: what the store still owes in price reductions.",
  pending: "Pending",
  pendingHint: "Earned, but waiting for the return period.",
  earned: "Earned, last 30 days",
  used: "Used, last 30 days",
  expired: "Expired, last 30 days",
  customers: "Customers with credits",
};

export const BONUS_ADJUST = {
  amountProblem: "Write an amount such as 50 to add, or -20 to take away.",
  zero: "The amount cannot be 0.",
  noteShort: "Write a reason of at least {min} characters; the customer's history keeps it.",
  noteLong: "Keep the reason to {max} characters or fewer.",
  addQuestion: "Add {amount} in credits to {who}?",
  takeQuestion: "Take {amount} in credits from {who}?",
  added: "Added {amount} in credits. It is in their history with your reason.",
  took: "Took {amount} in credits. It is in their history with your reason.",
  reason: "Reason: ",
  working: "Working …",
  yesAdd: "Yes, add the credits",
  yesTake: "Yes, take the credits",
  back: "Back",
  amount: "Amount",
  amountHint:
    "Write 50 to add credits, which can be used at once, or -20 to take some away, available credits first and then those still waiting. Available now: {available}. Credits cannot go below zero.",
  reasonLabel: "Reason",
  reasonHint: "Required. It stays in the customer's history, and staff see it.",
  review: "Review",
};
