/**
 * The English words of exchanges and return labels for customers (wave 3, D239, `docs/wave-3-exchanges.md` 2.1 and 2.4): the exchange page, the exchange's
 * state on the return's status page and the order page, and the return label card. Hand-written in nb, sv, da and en (`HAND_WRITTEN_ONLY`: never
 * machine-translated; other languages show English), and every sentence needs legal review before real use (section 8 items 1 to 5 and 7). Not legal advice.
 */

// legal: needs review
export const enExchange = {
  title: "Your exchange",
  returnNumber: (number: string) => `Return ${number}`,
  intro: (store: string) => `${store} proposes an exchange for your return: new goods instead of your money back. Nothing is charged or refunded on this page.`,
  sendBack: "What you send back",
  credit: "Your credit",
  creditStillChanging: "The store has not checked the returned goods yet. If it finds damage, it will propose the exchange again.",
  rowGoods: "The goods you send back",
  rowDeductions: "Deduction for reduced value",
  rowShipping: "Delivery refunded",
  rowReturnShipping: "Return shipping",
  youGet: "What you get",
  each: (amount: string) => `${amount} each`,
  shipping: "Shipping",
  shippingFree: "Free",
  total: "Total of the new order",
  outcomeRefund: (amount: string) => `We refund you ${amount}`,
  outcomeEven: "Nothing more to pay or refund",
  outcomePay: (amount: string) => `You pay ${amount}`,
  agreement:
    "By confirming, you agree that your credit for the return pays for the new order instead of being refunded to the way you paid. Being paid back this way has no fee. If the store refunds you a part, that part goes back to the way you paid.",
  agreementToPay: (amount: string) => `The new order costs more than your credit: you pay the difference, ${amount}, yourself when the store has received your return.`,
  newPurchase: "The new goods are a purchase of their own: you can withdraw from it within 14 days of receiving them, as from any purchase.",
  confirmBy: (date: string) => `If you do not confirm by ${date}, you get your money back as usual.`,
  confirm: "Confirm the exchange",
  decline: "No thanks, refund me instead",
  working: "One moment …",
  confirmed: "Confirmed. We make your new order when your return is processed; you will get an email.",
  confirmedPay: (amount: string) => `You will be asked to pay ${amount} then.`,
  declined: "We will refund you as usual.",
  toPayNow: (amount: string) => `To pay now: ${amount}`,
  payIntro: "Your return is processed and your new order is ready. Pay the difference to complete the exchange.",
  payBy: (date: string) => `If you do not pay by ${date}, you get your money back as usual.`,
  pay: (amount: string) => `Pay ${amount}`,
  payNote: "You pay on the payment provider's own page. Nothing is charged until you confirm there.",
  tooSmall: "The amount is too small to pay by card. The store will contact you, or write to the store.",
  tooManyPresses: "Too many tries. Try again in an hour.",
  creditChanged: "The credit for your return has changed since the proposal was made. The store will send you a new one; until then you get your money back as usual.",
  startFailed: "The payment could not be started. Try again, or write to the store.",
  sellerHeading: "Seller",
  states: {
    proposed: "Waiting for your confirmation",
    confirmed: "Confirmed: waiting for your return to be processed",
    toPay: "Waiting for your payment",
    done: (number: string) => `Your exchange is done: order ${number}`,
    expired: "This proposal has ended. You get your money back as usual.",
    cancelled: "This proposal no longer works. You get your money back as usual; write to the store with any question.",
    refunded: "Your return was refunded, so this proposal no longer applies.",
    paymentsOff: "The store does not take payments right now. Write to the store.",
  },
  contact: (store: string, email: string) => `Questions? Write to ${store} at ${email}.`,
  /** On the return's status page. */
  status: {
    proposed: "Exchange proposed",
    open: "See the proposal",
    confirmed: "Exchange confirmed",
    exchanged: (number: string) => `Exchanged: order ${number}`,
    lapsed: "The exchange did not go through: you are refunded as usual",
    inEmail: "The proposal is in the email the store sent you.",
    payInEmail: "The link to pay is in the email the store sent you.",
  },
  /** On the exchange order's own page. */
  orderLine: (returnNumber: string, orderNumber: string) => `Exchange for return ${returnNumber} of order ${orderNumber}`,
};

// legal: needs review
export const enReturnLabel = {
  heading: "Your return label",
  print: "Print your return label",
  carrier: (name: string) => `Carrier: ${name}`,
  tracking: "Tracking number",
  track: "Track the parcel",
  costOff: (amount: string) => `The cost of the label, ${amount}, is taken off your refund.`,
  costIfUsed: (amount: string) => `If you send the parcel with this label, its cost, ${amount}, is taken off your refund. If you send it another way, nothing is taken off for this label.`,
  freeForYou: "Return shipping is free for you.",
  test: "This is a test label and cannot be used.",
  tooMany: "Too many tries. Try again in an hour.",
  unavailable: "The label cannot be fetched right now. Try again in a moment.",
};

export type ExchangeMessages = typeof enExchange;
export type ReturnLabelMessages = typeof enReturnLabel;
