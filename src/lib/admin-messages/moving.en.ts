import type { Widen } from "./common.en";

/**
 * The words of Settings → Moving in (D445 step 2): connecting the Shopify shop a store moves from. `{name}`-style placeholders are filled
 * by `fillWords()`; a count is a `{ one, many }` pair read by `countWords()`, with `{n}` the number.
 */
export const movingEn = {
  title: "Moving in",
  intro: "Bring your shop over from Shopify. We only read your Shopify shop: nothing changes there, and it keeps selling until you move.",
  connect: {
    title: "Bring your Shopify shop",
    label: "Your shop's address",
    placeholder: "myshop.com",
    help: "Any address of your shop works: the one shoppers use, or myshop.myshopify.com. Shopify then asks you to allow Kaizena Flow to read the shop.",
    button: "Connect Shopify",
    working: "Finding your shop …",
  },
  problems: {
    address: "That isn't a shop address. Type the address your shoppers use, like myshop.com.",
    not_shopify: "We couldn't find a Shopify shop at that address. Try its myshopify.com address: you see it in your Shopify admin's address bar.",
    unreachable: "That address didn't answer. Check it and try again.",
    off: "Connecting to Shopify isn't switched on yet.",
    forbidden: "Only the store's owner can connect another shop.",
  },
  outcome: {
    connected: "Your Shopify shop is connected.",
    declined: "Nothing was connected: you said no on Shopify's page.",
    failed: "Connecting didn't work. Press Connect Shopify again.",
    off: "Connecting to Shopify isn't switched on yet.",
  },
  connected: {
    title: "Connected to {name}",
    shop: "Shopify shop {shop}, connected {when}.",
    missing: { one: "Shopify didn't allow {n} thing we asked to read. Connect again and allow it.", many: "Shopify didn't allow {n} things we asked to read. Connect again and allow them." },
    next: "Check your old links",
    nextHelp: "We read the list of pages your shop gives Google and show which of your old links already lead somewhere here, and fix the rest with you.",
    nextWorking: "Reading your shop's pages …",
    copySoon: "Copying everything over in one press comes next. Until then, bring products, customers and past orders over with Shopify's own files:",
    disconnect: "Disconnect",
    disconnectAsk: "Disconnect your Shopify shop? Nothing is deleted here, and you can connect again.",
    reconnect: "Connect again",
    cancel: "Cancel",
  },
  report: {
    title: "Here's your shop",
    things: {
      products: { one: "{n} product", many: "{n} products" },
      collections: { one: "{n} collection", many: "{n} collections" },
      pages: { one: "{n} page", many: "{n} pages" },
      articles: { one: "{n} blog post", many: "{n} blog posts" },
      customers: { one: "{n} customer", many: "{n} customers" },
      subscribers: { one: "{n} of them gets your emails", many: "{n} of them get your emails" },
      orders: { one: "{n} past order", many: "{n} past orders" },
      giftCards: { one: "{n} gift card with money left", many: "{n} gift cards with money left" },
      discounts: { one: "{n} discount", many: "{n} discounts" },
      redirects: { one: "{n} redirect you made in Shopify", many: "{n} redirects you made in Shopify" },
    },
    vatIncluded: "Prices include VAT ✓",
    vatExcluded: "Prices without VAT",
    vatUnknown: "Whether prices include VAT could not be read",
    sellsIn: "Sells to {countries} in {currency}",
    alsoIn: "also priced in {currencies}",
    counted: "Counted by Shopify just now. Nothing has been copied, and nothing changed on Shopify.",
    goodToKnow: "Good to know",
    items: {
      prices_without_vat: "Your Shopify prices are without VAT. Kaizena Flow shows prices with VAT, so each country's price is worked out with its VAT when you copy.",
      compare_at: "Your “compare at” prices won't show as sales. In the EU a sale must be compared with your lowest price in the last 30 days, so your current prices show, and you can start a sale here when you want.",
      gift_card_codes: "Shopify never shows a gift card's full code, so gift cards with money left get new codes here when you move, with the same balance.",
      orders_60_days: "Shopify lets us read only the last 60 days of orders until it approves more. Older orders come over with Shopify's order file.",
      customers_hidden: "Shopify didn't let us read your customers. Connect again and allow it, or bring them over with Shopify's customer file.",
    },
    failed: "We couldn't read your shop just now. Reload the page to try again.",
    disconnected: "Shopify no longer lets us read your shop. Connect again.",
  },
  files: {
    products: "Import products",
    customers: "Import customers",
    orders: "Import past orders",
    links: "Check your old links",
  },
  off: {
    title: "Bring your shop over with Shopify's files",
    text: "Connecting straight to Shopify isn't switched on yet. Export each file in your Shopify admin and import it here, in this order:",
  },
  oldShopProblem: "We couldn't read your shop's pages. Open Check your old links and try there.",
};

export type MovingMessages = Widen<typeof movingEn>;
