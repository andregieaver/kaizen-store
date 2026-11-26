/**
 * The store features' settings words in English (D178, D312 A8, bloat review step 2.50): `settings.features`, which the AI manager and the
 * setup tools read with no language (`FEATURE_WORDS_EN` in `feature-words.ts`). The `settings` catalogue takes the group from here, so that
 * code brings no catalogue; `common.features` is apart in `feature-common-labels.ts`. Imports nothing.
 */

export const FEATURE_SETTINGS_EN = {
  /** Round 34 (D708): on a phone a feature is its name and switch; what it does behind a small i; the times one row. */
  phone: { about: "What {label} does", change: "Change", done: "Done", noReminder: "no reminder" },
  title: "Features",
  description: "Switch on what your store uses; the rest stays out of your way. Nothing is deleted when you switch something off.",
  count: "{on} of {total} on",
  onlyOwner: "Only an owner can switch features on or off.",
  inUse: "In use",
  needs: "Needs {list}",
  needsAsleep: ". Its switch is kept for when that is on.",
  and: " and ",
  setUp: "Set up",
  switchOffRegion: "Switch off {label}",
  switchOffQuestion: "Switch off {label}?",
  cantYet: "It can't be switched off yet:",
  open: "Open",
  switchOff: "Switch off",
  close: "Close",
  keepOn: "Keep it on",
  groups: { selling: "Selling", world: "Countries and languages", customers: "Customers", team: "Working together" },
  /** What a feature does, and what switching it off does, by id (`STORE_FEATURES`). */
  items: {
    shop: {
      words: "Sell online: products with prices, a cart, checkout and orders. Off, the store is a website.",
      offWords:
        "The store becomes a website: products, prices, the cart, checkout and My account leave the site, and Orders, Products, Customers, selling marketing and sales analytics leave the admin, with every selling feature below. Orders stay reachable while one can still be withdrawn from or returned. Nothing is deleted: switch it on and everything is as it was.",
    },
    subscriptions: {
      words: "Products bought on a schedule, every week, month or year, with a discount for subscribing.",
      offWords: "Subscribing leaves product pages, and Subscriptions leaves the admin. Past subscriptions stay on their orders.",
    },
    boxes: {
      words: "Customers keep a list of what they want in a box, delivered on your delivery days.",
      offWords: "Subscription boxes leave the admin, My account and product pages. Delivery days and past orders are kept.",
    },
    appointments: {
      words: "Sell time with your staff, such as treatments, consultations or lessons, booked on the product page.",
      offWords: "Appointments can no longer be booked, and Staff and hours leaves the admin. Past bookings stay on their orders.",
    },
    bookings: {
      words: "Rooms, homes and items booked by the night, day or hour, and outside hosts who list them in your store.",
      offWords:
        "Stays and rentals can no longer be booked, and Rooms and items, Stays and rentals and Hosts leave the admin. Past bookings stay on their orders.",
    },
    gift_cards: {
      words: "Sell gift cards of the amounts you choose, emailed to the buyer or straight to the person they are for, on the day chosen.",
      offWords: "Gift cards can no longer be bought. Cards already sold can still be used and refunded: the money is the customer's.",
    },
    countries: {
      words: "Sell in more countries than your own, each with its own prices, shipping and address.",
      offWords: "Only your own country is offered. The other countries' prices and settings are kept for when you switch it on again.",
    },
    languages: {
      words: "Show the store in more than one language, with translations of products, pages and emails.",
      offWords: "Each country is shown in its own language only. Translations are kept for when you switch it on again.",
    },
    currencies: {
      words: "Let shoppers see prices in other currencies, converted at your exchange rates.",
      offWords: "Shoppers see prices in each country's own currency. Your extra currencies and rates are kept.",
    },
    business: {
      words: "Prices without VAT for businesses, company accounts, VAT numbers at checkout and products for businesses only.",
      offWords:
        "Businesses buy as private shoppers do, with VAT, and products for businesses only are hidden; Companies leaves the admin. Company accounts and past orders are kept.",
    },
    bonus: {
      words: "Customers earn credits on what they pay and use them as a price reduction.",
      offWords:
        "Customers stop earning and using credits, and Bonus credits leaves the admin. Their credits are kept, and do not expire, until you switch it on again.",
    },
    referrals: {
      words: "Customers share a link; a friend gets a welcome discount and the customer earns bonus credits. Needs the bonus program.",
      offWords:
        "Referral links stop giving discounts and new orders earn no rewards, and Refer a friend leaves the admin. Orders already placed are still rewarded; referrers and their history are kept.",
    },
    reviews: {
      words: "Customers review what they bought and received; you check them before they show, and the product page shows the stars.",
      offWords: "Reviews stop showing and customers cannot write new ones, and Reviews leaves the admin. Every review is kept for when you switch it on again.",
    },
    sales: {
      words: "Follow what each customer or company may buy, from the first talk to won or lost, on a board in stages.",
      offWords: "Deals leaves the admin and the customer pages. Every deal and pipeline is kept for when you switch it on again.",
    },
    projects: {
      words: "Plan the team's work: checklists, and projects with a board, statuses, who does what and when it is due.",
      offWords: "Projects and Checklists leave the admin. Every project, list and item is kept for when you switch it on again.",
    },
  },
  /** What stops a feature being switched off (`featureBlockers()`). */
  blockers: {
    paidUnshipped: { one: "{n} paid order has goods still to send. Send or refund it first.", many: "{n} paid orders have goods still to send. Send or refund them first." },
    subscriptions: { one: "{n} subscription is still running. Cancel it first.", many: "{n} subscriptions are still running. Cancel them first." },
    boxLists: {
      one: "{n} subscription box list is still active or paused. Cancel it first.",
      many: "{n} subscription box lists are still active or paused. Cancel them first.",
    },
    boxOrders: {
      one: "{n} subscription box order is waiting to be sent and paid. Send or cancel it first.",
      many: "{n} subscription box orders are waiting to be sent and paid. Send or cancel them first.",
    },
    appointments: {
      one: "{n} appointment is still to come. Cancel it first, or wait until they have taken place.",
      many: "{n} appointments are still to come. Cancel them first, or wait until they have taken place.",
    },
    stays: {
      one: "{n} stay or rental is still to come. Cancel it first, or wait until they are over.",
      many: "{n} stays and rentals are still to come. Cancel them first, or wait until they are over.",
    },
    hostCommissions: {
      one: "{n} host's commission is not paid out yet. Wait until it is settled.",
      many: "{n} hosts' commissions are not paid out yet. Wait until they are settled.",
    },
    foreignSubscriptions: { one: "{n} subscription runs in another country. Cancel it first.", many: "{n} subscriptions run in another country. Cancel them first." },
    foreignBoxes: {
      one: "{n} subscription box list is for another country. Cancel it first.",
      many: "{n} subscription box lists are for another country. Cancel them first.",
    },
    foreignUnsent: {
      one: "{n} paid order has goods still to send to another country. Send or refund it first.",
      many: "{n} paid orders have goods still to send to another country. Send or refund them first.",
    },
  },
  /** What is worth knowing before switching a feature off (`featureWarnings()`). */
  warnings: {
    openCheckouts: { one: "{n} order is waiting for payment. Customers can still pay it.", many: "{n} orders are waiting for payment. Customers can still pay them." },
    subscriptionProducts: { one: "{n} product has purchase options. They are kept, but not offered.", many: "{n} products have purchase options. They are kept, but not offered." },
    deliverySchedules: { one: "{n} delivery day is kept, but not offered.", many: "{n} delivery days are kept, but not offered." },
    appointmentProducts: { one: "{n} appointment product can no longer be booked.", many: "{n} appointment products can no longer be booked." },
    stayProducts: { one: "{n} stay or rental product can no longer be booked.", many: "{n} stay and rental products can no longer be booked." },
    hosts: { one: "{n} host can no longer list stays and rentals in the store.", many: "{n} hosts can no longer list stays and rentals in the store." },
    otherCountries: {
      one: "{n} country besides your own is no longer offered to shoppers. Its addresses lead to your own country, and orders already placed there keep their pages and links.",
      many: "{n} countries besides your own are no longer offered to shoppers. Their addresses lead to your own country, and orders already placed there keep their pages and links.",
    },
    foreignCarts: { one: "{n} open cart is in another country. It can no longer be ordered.", many: "{n} open carts are in another country. They can no longer be ordered." },
    otherLanguages: {
      one: "{n} language besides your countries' own is no longer shown to shoppers. Translations are kept.",
      many: "{n} languages besides your countries' own are no longer shown to shoppers. Translations are kept.",
    },
    extraCurrencies: {
      one: "{n} extra currency is no longer offered. Open carts are shown in their country's own currency.",
      many: "{n} extra currencies are no longer offered. Open carts are shown in their country's own currency.",
    },
    businessCarts: { one: "{n} open cart holds a VAT number that will no longer be used.", many: "{n} open carts hold a VAT number that will no longer be used." },
    businessProducts: { one: "{n} product is for businesses only.", many: "{n} products are for businesses only." },
    companies: { one: "{n} company account no longer gets a discount.", many: "{n} company accounts no longer get a discount." },
    credits: {
      one: "{n} customer holds {amount} in credits. They can't use them while the program is off; nothing is taken away, and expiry dates that pass meanwhile are moved on by as long as it was off.",
      many: "{n} customers hold {amount} in credits. They can't use them while the program is off; nothing is taken away, and expiry dates that pass meanwhile are moved on by as long as it was off.",
    },
    referrers: { one: "{n} customer has a referral link that stops giving discounts.", many: "{n} customers have a referral link that stops giving discounts." },
    pendingReferrals: {
      one: "{n} reward is still pending: it was earned while the program was on, so it is decided as usual.",
      many: "{n} rewards are still pending: they were earned while the program was on, so they are decided as usual.",
    },
    giftCardProducts: { one: "{n} gift card product can no longer be bought.", many: "{n} gift card products can no longer be bought." },
    giftCardsHeld: { one: "{n} gift card still holds money. It can still be used and refunded.", many: "{n} gift cards still hold money. They can still be used and refunded." },
    publishedReviews: {
      one: "{n} published review stops showing on your product pages. Nothing is deleted.",
      many: "{n} published reviews stop showing on your product pages. Nothing is deleted.",
    },
    openDeals: {
      one: "{n} deal is still open. It is kept, and is there again when you switch Deals on.",
      many: "{n} deals are still open. They are kept, and are there again when you switch Deals on.",
    },
    openTasks: {
      one: "{n} task is still open. It is kept, and is there again when you switch Projects and checklists on.",
      many: "{n} tasks are still open. They are kept, and are there again when you switch Projects and checklists on.",
    },
    asleep: {
      one: "{labels} needs it, so it stops too. Its own switch is kept for when you switch it on again.",
      many: "{labels} need it, so they stop too. Their own switch is kept for when you switch it on again.",
    },
    listSeparator: ", ",
  },
  times: {
    title: "Time zone and reminders",
    text: "Where the store's times are: appointments, stays and rentals, and subscription boxes' cutoffs are shown in it.",
    timeZone: "Time zone",
    reminder: "Appointment reminder email",
    sendNone: "Send none",
    hoursBefore: "{n} hours before",
    daysBefore: "{n} days before",
    reminderHint: "Shoppers get a reminder with the time, place and a calendar file. Those who book closer to the time than this get only their confirmation.",
  },
  actions: {
    onlyOwners: "Only an owner can switch features on or off.",
    noFeature: "There is no such feature.",
    notOffered: "{label} is not open to this store yet.",
    onlyOwnerSettings: "Only an owner can change these settings.",
    needs: { one: "{label} needs {needs}. Switch it on first.", many: "{label} needs {needs}. Switch them on first." },
    cantYet: "{label} can't be switched off yet.",
    confirm: "Confirm to switch it off.",
    accountsOff: "{label} needs customer accounts. Turn them on under Settings → Checkout first.",
  },
};
