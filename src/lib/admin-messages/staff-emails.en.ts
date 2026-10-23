import type { Widen } from "./common.en";

/**
 * The words of the emails Kaizena Flow sends owners and staff (D312 A10): staff alerts, low stock, disputes, security, store closure, plan reminders, A/B test stops, support waiting, in the recipient account's admin language. `{name}`-style placeholders are filled by `fillWords()`; a count is a `{ one, many }` pair read by
 * `countWords()`, with `{n}` the number.
 */
export const staffEmailsEn = {
  footer: "Kaizena Flow · kaizenaflow.com",
  security: {
    subjects: {
      recovery_code_used: "A recovery code was used on your account",
      two_step_removed: "Two-step sign-in was switched off on your account",
      two_step_reset: "Your two-step sign-in was reset",
    },
    intros: {
      recovery_code_used:
        "A recovery code was used to get into your Kaizena Flow account on {when}. Using a recovery code takes your two-step sign-in away, so you are asked to set it up again the next time you sign in, and your other recovery codes no longer work.",
      two_step_removed:
        "Two-step sign-in was switched off for your Kaizena Flow account on {when}.",
      two_step_reset:
        "A platform admin{by} reset the two-step sign-in of your Kaizena Flow account on {when}. You are asked to set it up again the next time you sign in.",
    },
    by: " ({by})",
    hello: "Hello {person},",
    wasYou: "If this was you, there is nothing more to do.",
    notYou:
      "If it was not you, someone else may have access to your account. Sign in, change your password at once and set up two-step sign-in again, then tell the owner of your store.",
    signIn: "Sign in",
  },
  guardrail: {
    days: { one: "{n} day", many: "{n} days" },
    figures:
      "{vBuyers} of {vVisitors} visitors who saw version {letter} ordered ({vRate}), against {oBuyers} of {oVisitors} who saw the original ({oRate}).",
    subject:
      'Your A/B test "{test}" was stopped: fewer orders in version {letter}',
    preview:
      "Version {letter} clearly got fewer orders than the original, so Kaizena Flow stopped the test. Everyone sees the original again.",
    heading: "Kaizena Flow stopped your A/B test",
    stopped:
      'The test "{test}" of {target} in {store} had run for {days} when version {letter} ({version}) clearly got fewer orders per visitor than the original. It was far enough behind that luck is a very unlikely reason, so Kaizena Flow stopped the test to protect your sales.',
    nobodyNew:
      "Nobody new is given a version any more, and everyone sees the page as it was before the test. Nothing was changed on it and what was counted is kept.",
    openResults:
      "Open the results to read them. You can discard the test, or, if you still want to use one of the other versions, apply it. Kaizena Flow does not apply anything by itself.",
    button: "See the results",
    partOn: "{part} on {page}",
  },
  alerts: {
    more: "…and {n} more.",
    newOrder: {
      orderTotal: "Order total",
      chargedNow: "Charged now",
      dueAtVenue: "Due at the venue",
      totalCharged: "Total charged",
      renewal: "Subscription renewal",
      business: "Business buyer",
      host: "Host's listing: {host}",
      gift: "Gift",
      held: "On hold by a rule",
      subject: "New order {number}: {total}",
      preview: "{store} has a new paid order, {number}, of {total}.",
      heading: "New order",
      venueText: "Order {number} of {total} is confirmed: {charged} charged now, {due} due at the venue.",
      paidText: "Order {number} is paid: {total}.",
      delivery: "Delivery: {delivery}",
      country: "Country: {country}",
      button: "Open the order",
      pickup: "Pickup",
      local: "Local delivery",
      shipping: "Shipping",
      none: "No delivery",
    },
    returnRequested: {
      withdrawal: "Withdrawal",
      return: "Return",
      subject: "{what} requested: {number} (order {order})",
      preview: "A customer asked to send back items of order {order}.",
      headingWithdrawal: "A customer withdrew",
      headingReturn: "A return was requested",
      text: "{what} {number} for order {order}.",
      button: "Open the return",
    },
    summary: {
      periodDay: "yesterday ({to})",
      periodWeek: "the week {from} to {to}",
      paidOrders: "Paid orders",
      netSales: "Net sales, excl. VAT",
      refunds: "Refunds, excl. VAT",
      returnsRequested: "Returns requested",
      openReturns: "Open returns",
      toSend: "Orders to send",
      lowStock: "Variants at or below their stock level",
      supportWaiting: "Conversations waiting in support",
      subjectDay: "{store}: daily summary for {to}",
      subjectWeek: "{store}: weekly summary for {from} to {to}",
      noOrdersDay: "No orders yesterday.",
      noOrdersWeek: "No orders last week.",
      ordersPreview: { one: "{n} paid order, {net} net.", many: "{n} paid orders, {net} net." },
      headingDay: "Your day",
      headingWeek: "Your week",
      noneDay: "No orders yesterday. This is {period}.",
      noneWeek: "No orders in the week. This is {period}.",
      intro: "This is {period}, in your store's own days.",
      unconverted: { one: "{n} order or refund in {currencies} are not included: no exchange rate.", many: "{n} orders or refunds in {currencies} are not included: no exchange rate." },
      now: "Now:",
      analytics: "Open Analytics",
      orders: "Open Orders",
    },
    dispute: {
      subjectOpened: "Payment disputed: order {order}, {amount}",
      subjectDue: "Dispute evidence due{due}: order {order}",
      previewOpened: "The customer's bank disputed {amount} of order {order}.",
      previewDue: "Send Stripe your evidence for order {order} before the deadline.",
      headingOpened: "A payment was disputed",
      headingDue: "A dispute's deadline is near",
      textOpened: "The customer's bank disputed {amount} of order {order}. Stripe holds the amount until the dispute is decided.",
      textDue: "Stripe needs your evidence for the dispute on order {order}. Without it the dispute is lost.",
      amount: "Amount",
      reason: "Reason",
      status: "Status",
      evidenceDue: "Evidence due",
      deadline: "Deadline",
      evidence: "Evidence is sent in your Stripe Dashboard.",
      stripe: "Open the dispute in Stripe",
      order: "Open the order",
    },
    capture: {
      subject: "Capture the payment of order {order} by {due}",
      preview: "The card is held for {amount}. After {due} the hold ends and the order is cancelled.",
      heading: "A held payment is about to end",
      text: "The customer's card is held for {amount} on order {order}. Capture it by {due}; after that Stripe lets the hold go and the order is cancelled, its stock released.",
      button: "Open the order",
    },
    termsOverdue: {
      subject: "Order {order} is overdue: {amount} was due on {due}",
      preview: "The invoice for order {order} was not paid by its due day.",
      heading: "A payment on terms is overdue",
      text: "{amount} for order {order} was due on {due} and has not been recorded as paid. The customer has been sent a notice. When the money arrives outside Kaizena Flow, record it on the order.",
      button: "Open the order",
    },
    lowStock: {
      line: "{stock} left, level {level}",
      subjectOne: "Low stock: {product}",
      subjectMany: "Low stock: {n} products at or below their level",
      preview: { one: "{n} variant has reached the low-stock level you set.", many: "{n} variants have reached the low-stock level you set." },
      heading: "Stock is running low",
      textOne: "This variant has reached the low-stock level you set. You hear about each one once, when it crosses its level.",
      textMany: "These variants have reached the low-stock level you set. You hear about each one once, when it crosses its level.",
      button: "Open the Inventory page",
    },
    testPrefix: "[Test] {subject}",
  },
  supportWaiting: {
    subject: "Someone is waiting in {where}'s support",
    preview: "A conversation has waited {minutes} min for a person.",
    heading: "Someone is waiting for a person",
    text: "A conversation in {where}'s support has waited {minutes} min, and nobody who can answer is online. Open the inbox to take it.",
    button: "Open the inbox",
    why: "You get this because you may answer this support desk and were not online. You hear about each conversation once for each time it waits.",
  },
  bookingStaff: {
    subject: "New booking: {title}, {when}",
    heading: "New booking",
    customer: "Customer: {customer}\nOrder {order}",
    button: "See the order",
  },
  planReminder: {
    line: "Kaizena Flow {plan}, paid {interval}",
    yearly: "yearly",
    monthly: "monthly",
  },
  closure: {
    byOwner: "was closed from its settings",
    byPlatform: "was closed by Kaizena Flow",
    reason: " Reason given: {reason}",
    button: "Open the store in the admin",
    closedSubject: "{name} is closed",
    closedPreview:
      "{name} no longer takes orders. Its orders, invoices and customer data stay available to you.",
    closedText:
      "{name} {who}. The shop no longer takes orders, its Kaizena Flow plan ends when the period you have paid for is over, and its own domains are released.{reason}",
    nothingDeleted:
      "Nothing was deleted. You can still open the store's orders, invoices, returns and customer data in the admin, and download them: invoices and orders are kept for the bookkeeping period of the seller's country, and then made anonymous.",
    reopenUntil:
      "You can reopen the store yourself until {day} ({days} days). After that, ask Kaizena Flow.",
    askToReopen: "To reopen the store, ask Kaizena Flow.",
    suspendedSubject: "{name} is suspended",
    suspendedPreview:
      "{name} is paused by Kaizena Flow and takes no orders until it is reopened.",
    suspendedText:
      "Kaizena Flow has suspended {name}. The shop takes no orders and cannot be changed until Kaizena Flow reopens it.{reason}",
    suspendedStill:
      "You can still see orders, invoices, returns and customer data in the admin and handle what has already been sold. Reply to this email or write to Kaizena Flow to have the store reopened.",
    reopenedSubject: "{name} is open again",
    reopenedPreview: "{name} is reopened and takes orders again.",
    reopenedByOwner: " from its settings",
    reopenedByPlatform: " by Kaizena Flow",
    reopenedText:
      "{name} was reopened{by}. The shop takes orders again. If you had closed it, add its own domains again under Settings, Domains, and check that its Kaizena Flow plan is still on.",
  },
};

export type StaffEmailsMessages = Widen<typeof staffEmailsEn>;
