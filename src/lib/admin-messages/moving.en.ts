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
    counts: "{products} products · {customers} customers · {orders} orders",
    countsAtLeast: "Counted by Shopify; orders from the last 60 days until Shopify allows reading every order.",
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
