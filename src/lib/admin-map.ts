/**
 * The admin, page by page (D103): what each page is for and what can be
 * done there, for the AI manager to guide owners and open the right page.
 * Every admin page is listed (a unit test walks the app's routes), so a new
 * page goes here too.
 */

import { requirementMet, type FeatureId, type FeatureRequirement } from "./store-features";
import { PAGES_NB } from "./admin-messages/pages.nb";
import { sectionOf } from "./store-nav";

export type AdminArea = "store" | "platform" | "account";

/** What must be on for a page to be offered besides a store feature: Work (a module), or being an owner. */
export type PageNeeds = "work" | "owner";

export type AdminPage = {
  /** Stable id the AI opens pages by: `orders`, `order`, `product.new`. */
  id: string;
  area: AdminArea;
  /** After the area's base (`/admin/{store}`, `/admin/platform` or `/admin`), with `[param]`s; "" is the base itself. */
  path: string;
  title: string;
  /** Where it sits in the admin's navigation. */
  group: string;
  /** What the page is for, in a sentence. */
  what: string;
  /** What can be done there, for guiding. */
  tasks?: string[];
  /** Other words people use for it. */
  keywords?: string[];
  needs?: PageNeeds;
  /** The store feature (D178) it stands behind, one or several of which any is enough; its navigation item says the same (a test holds them). */
  feature?: FeatureRequirement;
};

const store = (id: string, path: string, title: string, group: string, what: string, extra: Partial<AdminPage> = {}): AdminPage => ({
  id,
  area: "store",
  path,
  title,
  group,
  what,
  ...extra,
});
const platform = (id: string, path: string, title: string, group: string, what: string, extra: Partial<AdminPage> = {}): AdminPage => ({
  id,
  area: "platform",
  path,
  title,
  group,
  what,
  ...extra,
});
const account = (id: string, path: string, title: string, what: string, extra: Partial<AdminPage> = {}): AdminPage => ({
  id,
  area: "account",
  path,
  title,
  group: "Account",
  what,
  ...extra,
});

/**
 * Work (D123) is the owner's: an account-level page in the group Work, offered when a store of the
 * person's has Work on. The overview and the settings, where it is switched on, are always offered.
 */
const work = (id: string, path: string, title: string, what: string, extra: Partial<AdminPage> = {}): AdminPage => ({
  id,
  area: "account",
  path,
  title,
  group: "Work",
  what,
  needs: "work",
  ...extra,
});

const PAGES: readonly AdminPage[] = [
  // Store: main sections --------------------------------------------------------------
  store("overview", "", "Home", "Home", "The store's start page: the setup checklist until the store is ready, then its state at a glance.", {
    tasks: ["See what is left before launch", "Jump to the next setup step"],
    keywords: ["home", "dashboard", "start", "checklist"],
  }),
  store("setup", "/setup", "Setup", "Main", "The setup wizard, resuming at the first unfinished step.", { keywords: ["wizard", "onboarding", "launch"] }),
  store("setup.step", "/setup/[step]", "Setup step", "Main", "One step of the setup wizard: what the store will sell, details, countries, bookings, payments, products or launch (the steps follow the store's features).", {
    keywords: ["wizard", "onboarding"],
  }),
  store("assistant", "/assistant", "AI manager", "Main", "The AI store manager's full page: conversations, and what it has learned about you.", {
    needs: "owner",
    keywords: ["assistant", "ai", "chat", "memory"],
  }),
  store("orders", "/orders", "Orders", "Main", "Every order, newest first, with a search (order number, email, name, product title or SKU, tag, tracking number), filters (payment, fulfilment, status, tag, market, source, gifts, a date range, archived) kept in the address, saved views, a column choice, and bulk actions on ticked orders: add or remove tags, archive, mark as sent, print packing slips or a pick list. Partly sent orders and changes waiting for the customer's payment are fulfilment filters.", {
    tasks: [
      "Find an order (?q=)",
      "See what is waiting to be sent (?show=to-send)",
      "See pickup orders to hand over (?show=to-hand-over)",
      "See local deliveries (?show=local)",
      "See unpaid checkouts (?show=unpaid)",
      "See archived orders (?show=archived)",
      "Filter by payment, fulfilment, tag or a date range",
      "Save the filters as a view",
      "Tag, archive or mark as sent several orders at once",
      "Print packing slips for several orders",
      "Print a pick list of what the ticked orders still need",
      "See partly sent orders (?ship=partly_sent)",
    ],
    keywords: ["sales", "purchases", "to send", "shipping", "search orders", "filter orders", "saved view", "tag", "archive", "bulk", "mass edit", "select orders", "gift orders", "staff-made", "ordrer", "søk"],
    feature: "shop",
  }),
  store("order", "/orders/[orderId]", "Order", "Main", "Everything about one order: lines, payment, sending in parcels (choose the items and quantities of each parcel, with its own tracking, email and packing slip), refunds, cancelling, changing its items after purchase (or why it cannot be changed, and a change waiting for the customer's payment), contact, notes, history and emails.", {
    tasks: ["Mark it sent with tracking", "Send part of it now and the rest later", "Email a parcel's tracking again", "Refund all or part and restock", "Cancel it", "Change its items", "Send a change's pay link again, or cancel the change", "Correct the address", "Add a note", "Resend the confirmation", "Mark a pickup order ready for pickup", "Mark it collected", "Mark it out for local delivery"],
    keywords: ["refund", "tracking", "ship", "cancel order", "partial fulfilment", "partly sent", "split shipment", "parcel", "edit order", "change order", "ready for pickup", "collected", "local delivery", "out for delivery"],
    feature: "shop",
  }),
  store("order.edit", "/orders/[orderId]/edit", "Edit order", "Main", "Changes a paid order that is not sent yet: lower a quantity, take an item off, add products (at the market's price or one you type) and change the shipping, with the reason. Items kept keep their price and discounts. The summary is worked out by the checkout's own rules: a lower total is refunded at once, a higher one is paid by the customer through a pay link (or recorded as paid outside Kaizena Flow) before the order changes. The order keeps its number; an invoiced order gets a credit note and an additional invoice.", {
    tasks: ["Take an item off an order", "Lower a quantity", "Add a product to a paid order", "Change the shipping price", "Send the customer a pay link for a higher total", "Record a change as paid outside Kaizena Flow"],
    keywords: ["edit order", "change order", "modify order", "add item", "remove item", "order edit", "endre ordre", "swap item"],
    feature: "shop",
  }),
  store("orders.export", "/orders/export", "Export orders", "Main", "Downloads orders as a CSV file for your bookkeeping: one row for each order line (or each order), with the VAT of each line and of the shipping, discounts, refunds, payment, the amounts in the order's currency and the store's, and copied history and hosts' orders marked. The owner's only, because it can hold personal data; the file is made without contact details unless you choose them, and is never emailed.", {
    needs: "owner",
    tasks: ["Export the orders of a period", "Export some orders by their numbers", "Include the buyer's email and address", "Download a finished export"],
    keywords: ["export orders", "csv", "orders spreadsheet", "accountant", "bookkeeping", "download orders", "excel", "eksporter ordre"],
    feature: "shop",
  }),
  store("order.packing-slip", "/orders/[orderId]/packing-slip", "Packing slip", "Main", "A printable packing slip for one order, without prices: what is still to send (all of it, marked already sent, when nothing is left), or one parcel's items (?shipment=) with a line when more follows; for a gift order it also prints the buyer's gift message.", {
    keywords: ["print", "slip", "pack", "gift receipt", "gift slip"],
    feature: "shop",
  }),
  store("orders.packing-slips", "/orders/packing-slips", "Packing slips", "Main", "Packing slips for several orders in one document, each order on its own page and in its own language, without prices, each with what is still to send (a partly sent order its remainder). Orders already sent, withdrawn, with nothing to ship and copied history are left out, with the reason.", {
    keywords: ["print packing slips", "bulk print", "print many", "pick", "gift slip"],
    tasks: ["Print the slips of the orders you ticked"],
    feature: "shop",
  }),
  store("orders.pick-list", "/orders/pick-list", "Pick list", "Main", "What to take off the shelves for the ticked orders (at most 100): the units still to send summed by product, variant and SKU with the number of orders, or listed order by order. Downloads, services, units already sent and units withdrawn before sending are left out, and orders that cannot be picked are listed with the reason. No prices, names or addresses.", {
    tasks: ["Print a pick list of the ticked orders", "Pick by product or by order", "Sort by SKU, title or quantity"],
    keywords: ["pick list", "picking list", "picklist", "warehouse", "pick", "plukkliste"],
    feature: "shop",
  }),
  store("orders.drafts", "/orders/drafts", "Draft orders", "Main", "Draft orders: orders you make for a customer, newest first, with what each is worth and where it stands (open, sent, paid, expired). A draft holds no stock until it is sent as a pay link.", {
    tasks: ["Make a draft order", "See drafts waiting for payment (?status=sent)", "Open a draft"],
    keywords: ["draft", "quote", "manual order", "phone order", "payment link", "pay link", "invoice a customer", "create order", "utkast"],
    feature: "shop",
  }),
  store("orders.draft.new", "/orders/drafts/new", "New draft order", "Main", "Starts a draft order in a market (the country, language and currency it is priced in).", {
    keywords: ["new draft", "create order", "manual order"],
    feature: "shop",
  }),
  store("orders.draft", "/orders/drafts/[draftId]", "Draft order", "Main", "One draft order: the customer, lines (products and custom items, with a custom price), a discount the buyer sees, shipping, notes and tags, and the summary with VAT worked out by the checkout's own rules. Send it to the customer as a pay link or make a link to share, reopen a sent draft, or record that it was paid outside Kaizena Flow (bank transfer, cash).", {
    tasks: ["Add products and custom items", "Give a discount or a custom price", "Send the pay link", "Make a link to share", "Reopen a sent draft", "Record a payment taken outside Kaizena Flow"],
    keywords: ["pay link", "payment link", "send invoice", "mark as paid", "paid outside", "bank transfer", "cash", "custom item", "custom price", "staff discount"],
    feature: "shop",
  }),
  store("order.terms", "/orders/[orderId]/terms/[role]", "Terms as shown", "Main", "One of the texts an order was placed under (the terms or the privacy statement), as the shopper was shown it: the kept copy, its version and when it was accepted.", {
    keywords: ["terms accepted", "terms snapshot", "privacy statement", "what the customer agreed to"],
    feature: "shop",
  }),
  store("returns", "/returns", "Returns", "Main", "Customers' withdrawals from a purchase (the legal right to change their mind) and return requests inside the store's own window: a queue with what is overdue, to approve, to receive and to refund.", {
    tasks: ["See what is past its refund deadline (?overdue=1)", "See return requests to answer (?status=requested)", "Search by return, order, name or email (?q=)", "Open a return and work it to a refund"],
    keywords: ["return", "withdrawal", "withdraw", "right of withdrawal", "angrerett", "refund deadline", "send back", "14 days", "return request", "RMA"],
    feature: "shop",
  }),
  store("return", "/returns/[returnId]", "Return", "Main", "One withdrawal or return: the customer's statement and its acknowledgement, the lines, approving or declining, instructions, receiving, inspecting for diminished value, the refund with its working, and closing.", {
    tasks: ["Approve or decline a return request", "Set return instructions and address", "Mark the goods in transit or received", "Inspect the goods and set a deduction", "Refund with the working shown", "Send the acknowledgement again", "Close or cancel"],
    keywords: ["refund", "inspect", "restock", "acknowledgement", "withdrawal statement", "deduction", "diminished value"],
    feature: "shop",
  }),
  store("invoices", "/invoices", "Invoices", "Main", "The store's invoices and credit notes (one for every paid order and every refund that succeeds, numbered in the store's own series): search by number, order or email, view, print or download the PDF, the orders still waiting for an invoice and why, and a CSV for the accountant.", {
    tasks: ["Find an invoice or credit note (?q=)", "See what is waiting for an invoice (?tab=waiting)", "Check again after fixing the business details", "Download a CSV for the accountant", "Open or download an invoice's PDF"],
    keywords: ["invoice", "faktura", "credit note", "kreditnota", "kreditfaktura", "receipt", "pdf", "accountant", "bookkeeper", "vat invoice", "invoice number", "waiting for an invoice"],
    feature: "shop",
  }),
  store("subscriptions", "/subscriptions", "Subscriptions", "Main", "Shoppers' subscriptions to products bought on a schedule.", {
    keywords: ["recurring", "renewals"], feature: "subscriptions" }),
  store("subscription", "/subscriptions/[subscriptionId]", "Subscription", "Main", "One subscription: what it holds, its renewals, and pausing, skipping, changing or cancelling it.", {
    tasks: ["Pause or skip", "Change contents", "Cancel now or at period end"], feature: "subscriptions" }),
  store("products", "/products", "Products", "Main", "Every product with its status, price and stock, and the products that still need their content for the price per kg or litre (unit price).", {
    tasks: ["Find a product", "Add a product", "Archive products", "Find products that need content for the unit price"],
    keywords: ["catalogue", "items", "inventory", "stock", "unit price", "price per kg", "price per litre", "enhetspris"],
    feature: "shop",
  }),
  store("product.new", "/products/new", "New product", "Main", "Adds a product: texts per language, pictures, variants, prices per country, stock, delivery and product safety details.", {
    keywords: ["create product", "add item"],
    feature: "shop",
  }),
  store("product", "/products/[productId]", "Product", "Main", "The product editor: texts, pictures, variants, prices, content per variant (unit price), stock, purchase options, SEO and AI writing help.", {
    tasks: ["Change price or stock", "Edit texts and pictures", "Add purchase options (subscriptions)", "Let the AI suggest texts", "Archive or publish", "Give a variant its content (g, kg, ml, l, m) for the price per kg or litre"],
    keywords: ["price", "stock", "variant", "edit product", "unit price", "price per kg", "price per litre", "content", "sold by measure", "enhetspris"],
    feature: "shop",
  }),
  store("product.categories", "/products/categories", "Product categories and tags", "Main", "Categories (nested) and tags for products, used in menus, filters and layouts; a category can require a price per kg or litre (unit price) of its products.", {
    keywords: ["taxonomy", "collections", "unit price", "price per kg", "requires unit price"],
    feature: "shop",
  }),
  store("products.export", "/products/export", "Export products", "Main", "Downloads the store's products as a CSV file: one row for each variant, with texts in every language, options, prices for each country, stock, cost, product safety details, categories, tags and pictures. A small store gets the file at once, a large one a job with a Download button. The file reads back into Kaizena Flow as it is.", {
    tasks: ["Export all products, a status, or a category or tag", "Choose the Excel (Nordic) or the standard file format", "Download a finished export", "See what the file does not carry"],
    keywords: ["export products", "csv", "download products", "spreadsheet", "excel", "backup", "product file", "eksporter produkter"],
    feature: "shop",
  }),
  store("products.import", "/products/import", "Import products", "Main", "Brings products in from a CSV file: Kaizena Flow's own file or a Shopify product file. Upload the file, choose what the import does, check it (a dry run that lists every row's problem and changes nothing), then import. Never deletes a product or changes an address. Needs the right to change products.", {
    tasks: ["Upload a product file", "Import a Shopify product file", "Continue an open import", "See the recent imports"],
    keywords: ["import products", "csv", "upload products", "shopify", "migrate", "bulk add", "product file", "importer produkter"],
    feature: "shop",
  }),
  store("products.import.job", "/products/import/[jobId]", "Product import", "Main", "One product import: its options, the check's findings row by row, the counts, the confirmation, progress while it works and the result. Download the problems as a CSV, cancel an import that is running.", {
    tasks: ["Choose the options and check the file", "Read each row's problems", "Import after the check", "Cancel the import", "Download the problems as CSV"],
    keywords: ["dry run", "check the file", "import problems", "import result", "cancel import"],
    feature: "shop",
  }),
  store("products.bulk", "/products/bulk", "Edit products in a grid", "Main", "Edits the variants of the products chosen in the list as a table: price for each market, SKU, stock and cost. Review every change before it is written, apply it, and undo it for seven days. Without chosen products it shows the recent bulk changes, where an undo can be made. Tick products in the list for the other bulk actions: set status, archive, categories and tags, price (a percentage or an amount) and stock.", {
    tasks: ["Change prices for many products by a percentage or an amount", "Edit prices, SKUs, stock and cost in a grid", "Archive or publish many products", "Add many products to a category or tag", "Set stock for many products", "Undo a bulk change"],
    keywords: ["bulk edit", "bulk editing", "mass edit", "change many products", "price change", "percentage", "sale", "undo", "spreadsheet", "grid", "rediger flere produkter"],
    feature: "shop",
  }),
  store("inventory", "/inventory", "Inventory", "Main", "Stock for each variant and stock location: on hand, held by checkouts in progress, available and owed on backorder, with counts of what is low, sold out or owed. Change a level with a reason (received, correction, count, damaged, theft or loss, promotion), review every change before it is saved, and set a variant to keep selling at zero stock or to warn at a low level. Needs the right to change products to adjust.", {
    tasks: ["See what is low, sold out, owed or below zero", "Adjust stock with a reason", "Count stock and set it to the counted figure", "Keep selling a variant when it is sold out (backorder) with a delivery time", "Set a low-stock level", "Find a variant by SKU, title or location"],
    keywords: ["inventory", "stock", "stock levels", "on hand", "committed", "available", "backorder", "sell when out of stock", "oversell", "low stock", "count", "recount", "adjust stock", "received", "damaged", "lager", "lagerbeholdning", "restordre"],
    feature: "shop",
  }),
  store("gift-cards", "/gift-cards", "Gift cards", "Main", "The store's gift cards: what customers hold on them now per currency, each card with its value, what is left, whether it is active, not sent yet, spent, expired or deactivated, and how it came to be (bought with an order, or issued by staff). Search by the last four of a card, an order number or who it was for, open one for its history and the orders it paid for. Issue a card by hand (the code is shown once and can be emailed), change a card's balance with a reason, deactivate one, and set how long new cards last.", {
    tasks: ["See what customers hold on gift cards", "Issue a gift card by hand", "Find a gift card by its last four", "Change a gift card's balance", "Deactivate a gift card", "Set how long gift cards last"],
    keywords: ["gift cards", "gift card", "voucher", "vouchers", "store credit", "gavekort", "presentkort", "gift card balance", "issue gift card", "expiry", "liability"],
    feature: "gift_cards",
  }),
  store("gift-cards.new", "/gift-cards/new", "Issue a gift card", "Main", "Issue a gift card by hand: an amount in a currency the store sells in, and optionally who it is for, their email and a message. The code is shown once and emailed when an address is given. Needs the right to change products.", {
    feature: "gift_cards",
  }),
  store("gift-card", "/gift-cards/[cardId]", "Gift card", "Main", "One gift card: its value and what is left, when it expires, how it came to be, its whole history in words and the orders it paid for; change its balance with a reason or deactivate it.", {
    feature: "gift_cards",
  }),
  store("reviews", "/reviews", "Reviews", "Main", "Product reviews written by buyers from what they bought and received (verified purchases) and reviews imported from elsewhere: the ones waiting to be checked first, then all by state, searched by product or words and filtered by stars. Publish a review, hide one with a reason (never because it is negative), answer it under the review, and choose whether new reviews wait for a check or are published at once.", {
    tasks: ["Check new product reviews", "Publish a review", "Hide a review", "Answer a review", "Publish reviews without checking them first"],
    keywords: ["reviews", "product reviews", "ratings", "stars", "moderation", "verified purchase", "answer review", "omtaler", "anmeldelser", "recensioner", "testimonials"],
    feature: "reviews",
  }),
  store("inventory.history", "/inventory/history", "Stock history", "Main", "Every change of a stock level, newest first: when, which variant and location, the change and the new figure, the reason and who or what made it (a staff member, an order, a return, a file, the AI manager). Filter by SKU, location, reason and dates. Kept 24 months; a wrong change is corrected by a new one.", {
    tasks: ["See why a stock figure changed", "Find the order or return behind a change", "Filter the history by SKU, location, reason or dates"],
    keywords: ["stock history", "inventory history", "movements", "adjustment history", "audit", "who changed the stock", "lagerhistorikk"],
    feature: "shop",
  }),
  store("inventory.locations", "/inventory/locations", "Stock locations", "Main", "The places stock is held: add, rename and rank locations (an order's units are taken from the top location first), and, for owners, deactivate a location after seeing how many units stop being for sale, or reactivate it. A store always keeps one active location; a location is never deleted.", {
    tasks: ["Add or rename a stock location", "Change the order locations are used in", "Deactivate or reactivate a location (owner)", "See the units held at each location"],
    keywords: ["locations", "warehouse", "stock locations", "routing", "order routing", "deactivate location", "multi location", "lager", "lokasjon"],
    feature: "shop",
  }),
  store("inventory.import", "/inventory/import", "Import stock", "Main", "Sets stock from a counted CSV file: SKU, location and on hand, with an optional on-hand-was column so a row that is out of date becomes a conflict instead of undoing a sale. Upload the file, check it (a dry run that lists every row and changes nothing), then import. Never creates a variant or a location. Needs the right to change products.", {
    tasks: ["Upload a counted stock file", "Check a file before it is imported", "Import after the check", "Continue an open import"],
    keywords: ["import stock", "stock count", "csv", "inventory upload", "recount", "bulk stock", "importer lager"],
    feature: "shop",
  }),
  store("inventory.import.job", "/inventory/import/[jobId]", "Stock import", "Main", "One stock import: the check's result row by row (the change for each SKU and location, conflicts and problems), the counts, the confirmation, progress while it works and the result. Download the problems as a CSV, cancel an import that is running.", {
    tasks: ["Read what the check found", "Import after the check", "Cancel the import", "Download the problems as CSV"],
    keywords: ["dry run", "conflict", "stock import result", "cancel import"],
    feature: "shop",
  }),
  store("inventory.export", "/inventory/export", "Export stock", "Main", "Downloads stock as a CSV file: one row for each variant at each active location with on hand, committed, available, the policy at zero stock and the low-stock level. A small store gets the file at once, a large one a job with a Download button. Count from it and import it back.", {
    tasks: ["Download the stock file", "Choose the Excel (Nordic) or the standard file format", "Download a finished export"],
    keywords: ["export stock", "stock file", "inventory csv", "download inventory", "stock count sheet", "eksporter lager"],
    feature: "shop",
  }),
  store("product-layouts", "/product-layouts", "Product layouts", "Main", "Layouts for product pages, built in the page builder with product parts.", {
    keywords: ["product page design", "template"],
    feature: "shop",
  }),
  store("product-layout.new", "/product-layouts/new", "New product layout", "Main", "Starts a new product page layout.", { feature: "shop" }),
  store("product-layout", "/product-layouts/[pageId]", "Product layout", "Main", "Builds a product layout in the page builder.", { feature: "shop" }),
  store("product-layout.preview", "/product-layouts/[pageId]/preview", "Product layout preview", "Main", "Previews a product layout with a real product.", { feature: "shop" }),
  store("product-layout.assign", "/product-layouts/[pageId]/assign", "Where a layout is used", "Main", "Chooses where a layout applies: the store's default, categories, tags or single products.", { feature: "shop" }),
  store("fields", "/fields", "Custom fields", "Main", "Groups of custom fields for products, pages, articles, variants, categories and tags, the store itself, and (staff only) customers and orders (a size guide, ingredients, a warranty): where each group applies, its fields, presets, and import and export.", {
    tasks: ["Add a group of fields", "Start from a preset (specifications, size guide, ingredients)", "Choose which products or pages get a group", "Import or export field groups", "Switch a group off"],
    keywords: ["custom fields", "extra fields", "acf", "attributes", "specifications", "metafields", "product data"],
  }),
  store("fields.new", "/fields/new", "New group of custom fields", "Main", "Starts a group of custom fields: its name, where it applies, its fields and a live preview of the form."),
  store("fields.store", "/fields/store", "Store details", "Main", "The store's own custom fields (opening hours, a brand story, a contact person, a certificate): one set of values for the whole site, filled in here and placed in pages, product layouts, headers and footers.", {
    tasks: ["Fill in the store's own custom fields", "Make a group of fields for the store"],
    keywords: ["store details", "opening hours", "brand story", "site wide fields", "global fields", "options page"],
  }),
  store("field-group", "/fields/[groupId]", "Group of custom fields", "Main", "One group of custom fields: its fields in order with their types, conditional logic and storefront access, where it applies, a preview, and deleting it."),
  store("pages", "/pages", "Pages", "Main", "The store's own pages (about, contact, landing pages), which can be the front page or the All products page.", {
    tasks: ["Add or edit a page", "Choose the front page", "Create a page with AI"],
    keywords: ["website", "cms", "front page", "landing"],
  }),
  store("page.new", "/pages/new", "New page", "Main", "Starts a new page in the page builder."),
  store("page", "/pages/[pageId]", "Page", "Main", "The page builder: rows, columns and components, translations, custom CSS, publishing.", {
    keywords: ["builder", "edit page", "publish"],
  }),
  store("page.preview", "/pages/[pageId]/preview", "Page preview", "Main", "Previews a page's draft as the site would show it."),
  store("page.ai", "/pages/ai", "Create a page with AI", "Main", "The AI page studio: it interviews you, plans the sections, writes them and makes pictures.", {
    keywords: ["ai page", "generate page", "studio"],
  }),
  store("page.categories", "/pages/categories", "Page categories and tags", "Main", "Categories and tags for pages."),
  store("articles", "/articles", "Blog", "Main", "The store's blog articles.", { keywords: ["blog", "posts", "news"] }),
  store("article.new", "/articles/new", "New article", "Main", "Starts a new blog article."),
  store("article", "/articles/[pageId]", "Article", "Main", "Writes a blog article in the page builder."),
  store("article.preview", "/articles/[pageId]/preview", "Article preview", "Main", "Previews an article's draft."),
  store("article.categories", "/articles/categories", "Blog categories and tags", "Main", "Categories and tags for articles."),
  store("media", "/media", "Media", "Main", "The media library: every picture and video uploaded, where each is used, and alt texts in every language.", {
    tasks: ["Upload pictures", "Write or generate alt texts", "See where a picture is used", "Delete unused files"],
    keywords: ["images", "pictures", "photos", "videos", "alt text"],
  }),
  store("discounts", "/discounts", "Coupons", "Main", "Discount codes for shoppers: percent, amount or free shipping, with limits.", {
    keywords: ["coupon", "discount code", "sale", "promotion"],
    feature: "shop",
  }),
  store("discount.new", "/discounts/new", "New coupon", "Main", "Creates a discount code.", { feature: "shop" }),
  store("discount", "/discounts/[discountId]", "Coupon", "Main", "One discount code: its rules, uses, and switching it off.", { feature: "shop" }),
  store("wishlists", "/wishlists", "Wishlists", "Main", "Shoppers' wishlists, the most wished products and how wishes turn into sales.", {
    keywords: ["favourites", "saved"],
    feature: "shop",
  }),
  store("wishlist", "/wishlists/[wishlistId]", "Wishlist", "Main", "One shopper's wishlist.", { feature: "shop" }),
  store("wishlists.activity", "/wishlists/activity", "Wishlist activity", "Main", "Wishlist items put in carts and bought.", { feature: "shop" }),
  store("emails", "/emails", "Emails", "Main", "Every email the store sent to shoppers, and whether it went out.", { keywords: ["sent emails", "email log"], feature: "shop" }),
  store("email", "/emails/[emailId]", "Email", "Main", "One email as the shopper got it.", { feature: "shop" }),

  // Work (D122, D123): at the owner's level, `/admin/account/work`. Every store's Work together, and one store's own
  // screens under `/s/[store]` (each store is the seller: its own numbering, VAT and bank details).
  work("work", "/account/work", "Work", "The Work overview across every store: unbilled time, invoice drafts, what clients owe and what is overdue, what needs attention and which timer is running.", {
    needs: undefined,
    tasks: ["See what is unbilled per client and store", "See overdue invoices in every store", "See which timer is running", "See what is missing before a store's first invoice"],
    keywords: ["consulting", "hours", "clients", "receivables", "unbilled", "freelance", "overview", "income streams"],
  }),
  work("work.clients", "/account/work/clients", "Work clients", "Every client of every store with Work on, and adding one to a store.", {
    tasks: ["Find a client in any store", "Add a client to a store"],
    keywords: ["customers", "assignments", "consulting", "billing address"],
  }),
  work("work.time", "/account/work/time", "Time", "Time logged on assignments in every store, and the one timer a person has across all their stores.", {
    tasks: ["Log time", "Start a timer", "See this week's hours"],
    keywords: ["hours", "timer", "timesheet", "time entries", "track time"],
  }),
  work("work.invoices", "/account/work/invoices", "Work invoices", "Invoices of every store: drafts, issued, overdue, paid and credited, and making a new one in a store.", {
    tasks: ["See what is overdue (?show=overdue)", "See drafts (?show=drafts)", "Start an invoice in a store"],
    keywords: ["invoice", "credit note", "bill", "payment", "overdue", "hours", "consulting"],
  }),
  work("work.reports", "/account/work/reports", "Work reports", "Hours and amounts for a period across stores, to print or download as CSV.", {
    tasks: ["Report a period", "Download a CSV"],
    keywords: ["report", "export", "csv", "hours", "period"],
  }),
  work("work.settings", "/account/work/settings", "Work settings", "Which stores have Work switched on, and each store's invoice details with what is missing before its first invoice.", {
    needs: undefined,
    tasks: ["Switch Work on or off for a store", "Open a store's invoice settings"],
    keywords: ["modules", "features", "switch on work", "invoice settings"],
  }),
  work("work.store", "/account/work/s/[store]", "Store's Work", "One store's Work overview: unbilled time, drafts, what its clients owe, what needs attention and its running timers.", {
    tasks: ["See what is unbilled", "See overdue invoices", "See what is missing before the first invoice"],
    keywords: ["consulting", "hours", "receivables", "unbilled", "overview"],
  }),
  work("work.store.clients", "/account/work/s/[store]/clients", "Store's clients", "The people and companies one store bills for its work, with their assignments.", {
    tasks: ["Add a client", "Find a client", "Archive a client"],
    keywords: ["customers", "assignments", "consulting", "billing address"],
  }),
  work("work.client", "/account/work/s/[store]/clients/[clientId]", "Work client", "One client: how they are billed (address, VAT treatment, currency, hourly rate, days to pay), their assignments with time logged and time not yet invoiced, and archiving or deleting the client.", {
    tasks: ["Change the client's details or hourly rate", "Add an assignment", "Archive or bring back the client", "Delete a client with no history (owners)"],
    keywords: ["client", "billing address", "vat treatment", "hourly rate", "assignments", "archive"],
  }),
  work("work.assignment", "/account/work/s/[store]/assignments/[assignmentId]", "Assignment", "One assignment for a client: progress against its estimate, its tasks (added, ordered, estimated, ticked off), the time logged on it and a timer to start on it or any task.", {
    tasks: ["Add tasks and estimates", "Start or stop a timer", "Log time by hand", "Mark the assignment paused or done", "Edit the rate, fixed fee or estimate warnings"],
    keywords: ["assignment", "task", "estimate", "timer", "log time", "hours", "fixed fee"],
  }),
  work("work.store.invoices", "/account/work/s/[store]/invoices", "Store's invoices", "One store's invoices for hours and services: drafts, issued, overdue, paid and credited, and making a new one.", {
    tasks: ["Start an invoice from unbilled time", "See what is overdue (?show=overdue)", "See drafts (?show=drafts)", "Issue, record a payment or credit an invoice"],
    keywords: ["invoice", "credit note", "bill", "payment", "overdue", "hours", "consulting"],
  }),
  work("work.invoice", "/account/work/s/[store]/invoices/[invoiceId]", "Work invoice", "One invoice: a draft to edit (lines, unbilled time, live totals, the checklist and issuing it), or an issued invoice with its payments, credit notes and history.", {
    tasks: ["Edit the lines of a draft", "Add unbilled time", "Issue the invoice", "Record or reverse a payment", "Credit the invoice (owners)", "Delete a draft"],
    keywords: ["invoice", "draft", "issue", "credit note", "payment", "lines", "overdue"],
  }),
  work("work.store.time", "/account/work/s/[store]/time", "Store's time", "Time logged on one store's assignments, and starting or stopping a timer.", {
    tasks: ["Log time", "Start a timer", "See this week's hours"],
    keywords: ["hours", "timer", "timesheet", "time entries", "track time"],
  }),
  work("work.store.reports", "/account/work/s/[store]/reports", "Store's Work reports", "A client's hours and amounts in one store for a period, to print or download as CSV.", {
    tasks: ["Report a client's period", "Download a CSV"],
    keywords: ["report", "export", "csv", "hours", "period"],
  }),
  work("work.store.settings", "/account/work/s/[store]/settings", "Store's Work settings", "One store's VAT registration, bank details, payment terms and note, invoice footer, estimate warnings and the invoice and credit note numbering, with what is still missing before the first invoice.", {
    tasks: ["Say whether the business is VAT registered and give the VAT number", "Set the bank account", "Set the days to pay", "Choose the invoice number prefix and start number (before the first invoice)"],
    keywords: ["invoice settings", "vat", "bank account", "iban", "numbering", "invoice number", "payment terms"],
  }),

  // Store: bookings ----------------------------------------------------------------------
  store("bookings", "/bookings", "Calendar", "Bookings", "The week's appointments, and cancelling or marking no-shows.", {
    feature: ["appointments", "bookings"],
    keywords: ["appointments", "calendar", "schedule"],
  }),
  store("bookings.staff", "/bookings/staff", "Staff and hours", "Bookings", "The people shoppers book, with their opening hours.", { feature: "appointments" }),
  store("bookings.staff.new", "/bookings/staff/new", "New staff member", "Bookings", "Adds a person who can be booked.", { feature: "appointments" }),
  store("bookings.staff.one", "/bookings/staff/[staffId]", "Staff member", "Bookings", "One bookable person: hours, services and blocks.", { feature: "appointments" }),
  store("bookings.stays", "/bookings/stays", "Stays and rentals", "Bookings", "Two weeks of rooms and items booked, and cancelling stays or rentals.", {
    feature: "bookings",
    keywords: ["rooms", "rentals", "occupancy"],
  }),
  store("bookings.units", "/bookings/units", "Rooms and items", "Bookings", "Rooms, homes and items for stays and rentals, with their calendars.", { feature: "bookings" }),
  store("bookings.units.new", "/bookings/units/new", "New room or item", "Bookings", "Adds a room, home or item.", { feature: "bookings" }),
  store("bookings.unit", "/bookings/units/[unitId]", "Room or item", "Bookings", "One room or item: capacity, blocks, calendar sync.", { feature: "bookings" }),
  store("hosts", "/hosts", "Hosts", "Bookings", "Outside hosts whose stays and rentals the store lists, with their commission.", { feature: "bookings" }),
  store("host", "/hosts/[hostId]", "Host", "Bookings", "One host: listings, payouts and commission.", { feature: "bookings" }),
  store("hosts.dac7", "/hosts/dac7", "DAC7 report", "Bookings", "The yearly DAC7 tax report on hosts' income.", { feature: "bookings", keywords: ["tax", "dac7"] }),

  // Store: sales ---------------------------------------------------------------------------
  store("campaigns", "/campaigns", "Campaigns", "Sales", "Offers without a code, for a time: a percentage off, buy more and pay for fewer (3 for 2), or a free product above a basket amount, for the whole store, chosen products, categories or tags.", {
    tasks: ["Start a sale", "Set up 3 for 2", "Give a free product over an amount", "Schedule a campaign", "Switch a campaign off"],
    keywords: ["sale", "offer", "promotion", "3 for 2", "bundle", "free gift", "discount", "black friday", "time-limited"],
    feature: "shop",
  }),
  store("recommendations", "/recommendations", "Recommendations", "Sales", "Product recommendations: upsells, cross-sells and complements picked for each shopper from what they look at, search for, save and put in the cart, never what they already bought, shown in a product grid that recommends (on a product page, an article, the All products page or any page) and used by the chat assistant. Switch them on, let the store's AI re-rank the best candidates, set how much dearer than a product an upsell may be, cap the AI's monthly tokens, choose which products go together, are never shown together or are never recommended, and see clicks, add-to-cart rate and revenue per visitor with and without the AI.", {
    tasks: ["Turn recommendations on or off", "Cap the AI's monthly use for recommendations", "Say which products go together", "Hide a product from recommendations", "See what recommendations earn"],
    keywords: ["recommendations", "recommended", "upsell", "cross-sell", "cross sell", "complementary", "you may also like", "related products", "personalised", "personalized", "ai recommendations", "suggestions", "frequently bought together"],
    feature: "shop",
  }),
  store("experiments", "/experiments", "A/B tests", "Sales", "A/B tests of pages, a row or component of one, the store's header or footer, or a product layout: show two versions to real visitors who have accepted statistics cookies, and keep the one that gets more orders, more revenue per visitor, more people adding to the cart or reaching checkout, or more clicks on a chosen button. The list shows what is running, waiting and decided.", {
    tasks: ["Test two versions of a page", "See which version of a page sells more", "Stop a test", "Choose a winner", "Keep the original page"],
    keywords: ["a/b test", "ab test", "split test", "experiment", "test a page", "conversion", "which version", "optimise", "optimize", "winner", "variant"],
  }),
  store("experiment.new", "/experiments/new", "New A/B test", "Sales", "Makes an A/B test of a page, or of one row, column or component of it chosen in the page builder with \"A/B test this\": what it should improve, who takes part and a guess of how long it needs. The first version is a copy of the page."),
  store("experiment", "/experiments/[id]", "A/B test", "Sales", "One test: change its versions, check its settings and start it now or at a time; once running, see in plain words whether a version is better, stop it, choose a winner or keep the original."),
  store("experiment.variants", "/experiments/variants", "Test versions", "Sales", "Goes back to the list of tests: a version is changed from its test."),
  store("experiment.variant", "/experiments/variants/[pageId]", "A test version", "Sales", "Changes a version of a page made for an A/B test in the page builder."),
  store("experiment.variant.preview", "/experiments/variants/[pageId]/preview", "Test version preview", "Sales", "Previews a version of a page made for an A/B test."),
  store("campaign.new", "/campaigns/new", "New campaign", "Sales", "Creates a campaign: what it gives, what it applies to, and when it runs.", { feature: "shop" }),
  store("campaign", "/campaigns/[campaignId]", "Campaign", "Sales", "One campaign: what it gives, what it applies to, when it runs, and switching it off or deleting it.", { feature: "shop" }),
  store("bonus", "/bonus", "Bonus credits", "Sales", "The bonus program: signed-in customers earn credits on what they pay and use them as a price reduction on a later order. Set the percentage back, the wait before credits can be used, the most of an order they can pay, the minimum and whether credits expire, and see what the store owes in credits.", {
    tasks: ["Turn the bonus program on or off", "Change how much customers earn back", "Set when credits expire", "See the credits the store owes"],
    keywords: ["bonus", "credits", "loyalty", "points", "rewards", "reward customers", "returning customers", "repeat customers", "cashback", "store credit", "earn", "redeem", "reward program"], feature: "bonus" }),
  store("affiliates", "/affiliates", "Referral program", "Sales", "The referral program: signed-in customers share a link, a friend's first order gets a welcome discount and the customer who shared it earns bonus credits. Set the friend's discount, the reward, how many orders earn it, a monthly limit and how long a link is remembered; needs the bonus program. See the referrers and the orders that came through links, and block a referrer with a reason.", {
    tasks: ["Turn the referral program on or off", "Change the friend's welcome discount", "Change how much a referrer earns", "Block a referrer who abuses it", "See who referred whom"],
    keywords: ["referral", "refer a friend", "affiliate", "affiliates", "tip a friend", "friend discount", "welcome discount", "invite friends", "referral link", "word of mouth", "ambassador"], feature: "referrals" }),
  store("customers", "/customers", "Customers", "Sales", "The store's customers, with search, recent first.", { keywords: ["clients", "buyers", "people"], feature: "shop" }),
  store("customers.export", "/customers/export", "Export customers", "Sales", "Downloads the store's customers as a CSV file: name, email, phone, address, company, customer group, language, when they joined, their paid orders, whether their address unsubscribed from emails, and the custom fields staff entered about them. The owner's only. Kaizena Flow does not record marketing consent yet, so the file must not be used as a mailing list.", {
    needs: "owner",
    tasks: ["Export all customers", "Download a finished export"],
    keywords: ["export customers", "csv", "customer list", "download customers", "mailing list", "excel", "eksporter kunder"],
    feature: "shop",
  }),
  store("customer", "/customers/[customerId]", "Customer", "Sales", "One customer: orders, subscriptions, emails, their customer group and their bonus credits (balance, history, and adding or removing credits with a reason).", { feature: "shop" }),
  store("privacy", "/privacy", "Privacy requests", "Sales", "The log of privacy requests: people asking for a copy of the data the store holds about them, or for it to be erased (GDPR). Each has the day it was received and a one-month clock with the days left, red when overdue. Log a request that came by email, post or phone, then download the data, erase it, extend the answer once, refuse it with a reason, close it as no data held, or cancel it. Filter by open or answered (?status=answered, ?status=all).", {
    tasks: ["Log a request for a person's data", "See which privacy requests are due or overdue", "Extend or refuse a request", "Close a request as no data held", "Find a request that was answered"],
    keywords: ["data request", "subject access request", "DSAR", "GDPR", "erase", "delete customer", "anonymise", "forget me", "right to be forgotten", "personvern", "innsyn", "sletting", "export customer data", "privacy request", "one month"],
  }),
  store("privacy.new", "/privacy/new", "Log a privacy request", "Sales", "Logging a request that arrived by email, post or phone: what the person asks for, the email they wrote from, the day it was received (the one-month clock runs from receipt) and a note.", {
    tasks: ["Log a request for a copy of someone's data", "Log a request to erase someone's data"],
    keywords: ["log request", "new privacy request", "data request", "DSAR", "forget me"],
  }),
  store("privacy.request", "/privacy/[requestId]", "Privacy request", "Sales", "One privacy request: the person, the clock, and what staff may do while it is open (download the data, erase it, extend the answer once, refuse it with a reason, note that the identity is in doubt, close it as no data held, cancel it), and once answered, what was done.", {
    tasks: ["Download a customer's data", "Erase a customer's data", "Extend the answer with a reason", "Refuse a request with a reason", "Close a request as no data held"],
    keywords: ["extend", "refuse", "identity", "no data held", "one month", "answer a data request"],
  }),
  store("customer.erase", "/customers/[customerId]/erase", "Erase personal data", "Sales", "Erasing one customer's personal data in two steps: a read-only preview of what happens to each kind of data (deleted, made anonymous, kept restricted until the bookkeeping period ends), what else happens (subscriptions cancelled, cards detached, credits forfeited) and warnings, then the customer's email typed again to confirm. Cannot be undone; the owners are told.", {
    tasks: ["See what erasing a customer would do", "Erase a customer's personal data"],
    keywords: ["erase", "delete customer", "forget me", "anonymise", "right to be forgotten", "gdpr", "slett kunde", "personvern"],
  }),
  store("customer-groups", "/customer-groups", "Customer groups", "Sales", "Discount groups such as Wholesale: a fixed percentage off for the customers in them.", {
    keywords: ["wholesale", "b2b", "tier", "price list", "trade discount", "fixed discount", "customer roles"],
    tasks: ["Make a group with a fixed discount", "Put customers in a group"],
    feature: "shop",
  }),
  store("customer-group", "/customer-groups/[groupId]", "Customer group", "Sales", "One discount group: its percentage, its customers and the companies using it.", { feature: "shop" }),
  store("b2b-companies", "/companies", "Companies", "Sales", "Companies that buy from the store: a discount group, a main account that invites employees, and the share of the discount employees get.", {
    keywords: ["b2b", "business customers", "employees", "company account", "invite", "wholesale"],
    tasks: ["Make a company with a main account", "Invite or remove a company's employees"], feature: "business" }),
  store("b2b-company", "/companies/[companyId]", "Company", "Sales", "One company: settings, its accounts, invitations, and inviting or removing employees.", { feature: "business" }),
  store("deliveries", "/deliveries", "Subscription boxes", "Sales", "Delivery days, the round being packed and shoppers' subscription box lists.", {
    feature: "boxes",
    tasks: ["Add a delivery day", "Send and charge this round's orders"],
    keywords: ["subscription box", "standing order", "weekly delivery", "grocery"],
  }),
  store("segments", "/segments", "Segments", "Sales", "Segments: groups of the store's customers and subscribers by rules (orders, money spent, first and last order, customer type from analytics, country, language, customer group, company, account, tags, email consent), each counted now with how many want the store's emails.", {
    keywords: ["segment", "audience", "customer list", "rfm", "vip", "win-back", "target group", "målgruppe"],
    tasks: ["Make a segment of my best customers", "See how many customers have not ordered for six months"],
  }),
  store("broadcasts", "/broadcasts", "Broadcasts", "Sales", "Broadcasts: emails with news and offers written once in the store's languages and sent to the people on the subscriber list who want them, everyone or a segment's, once each, with an unsubscribe link. Draft, test to yourself, send now or schedule, stop, and see what happened (sent, delivered, bounced, unsubscribed, presses on links). Write with AI suggests the words.", {
    keywords: ["newsletter", "email campaign", "email marketing", "mailing", "send email to customers", "nyhetsbrev"],
    tasks: ["Send a newsletter to everyone who wants my emails", "Email my best customers about the autumn collection"],
  }),
  store("email-automations", "/automations", "Email automations", "Sales", "Email automations: emails that go by themselves once switched on, to the people on the subscriber list who want them, once each: a welcome after they join, a thank-you some days after an order is delivered, a win-back after a time without orders, and back in stock (shoppers ask on a sold-out product and get one email when it is back). Each says how many it sent in the last 30 days.", {
    keywords: ["automation", "flow", "welcome email", "win-back", "winback", "back in stock", "notify me", "restock", "lifecycle email", "velkomstmail"],
    tasks: ["Send a welcome email to new subscribers", "Tell customers when a sold-out product is back"],
  }),
  store("ads", "/ads", "Ads and conversions", "Sales", "Ads and conversions: server-side conversion events to Meta, Google Analytics 4, TikTok and Pinterest. Per platform the connection (its id and token), what it sends (standard, or enhanced with hashed email and phone), a test code, and the last seven days' sent, not sent and failed counts. Only for orders whose shopper allowed marketing cookies.", {
    keywords: ["conversions api", "capi", "meta pixel", "facebook pixel", "tiktok events api", "pinterest conversions", "server-side tracking", "ad tracking", "measurement protocol"],
    tasks: ["Send purchases to Meta from the server", "Connect TikTok's Events API"],
  }),
  store("feeds", "/feeds", "Product feeds", "Sales", "Product feeds: the store's products as Google Merchant Center, Meta, TikTok and Pinterest files at a secret address, one per country and channel, with price as shown (with VAT), stock, GTIN, brand, pictures and the flat shipping rate. Lists the products left out and why. Make a new address to stop the old one.", {
    keywords: ["product feed", "google shopping", "merchant center", "meta catalogue", "facebook shop", "instagram shopping", "tiktok catalog", "pinterest catalog", "xml feed", "csv feed"],
    tasks: ["Show my products on Google Shopping", "Get a catalogue feed for Meta"],
  }),
  store("email-automation", "/automations/[kind]", "Email automation", "Sales", "One email automation: its days, its words per language, a test to yourself, and the switch."),
  store("broadcast.new", "/broadcasts/new", "New broadcast", "Sales", "Writes a new broadcast: its name, who it is for, and per language its subject and what it says."),
  store("broadcast", "/broadcasts/[broadcastId]", "Broadcast", "Sales", "One broadcast: its words, a test to yourself, send now or schedule; once sent, how many it went to, delivered, bounced, unsubscribed and presses on its links."),
  store("segment.new", "/segments/new", "New segment", "Sales", "Makes a segment from a ready one or from rules, with the count as they change."),
  store("segment", "/segments/[segmentId]", "Segment", "Sales", "One segment: how many people are in it, how many want the store's emails, who they are, and its rules."),
  store("subscribers", "/subscribers", "Subscribers", "Sales", "The subscriber list: people who asked for the store's emails with news and offers, from sign-up forms, checkout or My account, with the words they agreed to, when, and whether they confirmed by email. Search, see who is waiting for their link and who left, open one for their consent history, unsubscribe a person who asked, and export the list (owners).", {
    keywords: ["newsletter", "mailing list", "email list", "marketing consent", "opt-in", "double opt-in", "unsubscribe", "nyhetsbrev", "abonnenter"],
    tasks: ["See who subscribed to the newsletter", "Export the subscriber list", "Unsubscribe a person"],
  }),
  store("subscriber", "/subscribers/[subscriberId]", "Subscriber", "Sales", "One subscriber: what they agreed to, when and from where, their history, and Unsubscribe."),
  store("cart-reminders", "/cart-reminders", "Cart reminders", "Sales", "Emails to shoppers who left their checkout, with their steps and results.", {
    keywords: ["abandoned cart", "recovery"],
    feature: "shop",
  }),
  store("cart-reminder.new", "/cart-reminders/new", "New cart reminder", "Sales", "Adds a reminder step.", { feature: "shop" }),
  store("cart-reminder", "/cart-reminders/[stepId]", "Cart reminder", "Sales", "One reminder step: when it goes, its words and any coupon.", { feature: "shop" }),
  store("shipping", "/settings/shipping", "Shipping", "Sales", "What delivery costs in each country: the flat rate (the default, and what subscriptions, subscription boxes and draft orders pay), shipping methods with zones and profiles, the default weight for goods without one, pickup at your places, local delivery and carriers, with warnings when something cannot be served.", {
    keywords: ["delivery price", "freight", "flat rate", "free shipping", "default weight", "frakt", "fraktpris"],
    tasks: ["Set the shipping price for a country", "Set the default weight per unit"],
    feature: "shop",
  }),
  store("shipping.methods", "/settings/shipping/methods", "Shipping methods", "Sales", "A country's named ways of shipping (Standard, Express …): add, open and reorder them. Shoppers see the methods that price their basket, cheapest first; with none, the flat rate is charged.", {
    keywords: ["shipping method", "shipping rates", "express", "standard shipping", "fraktmetode"],
    tasks: ["Add a shipping method", "Change the order of shipping methods"],
    feature: "shop",
  }),
  store("shipping.method", "/settings/shipping/methods/[methodId]", "Shipping method", "Sales", "One method: its name, transit time, free-above value and its rates per zone and profile, flat, by weight or by basket value in tiers.", {
    keywords: ["weight based shipping", "price based shipping", "rate table", "tiers", "vektbasert frakt"],
    tasks: ["Charge shipping by weight", "Charge shipping by basket value", "Give a zone its own rate", "Make a method free above an amount"],
    feature: "shop",
  }),
  store("shipping.zones", "/settings/shipping/zones", "Shipping zones", "Sales", "Groups of postal codes and prefixes inside a country with rates of their own; codes in no zone are Rest of country. Check which zone a postal code falls in.", {
    keywords: ["shipping zone", "postal codes", "postcode", "remote areas", "postnummer", "soner"],
    tasks: ["Add a shipping zone", "Check which zone a postal code is in"],
    feature: "shop",
  }),
  store("shipping.profiles", "/settings/shipping/profiles", "Shipping profiles", "Sales", "Groups of products with rates of their own on each method (bulky, fragile); every other product is General. A basket with several profiles pays the sum.", {
    keywords: ["shipping profile", "bulky goods", "shipping class", "fraktklasse"],
    tasks: ["Put products in a shipping profile", "Give bulky goods their own shipping rates"],
    feature: "shop",
  }),
  store("shipping.pickup", "/settings/shipping/pickup", "Pickup", "Sales", "Let customers collect at your stores and pickup points: the switch per place, a price (free by default), the usual time until ready and the instructions sent in the Ready for pickup email.", {
    keywords: ["click and collect", "pickup in store", "local pickup", "hente i butikk", "klikk og hent"],
    tasks: ["Let customers collect in your store", "Write pickup instructions"],
    feature: "shop",
  }),
  store("shipping.local", "/settings/shipping/local", "Local delivery", "Sales", "Deliver yourself to customers nearby: areas by postal codes or a radius from a place, with a price, a minimum basket and a free-above value. Check which areas cover a postal code.", {
    keywords: ["local delivery", "own delivery", "delivery radius", "hjemlevering", "lokal levering"],
    tasks: ["Add a local delivery area", "Deliver within a radius of your shop"],
    feature: "shop",
  }),
  store("returns.settings", "/settings/returns", "Returns settings", "Sales", "The store's rules for returns: the return window (never under the legal 14 days), the transit allowance, who pays return shipping, when refunds are made, goods the law excludes, companies, the return address and the instructions customers get (with translations).", {
    needs: "owner",
    keywords: ["return window", "withdrawal", "return policy", "return address", "who pays return shipping", "refund when", "instructions", "angrerett"],
    tasks: ["Set the return window", "Choose who pays for return shipping", "Write the return instructions", "Translate the return instructions"],
    feature: "shop",
  }),
  store("orders.settings", "/settings/orders", "Orders settings", "Sales", "How the store handles orders: whether shoppers may mark an order as a gift with a message, automatic archiving of finished orders after a number of days (off by default), how many days a draft order's pay link is valid, and whether staff other than the owner may record a payment taken outside Kaizena Flow.", {
    keywords: ["gift message", "gift", "auto archive", "archive orders", "pay link valid", "draft order link", "payment outside", "cash", "bank transfer", "staff may mark paid"],
    tasks: ["Turn gift messages on or off", "Archive finished orders automatically", "Set how long a draft's pay link is valid", "Let staff record payments taken outside Kaizena Flow"],
    feature: "shop",
  }),
  store("notifications", "/settings/notifications", "Notifications", "Settings", "The emails customers get about orders and returns (D238): each one's switch (the order confirmation, the change and renewal confirmations, the withdrawal acknowledgement and the return decisions are always sent), which languages have the store's own wording, and links to edit each email and to choose who on the team gets staff alerts.", {
    keywords: ["notification", "notifications", "customer emails", "order email", "shipping confirmation", "email template", "switch off email", "out for delivery email", "delivered email", "e-post", "varsler"],
    tasks: ["Switch off an order email", "Switch on the delivered email", "See which emails have your own wording"],
    feature: "shop",
  }),
  store("notifications.edit", "/settings/notifications/[notification]", "Edit a customer email", "Settings", "One customer email's subject, heading and text per language, with named placeholders such as {order_number}, checked for claims and web addresses before saving, a preview with a sample order, a test email to yourself and Use standard text to go back.", {
    keywords: ["email template", "edit email", "email subject", "email wording", "placeholder", "preview email", "test email", "standard text"],
    tasks: ["Change the subject of the shipping email", "Write your own text in the order confirmation", "Send a test email to yourself"],
    feature: "shop",
  }),
  store("notifications.staff", "/settings/notifications/staff", "Staff alerts", "Settings", "Who on the team is emailed about new orders, return requests, overdue refunds, low stock and automation, and a daily or weekly summary of the store's figures. Owners only.", {
    needs: "owner",
    keywords: ["staff notification", "new order email", "order alert", "staff alert", "daily summary", "weekly summary", "who gets emails", "recipients"],
    tasks: ["Get an email for every new order", "Choose who is told of return requests", "Get a daily summary"],
    feature: "shop",
  }),
  store("automation", "/settings/automation", "Automation", "Settings", "Rules that run when an order is paid: when the order matches conditions you choose (total, country, buyer, products, delivery, source, tags and more), tag it, tell staff or hold it so it is not sent. Each rule runs once per order and is logged.", {
    keywords: ["automation", "rules", "order rules", "workflow", "flow", "auto tag", "hold order", "fraud check", "notify staff"],
    tasks: ["Tag big orders automatically", "Hold orders to a country for checking", "Tell staff about orders with a product"],
    feature: "shop",
  }),
  store("automation.new", "/settings/automation/new", "New automation rule", "Settings", "Make a rule: its name, whether all or any of its conditions must hold, the conditions and what it does (tag, notify staff, hold).", {
    keywords: ["new rule", "add rule", "create automation"],
    feature: "shop",
  }),
  store("automation.rule", "/settings/automation/[ruleId]", "Automation rule", "Settings", "One rule: change its conditions and actions, switch it off or delete it.", {
    feature: "shop",
  }),
  store("automation.log", "/settings/automation/log", "Automation log", "Settings", "What the rules did in the last 12 months: each run's order, rule, whether it matched and what each action did or why it could not.", {
    keywords: ["automation log", "rule runs", "what rules did"],
    feature: "shop",
  }),
  store("tax", "/settings/tax", "Tax settings", "Sales", "How the store charges VAT: its VAT registration and number (checked in VIES, or the Norwegian register), where goods are sent from, its OSS and IOSS registrations, and what is on or missing for reverse charge and IOSS.", {
    needs: "owner",
    keywords: ["vat", "mva", "moms", "vat number", "reverse charge", "oss", "ioss", "one stop shop", "vies", "tax", "registration"],
    tasks: ["Save the store's VAT number", "Check the VAT number", "Record an OSS or IOSS registration", "See what is missing for reverse charge"],
    feature: "shop",
  }),
  store("invoices.settings", "/settings/invoices", "Invoicing settings", "Sales", "Invoicing for orders: the switch, what is missing before it can be switched on (business details, tax profile), the prefix and first number of the invoice and credit note series until the first is issued, the note printed on every document, and whether the confirmation email carries the invoice.", {
    needs: "owner",
    keywords: ["invoice", "faktura", "invoice numbers", "numbering", "series", "prefix", "credit note", "footer note", "bank details", "invoicing off", "stripe invoice"],
    tasks: ["Switch invoicing on or off", "See what is missing for invoices", "Set the invoice number prefix and first number", "Write the note printed on every invoice"],
    feature: "shop",
  }),
  store("payments", "/settings/payments", "Payments", "Sales", "Stripe: the store's accounts in test and live, going live, and invoices for orders.", {
    needs: "owner",
    keywords: ["stripe", "card", "go live", "payouts"],
    feature: "shop",
  }),

  // Store: analytics (D152) ------------------------------------------------------------------
  store("analytics", "/analytics", "Analytics", "Analytics", "The store's cockpit: revenue, profit, orders, conversion, basket size, customers and refunds against the previous period and last year, the funnel, best sellers, channels, target progress and what needs doing today.", {
    keywords: ["dashboard", "kpi", "revenue", "sales", "profit", "conversion", "statistics", "report", "performance"],
    tasks: ["See how the store is doing", "Find out why sales changed", "See what needs doing today"],
    feature: "shop",
  }),
  store("analytics.finance", "/analytics/finance", "Finance", "Analytics", "From gross sales to net revenue, contribution profit and estimated operating profit: discounts, refunds, VAT, cost of goods, payment and platform fees, shipping and marketing.", {
    keywords: ["profit", "margin", "cogs", "fees", "vat", "net sales", "contribution"],
    feature: "shop",
  }),
  store("analytics.payouts", "/analytics/payouts", "Payouts", "Analytics", "Each Stripe payout to the bank with its date, amount and Stripe's fees, the payments, refunds and disputes it settles with their orders, a flag where it does not add up or holds money not tied to an order, and a CSV.", {
    keywords: ["payout", "bank", "transfer", "settlement", "reconciliation", "stripe fees", "balance"],
    feature: "shop",
  }),
  store("analytics.payout", "/analytics/payouts/[payout]", "A payout", "Analytics", "One Stripe payout: each payment, refund, dispute and fee in it with the order it is for, and whether it adds up.", { feature: "shop" }),
  store("analytics.tax", "/analytics/tax", "VAT, OSS and IOSS reports", "Analytics", "VAT by delivery country, rate and basis made from your invoices and credit notes, the quarterly OSS and monthly IOSS return data in euro at the ECB rate, how they reconcile with Finance and your orders, and CSV files for your accountant. Your own figures, never a tax return.", {
    keywords: ["vat", "moms", "mva", "oss", "ioss", "one stop shop", "return", "rate", "country", "accountant", "reconciliation", "tax report", "ecb", "euro"],
    feature: "shop",
  }),
  store("analytics.customers", "/analytics/customers", "Customer analytics", "Analytics", "New against returning customers, repeat purchase rate, purchase frequency, lifetime value, customer segments (RFM) and cohort retention.", {
    keywords: ["ltv", "retention", "cohort", "rfm", "repeat", "loyal", "churn"],
    feature: "shop",
  }),
  store("analytics.products", "/analytics/products", "Product analytics", "Analytics", "Revenue, units, margin, refund rate and share of revenue and profit for each product.", {
    keywords: ["best sellers", "top products", "margin", "pareto"],
    feature: "shop",
  }),
  store("analytics.inventory", "/analytics/inventory", "Inventory analytics", "Analytics", "Stock on hand and its value, sales velocity, days of stock left, products about to run out and dead stock.", {
    keywords: ["stock", "stockout", "velocity", "turnover", "dead stock", "reorder"],
    feature: "shop",
  }),
  store("analytics.marketing", "/analytics/marketing", "Marketing analytics", "Analytics", "Channels with sessions, orders, revenue, conversion, cost to win a customer and return on ad spend; ad spend entry; discounts and coupons.", {
    keywords: ["cac", "roas", "ads", "channels", "campaign", "spend", "discounts", "coupons"],
    tasks: ["Enter this month's ad spend", "See which channel earns the most"],
    feature: "shop",
  }),
  store("analytics.subscriptions", "/analytics/subscriptions", "Subscription analytics", "Analytics", "Monthly recurring revenue and how it moves, churn, failed renewals and subscribers.", {
    keywords: ["mrr", "arr", "churn", "recurring"], feature: "subscriptions" }),
  store("analytics.traffic", "/analytics/traffic", "Traffic analytics", "Analytics", "Visits, the funnel from visit to purchase, devices, countries and cities, searches that found nothing, sales by weekday and hour, and at the bottom refunds and returns (return rate, reasons, most returned products, how fast refunds are made).", {
    keywords: ["visitors", "sessions", "funnel", "device", "mobile", "geography", "search", "heatmap", "refunds", "return rate", "returns analytics", "return reasons"],
  }),
  store("analytics.settings", "/analytics/settings", "Analytics settings", "Analytics", "Cost of goods, payment fee and shipping cost estimates, fixed costs, customer lifetime, monthly revenue targets, and whether visits are counted.", {
    needs: "owner",
    keywords: ["cost", "cogs", "fees", "target", "goal", "visit counting"],
    tasks: ["Set this month's revenue target", "Turn visit counting on or off", "Apply costs to earlier orders"],
  }),

  store("website", "/website", "Website", "Website", "The store's website at a glance: a card for each of its pages, blog, media, menus, headers, footers, design and translations.", {
    keywords: ["site", "storefront", "content"],
  }),
  store("settings", "/settings", "Settings", "Settings", "The store's settings at a glance: a card for each page, under Store, Selling, Site, Tools and Account.", {
    keywords: ["configure", "setup", "options"],
  }),

  // Store: store settings --------------------------------------------------------------------
  store("countries", "/settings/countries", "Countries", "Store", "The countries the store sells to and its own country (the business's country when it sells there, else the first); with Several countries off, the one country it sells in, the others kept with their prices and settings.", {
    keywords: ["markets", "country", "sell abroad", "international", "home country", "several countries"],
    tasks: ["Sell in another country", "Stop selling to a country"],
  }),
  store("localization", "/settings/localization", "Languages and currencies", "Store", "The languages and currencies the store offers, each country's language, and the rates amounts are converted at.", {
    keywords: ["translate", "euro", "exchange rate", "multilingual", "language", "currency", "ECB"],
  }),
  store("translate", "/translate", "Translate the store", "Store", "Translate products, menus, pages and articles into another language with AI, reading and keeping each text before it is saved.", {
    feature: ["languages", "countries"],
    keywords: ["translation", "language", "AI", "multilingual", "products", "legal"],
    tasks: ["Translate the store into English", "Find what is not translated yet"],
  }),
  store("search", "/search", "Search", "Store", "What shoppers searched for in the last 30 days, and searches that found nothing.", {
    keywords: ["site search", "queries"],
    feature: "shop",
  }),
  store("chat", "/chat", "Chat assistant", "Store", "The storefront chat assistant that helps shoppers first, and its knowledge base.", {
    keywords: ["customer chat", "chatbot", "knowledge", "chat agent"],
  }),
  store("support", "/support", "Support inbox", "Store", "Every conversation with the store's customers, live: who is waiting for a person, who is talking to the chat assistant, and what was said. Open one to read it as it happens.", {
    keywords: ["inbox", "live chat", "customer service", "helpdesk", "conversations", "tickets"],
    tasks: ["See who is waiting", "Read a conversation with the chat assistant", "Set yourself online or away"],
  }),
  store("support.requests", "/support/requests", "Support requests", "Store", "What the store's chat assistant could not do itself and passed to your team: a refund, cancelling a paid order, changing an address, an exception or anything else, with the conversation, the order and the customer. Do the work on the order page, then mark it done or decline it with a note; the customer is told in the chat and by email when away. Decided requests are under ?show=decided.", {
    keywords: ["requests", "refund request", "cancel order", "change address", "exception", "support"],
    tasks: ["Decide a request the chat assistant passed on", "See decided requests"],
  }),
  store("support.reports", "/support/reports", "Support reports", "Store", "Figures for the store's support desk over a period: conversations started, the share the AI handled alone and the share it resolved (its own judgement), the hand-over rate and why, time to a person's first answer (median and slowest tenth), missed conversations, time to the end, ratings, tone at the end, topics, requests and the partner's drafts. Per desk, never per person; rates and medians from 10 conversations.", {
    keywords: ["support report", "response time", "first response", "csat", "handover rate", "missed chats", "deflection"],
    tasks: ["See how long customers wait for an answer", "See how many chats the AI handles alone"],
  }),
  store("support.replies", "/support/replies", "Saved replies", "Store", "The support desk's saved replies: texts with a title and a /shortcut, optionally for one language, that your team puts in an answer by typing / in the inbox's composer. {customer_first_name}, {agent_first_name} and {store} are filled in for the conversation.", {
    keywords: ["saved replies", "canned responses", "macros", "templates", "shortcuts", "support"],
    tasks: ["Add a saved reply", "Change a saved reply's text"],
  }),
  store("support.settings", "/support/settings", "Support settings", "Store", "Who answers the store's customers in the chat: the chat assistant alone, the AI first and then your team, or your team only. Also email follow-up when nobody is there, opening hours, when quiet conversations end, when your people are emailed about a waiting customer, how they are named, and (the owner's) how long transcripts are kept.", {
    keywords: ["support mode", "live chat", "people only", "opening hours", "email follow-up", "transcripts", "handover"],
    tasks: ["Let people answer the chat", "Answer customers with the AI first", "Set support opening hours", "Turn email answers on or off"],
  }),
  store("seo", "/settings/seo", "SEO & Reach", "Store", "How search engines, social sharing and AI crawlers see the store, per country.", {
    keywords: ["google", "meta description", "crawlers"],
  }),
  store("menus", "/menus", "Menus", "Store", "The store's menus: links to pages, products, categories and more, nested and ordered.", {
    keywords: ["navigation", "links"],
  }),
  store("redirects", "/redirects", "Redirects", "Store", "Redirects send shoppers and search engines from an address that moved to its new one, in every country and language. Kaizena Flow makes one itself when a product's, category's or tag's address changes; here you add, edit, delete and search your own (a path to a path on the store, permanent), and see how often each was used. Needs the right to change the website.", {
    tasks: ["Redirect an old address to a new one", "Search the redirects", "Delete a redirect", "See which redirects are used", "Import or export redirects"],
    keywords: ["301", "404", "broken link", "moved page", "omdiriger", "redirect", "old url", "change handle", "permalink"],
  }),
  store("redirects.import", "/redirects/import", "Import redirects", "Store", "Brings redirects in from a CSV file with the columns Redirect from and Redirect to (Shopify's file reads as it is). Upload, choose what happens when an address already has a redirect, check (a dry run that lists every line's problem: loops, chains, duplicates, addresses that are live pages, other websites), then import. Never deletes a redirect. Needs the right to change the website.", {
    tasks: ["Upload a redirect file", "Import a Shopify redirect file", "Continue an open import", "See the recent imports"],
    keywords: ["import redirects", "csv", "upload redirects", "shopify", "migrate", "bulk redirects", "301 file", "importer omdirigeringer"],
  }),
  store("redirects.import.job", "/redirects/import/[jobId]", "Redirect import", "Store", "One redirect import: its option, the check's findings line by line, the counts, the confirmation, progress while it works and the result. Download the problems as a CSV, cancel an import that is running.", {
    tasks: ["Choose the option and check the file", "Read each line's problems", "Import after the check", "Cancel the import", "Download the problems as CSV"],
    keywords: ["dry run", "check the file", "import problems", "import result", "cancel import"],
  }),
  store("redirects.export", "/redirects/export", "Export redirects", "Store", "Downloads the store's redirects as a CSV file with the columns Redirect from and Redirect to: your own (the default) or all, the automatic ones too. A small store gets the file at once, a large one a job with a Download button. The file reads back in as it is.", {
    tasks: ["Export the manual redirects", "Export all redirects", "Choose the Excel (Nordic) or the standard file format", "Download a finished export"],
    keywords: ["export redirects", "csv", "download redirects", "backup", "eksporter omdirigeringer"],
  }),
  store("redirects.404s", "/redirects/404s", "Pages not found", "Store", "A report of the addresses shoppers and search engines asked for that the store did not have, the most asked first, for the last 7, 30 or 90 days, with a one-click redirect to a suggested page. Counts are at least what happened. No visitor is identified.", {
    tasks: ["See the most asked-for missing addresses", "Redirect a missing address", "Hide an address", "Download the report"],
    keywords: ["404", "not found", "broken links", "missing pages", "dead links", "404 report", "fix broken links", "side ikke funnet"],
  }),
  store("navigation", "/settings/navigation", "Header and footer", "Store", "Logos, site icon, which menus the standard header and footer show, and business details.", {
    keywords: ["logo", "favicon"],
  }),
  store("headers", "/headers", "Headers", "Store", "Custom headers built in the page builder."),
  store("header.new", "/headers/new", "New header", "Store", "Starts a custom header."),
  store("header", "/headers/[pageId]", "Header", "Store", "Builds a custom header."),
  store("header.preview", "/headers/[pageId]/preview", "Header preview", "Store", "Previews a custom header."),
  store("footers", "/footers", "Footers", "Store", "Custom footers built in the page builder."),
  store("footer.new", "/footers/new", "New footer", "Store", "Starts a custom footer."),
  store("footer", "/footers/[pageId]", "Footer", "Store", "Builds a custom footer."),
  store("footer.preview", "/footers/[pageId]/preview", "Footer preview", "Store", "Previews a custom footer."),
  store("design", "/settings/design", "Design", "Store", "The store's theme: colours, fonts, buttons, cards, light and dark; and the themes installed, each a whole look (theme, header, footer, product page and CSS) to switch to and back.", {
    keywords: ["theme", "colours", "fonts", "look", "design profile", "design template"],
  }),
  store("design.theme", "/settings/design/themes/[install]", "Customise theme", "Store", "One installed theme that is not live: its preview on the store's own pages, what switching to it changes (layouts, section styles, settings that stay the owner's own, fonts, CSS), its settings and its own CSS. Visitors see nothing of it until the store switches.", {
    keywords: ["preview theme", "try a theme", "what changes", "customise theme", "installed theme"],
  }),
  store("close", "/settings/close", "Close store", "Store", "Closes the store: stops sales, ends the Kaizena Flow plan at the end of its period, releases its domains and cancels orders waiting for payment, after a fresh sign-in and the store's address typed in. Blocked while paid goods are unsent or subscriptions and subscription boxes run. Nothing is deleted; the owner can reopen for thirty days. For a closed or suspended store the page shows its status and the reopen button.", {
    needs: "owner",
    keywords: ["close store", "delete store", "archive store", "shut down", "stop selling", "reopen store", "suspend"],
    tasks: ["Close the store", "See what stops me closing the store", "Reopen a closed store"],
  }),
  store("domains", "/settings/domains", "Domains", "Store", "The store's addresses and its own domain.", { keywords: ["url", "custom domain"] }),
  store("domain.move-in", "/settings/domains/move-in", "Bring a domain here", "Store", "Bringing a domain the store has elsewhere to Kaizena Flow: its DNS (the records found and copied, checked, then the nameservers changed, with the move followed until it arrives) and its registration (a transfer with the code from the current registrar, paid first and refunded if it fails).", {
    keywords: ["transfer in", "move domain here", "auth code", "epp code", "nameservers", "zone file", "import dns"],
    needs: "owner",
  }),
  store("domain.move", "/settings/domains/move/[domain]", "Move a domain", "Store", "Moving one of the store's domains away, step by step: download its DNS records, check a new DNS provider and switch to it (with a way back for 30 days), get the transfer code for another registrar, or stop using it in the store.", {
    keywords: ["transfer domain", "auth code", "epp code", "transfer code", "nameservers", "zone file", "export dns", "leave"],
    needs: "owner",
  }),
  store("company", "/settings/company", "Company", "Store", "The legal business, contact details, office hours and places (shops, pickup points).", {
    keywords: ["business details", "address", "vat number"],
  }),
  store("company.place.new", "/settings/company/places/new", "New place", "Store", "Adds a shop or pickup point."),
  store("company.place", "/settings/company/places/[placeId]", "Place", "Store", "One shop or pickup point."),
  store("integrations", "/integrations", "Integrations", "Store", "Zapier, Make and Slack, and how their sends are doing; shipping carriers being prepared.", { keywords: ["zapier", "make", "slack", "webhooks", "shipping carriers"] }),
  store("integration", "/integrations/[provider]", "Integration", "Store", "Connects one integration, chooses its events, tests it, and shows recent sends."),
  store("integrations.shipping", "/integrations/shipping/[carrier]", "Shipping carrier", "Store", "Saves the store's own agreement with Posten / Bring, PostNord, Porterbuddy or Helthjem, ready for the day its connection arrives.", {
    keywords: ["posten", "bring", "postnord", "porterbuddy", "helthjem", "carrier", "freight", "labels", "tracking"],
    feature: "shop",
  }),
  store("integrations.google-reviews", "/integrations/google-reviews", "Google reviews", "Store", "Shows the store's Google rating and reviews on its pages."),
  store("ai", "/settings/ai", "AI", "Store", "The store's own AI provider and models, or Kaizena Flow's.", { keywords: ["model", "provider", "openai"] }),
  store("features", "/settings/features", "Features", "Store", "Switches the online shop and the store's features on or off (D178): subscriptions, subscription boxes, appointments, stays and rentals, several countries, languages and currencies, selling to businesses, the bonus and referral programs; what is in use, what blocks switching it off, and the store's time zone and appointment reminder. Every member sees it; only owners switch. (Work is switched on under Work, at the owner's level.)", {
    tasks: ["Switch the online shop off to run a website only", "Switch a feature on or off", "Set the store's time zone"],
    keywords: ["modules", "features", "switch on", "switch off", "online shop", "website only", "bookings", "subscription boxes", "time zone", "loyalty", "bonus program", "referral program", "sell to businesses", "b2b", "several languages", "several currencies", "several countries"],
  }),
  store("cookies", "/settings/cookies", "Cookies and tracking", "Store", "The cookie scan, tracking tools, the consent banner and the store's own code.", {
    keywords: ["gdpr", "consent", "pixel", "analytics"],
  }),

  // Store: account ---------------------------------------------------------------------------
  store("billing", "/billing", "Billing", "Account", "The store's Kaizena Flow plan, the fee per sale, and Kaizena Flow's invoices.", {
    needs: "owner",
    keywords: ["plan", "subscription to kaizen", "invoice", "fee"],
  }),
  store("staff", "/staff", "Team", "Account", "The store's members: their roles, collaborators with an end date, who has two-step sign-in, and whether the store requires it.", {
    needs: "owner",
    tasks: ["Invite someone as staff or as a collaborator with an end date", "Change a member's role", "Remove access", "Require two-step sign-in of everyone"],
    keywords: ["users", "roles", "invite", "collaborator", "agency", "two-step", "2fa", "two factor", "authenticator", "permissions"],
  }),
  store("staff.roles", "/staff/roles", "Roles", "Account", "The store's roles: what each can see and change, per area. Orders, Products, Marketing, Content, Analytics and Read-only to start from.", {
    needs: "owner",
    tasks: ["Make a role", "Choose what a role can view or change", "Delete a role nobody holds"],
    keywords: ["permissions", "access", "staff roles", "who can", "read only"],
  }),
  store("activity", "/activity", "Activity log", "Account", "Who changed what and when: products, prices, pages, discounts, shipping, staff and payment settings. Filter by person, area, action and period; owners can download it as CSV.", {
    tasks: ["See who changed a price", "Filter by person or area", "Download the log as CSV (owners)"],
    keywords: ["audit", "audit log", "history", "who did", "changes", "log"],
  }),
  store("legal", "/settings/legal", "Legal pages", "Selling", "Starter drafts of the terms of sale, privacy statement, returns and shipping policies, withdrawal information and imprint, written from the store's own details in Norwegian, Swedish, Danish or English; which published page each role has; and what checkout says about the terms (a link, a tick box or nothing).", {
    needs: "owner",
    tasks: ["Make a starter draft", "Choose the published page for terms, privacy and the rest", "Choose link, tick box or nothing at checkout"],
    keywords: ["terms", "terms and conditions", "privacy", "privacy policy", "imprint", "policies", "gdpr", "shipping policy", "returns policy", "checkbox", "accept", "vilkår", "personvern"],
  }),
  store("accessibility", "/settings/accessibility", "Accessibility", "Site", "What has been assessed against the accessibility requirements (status, who assessed and when), known issues, and a draft accessibility statement made from it and from what the site itself knows.", {
    needs: "owner",
    tasks: ["Record an assessment", "Make a draft accessibility statement"],
    keywords: ["wcag", "eaa", "accessibility statement", "tilgjengelighet", "contrast", "screen reader"],
  }),

  // Outside a store --------------------------------------------------------------------------
  account("stores", "", "Control center", "Every store you run at a glance: what needs you first, the week's sales and orders, stock running out, and the latest orders.", {
    keywords: ["overview", "dashboard", "home", "all my stores", "bird's eye", "attention"],
  }),
  account("stores.all", "/stores", "Stores", "Your stores, creating another and duplicating one, and the copies made lately."),
  account("stores.copy", "/stores/copy/[store]", "Duplicate a store", "Make a new store from one you own: choose all, some or none of its pages, products and posts, and whether customers and order history come along. Settings always come, without secrets.", {
    needs: "owner",
    keywords: ["duplicate", "copy", "clone", "copy a store", "duplicate store", "new store from"],
    tasks: ["Name the new store and choose its address", "Choose pages, products and posts", "Copy customers and order history, after confirming data use"],
  }),
  account("stores.copy.progress", "/stores/copies/[copyId]", "Store copy", "How a store copy is going: the steps, what is copied so far and, when done, links to the new store.", {
    needs: "owner",
    keywords: ["copy progress", "duplicate progress"],
  }),
  account("account.domains", "/account/domains", "Your domains", "Every domain you hold through Kaizena Flow, whichever store uses it: which store uses it and moving it to another of your stores, renewal and renewing now, the DNS records Kaizena Flow keeps for it with set-ups and undo, and moving it away.", {
    keywords: ["domains", "domain", "dns", "renew", "renewal", "registration", "my domains", "move domain", "nameservers"],
    tasks: ["See every domain you hold", "Use a domain with another of your stores", "Turn a domain's renewal on or off", "Change a domain's DNS records"],
  }),
  account("account.domains.buy", "/account/domains/buy", "Buy a domain", "Buying a domain without a store, once Kaizena Flow sells them on their own: search, who buys (a private person in Norway or a business with its VAT number), the price with VAT, and paying on Stripe's page. ?domain= searches a name at once.", {
    keywords: ["buy domain", "register domain", "new domain", "purchase domain"],
  }),
  account("account.domains.move", "/account/domains/move/[domain]", "Move a domain", "Moving one of your domains away from Kaizena Flow: its DNS to another provider (checked first, with a way back for 30 days), the registration to another registrar with its transfer code, or both.", {
    keywords: ["move domain", "transfer domain", "transfer code", "auth code", "nameservers", "leave"],
  }),
  account("account.billing", "/account/billing", "Billing", "The plan of each store you own, what it costs, when it renews and Kaizena Flow's fee.", {
    keywords: ["plan", "subscription", "invoice", "renews", "fee", "cost"],
  }),
  account("account.appearance", "/account/appearance", "Appearance", "How the admin looks for you: light or dark, and the colour scheme, with every scheme drawn in light and dark with the admin's buttons, cards, figures and lists so you can compare them. Your stores keep their own colours.", {
    keywords: ["appearance", "colours", "colors", "theme", "scheme", "dark", "light", "meadow", "indigo", "look"],
    tasks: ["Choose light or dark", "Choose the admin's colour scheme", "Compare the schemes side by side"],
  }),
  account("account.usage", "/account/usage", "AI usage", "What the AI used for the stores you own, per provider and model and per store.", {
    keywords: ["tokens", "cost", "spend", "requests", "usage", "consumption", "ai", "provider", "model"],
    tasks: ["See your total AI usage per provider and model", "See usage per store", "Choose the period"],
  }),
  account("account.limits", "/account/limits", "Usage and limits", "What each store you own has used this month (storage, products, staff, domains, visits, marketing emails and AI) against what its plan includes.", {
    needs: "owner",
    keywords: ["usage", "limits", "quota", "storage", "bandwidth", "traffic", "visits", "plan limits", "capacity"],
    tasks: ["See what each store has used this month", "See what is close to its limit"],
  }),
  account("account.referrals", "/account/referrals", "Referrals", "Your referral link and code, how many came by it, the stores that opened through it and the credit you earned on what they pay Kaizena Flow, which comes off your own Kaizena Flow invoices.", {
    needs: "owner",
    keywords: ["referral", "refer", "affiliate", "invite", "recommend", "commission", "credit", "link", "code"],
    tasks: ["Copy your referral link", "See the stores that opened through it", "See your credit and how it is used"],
  }),
  account("account.wordpress", "/account/wordpress", "WordPress", "The WordPress plugin to download and the sites connected to your stores, each with a way to disconnect it. A connected site can show your products as a grid or a carousel with a shortcode.", {
    needs: "owner",
    keywords: ["wordpress", "plugin", "shortcode", "embed", "grid", "carousel", "connect", "website", "woocommerce"],
    tasks: ["Download the WordPress plugin", "See the sites connected to your stores", "Disconnect a site"],
  }),
  account("account.wordpress.connect", "/account/wordpress/connect", "Connect a WordPress site", "Where the plugin sends you to approve a WordPress site: it names the site and what it may read, and you approve or cancel.", {
    needs: "owner",
    keywords: ["approve", "authorize", "connect wordpress"],
  }),
  account("account.themes.try", "/account/themes/try/[theme]", "Try a theme in your store", "Where *Try it in your store* on a theme's page in the theme store lands: each store where you may change the website, with a button that adds the theme to its theme library without making it live, then opens it there to preview and customise.", {
    keywords: ["theme store", "try theme", "install theme", "add theme"],
  }),
  account("account.support", "/account/support", "Support", "The support inboxes of every store where you may read them, in one list: who is waiting and what was said, filterable by store.", {
    keywords: ["inbox", "live chat", "customer service", "conversations"],
  }),
  account("account.kaizen_support", "/account/kaizen-support", "Kaizena Flow support", "Ask Kaizena Flow itself for help (a problem with the admin, billing with Kaizena Flow, how something works): your conversations with Kaizena Flow's support, answered first by Kaizena Flow's assistant and then by people from Kaizena Flow, with answers also by email. A new request may name the store it is about. ?c= opens one.", {
    keywords: ["help", "contact kaizen", "kaizen support", "bug", "problem", "ask kaizen"],
    tasks: ["Ask Kaizena Flow for help", "Read Kaizena Flow's answer to a request"],
  }),
  account("account", "/account", "Your account", "Your name, picture, password, light or dark, and Kaizen Life.", {
    keywords: ["profile", "password", "avatar", "dark mode"],
  }),

  // Platform ---------------------------------------------------------------------------------
  platform("website", "/website", "Website", "Kaizena Flow site", "Kaizena Flow's own website: pages, blog, media, templates, menus, header, footer and fonts, each a card.", { keywords: ["site"] }),
  platform("settings", "/settings", "Settings", "Platform", "Kaizena Flow's own settings: header and footer, search, SEO, cookies, Google reviews, Stripe, AI, chat agent, emails and languages, each a card.", { keywords: ["configuration"] }),
  platform("overview", "", "Home", "Platform", "The operator's first look: requests waiting, stores by state, plans, failed emails and AI use.", {
    keywords: ["dashboard", "home", "attention", "status"],
  }),
  platform("support", "/support", "Support inbox", "Support", "Kaizena Flow's own support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.", {
    keywords: ["inbox", "live chat", "helpdesk", "conversations"],
  }),
  platform("support.reports", "/support/reports", "Support reports", "Support", "Figures for Kaizena Flow's own support desk over a period: conversations, the AI alone, hand-overs, waiting times, ratings, tone and topics.", {
    keywords: ["support report", "response time", "kaizen support"],
  }),
  platform("support.stores", "/support/stores", "Stores' support", "Support", "Each store's support desk in figures over a period: mode, waiting now, conversations, the AI alone, hand-overs, first answer, missed and ratings. Counts and rates only, never a conversation.", {
    keywords: ["stores support", "support totals", "support per store"],
  }),
  platform("support.replies", "/support/replies", "Saved replies", "Support", "Kaizena Flow's support desk's saved replies: texts with a /shortcut that Kaizena Flow's people put in an answer from the inbox, with {customer_first_name}, {agent_first_name} and {store} filled in.", {
    keywords: ["saved replies", "canned responses", "macros"],
  }),
  platform("support.settings", "/support/settings", "Support settings", "Support", "Who answers Kaizena Flow's visitors in the chat (the assistant alone, the AI first, or people only), email follow-up, opening hours, when quiet conversations end, when platform admins are emailed and how long transcripts are kept.", {
    keywords: ["support mode", "live chat", "opening hours", "email follow-up"],
  }),
  platform("requests", "/requests", "Access requests", "Platform", "People asking to open a store: approving creates it and emails a sign-in link.", {
    keywords: ["sign-ups", "waiting list", "approve"],
  }),
  platform("customers", "/customers", "Customers", "Platform", "Store owners with their stores, plans and invoices."),
  platform("customer", "/customers/[accountId]", "Customer", "Platform", "One store owner: stores, plans, invoices and emails."),
  platform("stores", "/stores", "Stores", "Platform", "Every store with its plan, subscription and fee."),
  platform("themes", "/themes", "Themes", "Platform", "Kaizena Flow's themes (D241, D273, D275), a section of its own beneath Website (D285): a whole look (theme, header, footer, product page layout and CSS, never brand) with up to five presets and its own content, the content a new store starts with. Add and update Kaizena Flow's own themes, make one from a store or from scratch, publish, unpublish, archive, restore or delete it, order them and preview it; make demo stores (D277), live stores wearing a theme; set up the starting content and make its pictures; build the theme store's own pages (the list and a theme's page) in the page builder. Any store applies one from its Design settings and people creating a store choose one.", {
    tasks: ["Make a theme from a store", "Make a theme from scratch", "Publish a theme", "Preview a theme", "Archive a theme", "Make a demo store", "Set up the starting content", "Make the starting content's pictures", "Build the theme store's pages"],
    keywords: ["design profile", "look", "theme preset", "style", "skin", "demo store", "store template", "content pack", "starter"],
  }),
  platform("theme-store-page", "/themes/pages/[pageId]", "Theme store page", "Platform", "One of the theme store's own pages in the page builder (D285): the list of themes at /themes, or the page every theme has at /themes/{theme}, built around the theme store's components (the themes, a theme's preview, See it live, highlights, pictures, what you get, details) with words and sections of your own. A draft until published; Unpublish shows the standard page again.", {
    tasks: ["Edit the theme store's page", "Edit a theme's page"],
    keywords: ["theme store", "themes page", "theme page", "theme detail page"],
  }),
  platform("theme-store-page.preview", "/themes/pages/[pageId]/preview", "Theme store page preview", "Platform", "Previews a theme store page's draft; a theme's page with the first theme, or the one ?theme= names."),
  platform("theme", "/themes/[presetId]", "Theme", "Platform", "One theme's details (title, summary, description, picture) saved as a draft, its life (publish, unpublish, archive, restore, delete while unused), its photographs, its theme store listing, previews of the published look and the draft, and starting its look again from a store.", {
    tasks: ["Preview a theme", "List a theme in the theme store"],
    keywords: ["showcase", "listing"],
  }),
  platform("theme.content", "/themes/[presetId]/content", "Theme content", "Platform", "A theme's own content (D275): the pages, products and pictures its preview and photographs show and new stores started from it begin with; edited in its store admin, its pictures made, published with the theme, or replaced with a copy of other content.", {
    tasks: ["Edit a theme's content", "Make a theme's pictures", "Give a theme content"],
    keywords: ["demo store", "demo content", "sample content", "content pack", "starter"],
  }),
  platform("theme.settings", "/themes/[presetId]/theme", "Theme settings", "Platform", "A theme's settings: colours, fonts, headings, buttons, corners, layout, product cards, light and dark, in the theme editor; saved as the theme's draft.", {
    keywords: ["colours", "fonts", "buttons", "corners", "dark mode"],
  }),
  platform("theme.presets", "/themes/[presetId]/presets", "Theme presets", "Platform", "A theme's presets: its own look and up to five ready-made designs over it for different kinds of stores (colours, fonts, buttons, section styles), added, renamed, ordered, removed and previewed; part of the theme's draft until it is published.", {
    tasks: ["Add a preset to a theme", "Preview a theme's preset"],
    keywords: ["preset", "variation", "style", "design for a trade"],
  }),
  platform("theme.preset", "/themes/[presetId]/presets/[key]", "Theme preset", "Platform", "One of a theme's presets: its name and its look in the theme editor, saved into the theme's draft."),
  platform("theme.header", "/themes/[presetId]/header", "Theme header", "Platform", "A theme's header: the standard one, or its own built in the page builder; saved as the theme's draft."),
  platform("theme.footer", "/themes/[presetId]/footer", "Theme footer", "Platform", "A theme's footer: the standard one, or its own built in the page builder; saved as the theme's draft."),
  platform("theme.product-layout", "/themes/[presetId]/product-layout", "Theme product page", "Platform", "A theme's product page layout: the standard one, or its own built in the page builder; saved as the theme's draft."),
  platform("theme.css", "/themes/[presetId]/css", "Theme CSS", "Platform", "A theme's own CSS for every page, checked when saved; part of the theme's draft."),
  platform("theme.demo-store", "/themes/demo-stores/[starterId]", "Demo store", "Platform", "One demo store (D277), a live store wearing a theme: publish it live as it stands or take it down, its trade and picture for See it live, open its admin to customise it, and Publish this look… as a new theme, a preset of the theme it wears or that theme's next version. Or one set of starting content (D275): publish it (its store is kept as a copy new stores are made from), unpublish, archive or restore it, delete it while nothing used it, preview it, and choose the features a new store starts with switched on.", {
    tasks: ["Publish a demo store", "Preview a demo store", "Edit a demo store's products and pages", "Make a theme from a demo store", "Add a demo store's look as a preset"],
    keywords: ["store template", "content pack", "starter", "demo content", "see it live", "publish this look"],
  }),
  platform("theme.demo-store.new", "/themes/demo-stores/new", "New demo store", "Platform", "Make a demo store (D277): its name, its address, the theme or preset it wears and the starting content it is copied from; it opens in its own store admin to customise.", {
    tasks: ["Make a demo store"],
    keywords: ["demo store", "live store", "showcase", "see it live"],
  }),
  platform("store", "/stores/[store]", "Store", "Platform", "One store's plan: start, change or cancel it, its fee and discount; apply a theme to it."),
  platform("store.invoice", "/stores/[store]/invoices/[invoiceId]", "Plan invoice", "Platform", "One of a store's plan invoices."),
  platform("plans", "/plans", "Plans", "Platform", "Kaizena Flow's plans, their prices and fees, synced to Stripe.", { keywords: ["pricing", "tiers"] }),
  platform("plan-limits", "/plans/limits", "Limits", "Platform", "What each plan includes, in a table with the plans as columns: storage, products, staff, domains, marketing emails, AI and traffic, and the default for stores without a plan. Traffic only warns.", {
    keywords: ["limits", "quota", "plan limits", "storage", "bandwidth", "traffic", "allowance", "default limits"],
    tasks: ["Set what each plan includes", "Set the default for stores without a plan"],
  }),
  platform("plan-features", "/plans/features", "Plan features", "Platform", "Every feature in a table with the plans as columns, and a box to tick what each plan includes.", {
    keywords: ["compare plans", "features", "what is included", "tiers"],
  }),
  platform("discounts", "/discounts", "Discounts", "Platform", "Discount codes for stores' plans."),
  platform("discount", "/discounts/[discountId]", "Discount", "Platform", "One plan discount code."),
  platform("plan-reminders", "/plan-reminders", "Plan reminders", "Platform", "Emails to owners who left a plan checkout."),
  platform("plan-reminder.new", "/plan-reminders/new", "New plan reminder", "Platform", "Adds a plan reminder step."),
  platform("plan-reminder", "/plan-reminders/[stepId]", "Plan reminder", "Platform", "One plan reminder step."),
  platform("referrals", "/referrals", "Referrals", "Platform", "Kaizena Flow's referral program: whether it is on, the commission, months, pending days and cookie days; the referrers with block, unblock and credit adjustments; the referred stores with void; and totals per currency.", {
    keywords: ["referral", "refer", "affiliate", "commission", "invite", "credit", "referrer"],
    tasks: ["Switch the referral program on or off and set its terms", "Block or unblock a referrer", "Void a referral", "Add or remove a referrer's credit with a reason"],
  }),
  platform("stripe", "/stripe", "Stripe", "Platform", "Kaizena Flow's Stripe webhooks per mode, the default fee per sale and the checkout's look."),
  platform("pages", "/pages", "Pages", "Kaizena Flow site", "Kaizena Flow's own website pages."),
  platform("page.new", "/pages/new", "New page", "Kaizena Flow site", "Starts a Kaizena Flow page."),
  platform("page", "/pages/[pageId]", "Page", "Kaizena Flow site", "Builds a Kaizena Flow page."),
  platform("page.preview", "/pages/[pageId]/preview", "Page preview", "Kaizena Flow site", "Previews a Kaizena Flow page."),
  platform("page.ai", "/pages/ai", "Create a page with AI", "Kaizena Flow site", "The AI page studio for Kaizena Flow's site."),
  platform("page.categories", "/pages/categories", "Page categories and tags", "Kaizena Flow site", "Categories and tags for Kaizena Flow's pages."),
  platform("articles", "/articles", "Blog", "Kaizena Flow site", "Kaizena Flow's blog."),
  platform("article.new", "/articles/new", "New article", "Kaizena Flow site", "Starts a Kaizena Flow article."),
  platform("article", "/articles/[pageId]", "Article", "Kaizena Flow site", "Writes a Kaizena Flow article."),
  platform("article.preview", "/articles/[pageId]/preview", "Article preview", "Kaizena Flow site", "Previews a Kaizena Flow article."),
  platform("article.categories", "/articles/categories", "Blog categories and tags", "Kaizena Flow site", "Categories and tags for Kaizena Flow's articles."),
  platform("headers", "/headers", "Headers", "Kaizena Flow site", "Kaizena Flow's custom headers."),
  platform("header.new", "/headers/new", "New header", "Kaizena Flow site", "Starts a Kaizena Flow header."),
  platform("header", "/headers/[pageId]", "Header", "Kaizena Flow site", "Builds a Kaizena Flow header."),
  platform("header.preview", "/headers/[pageId]/preview", "Header preview", "Kaizena Flow site", "Previews a Kaizena Flow header."),
  platform("footers", "/footers", "Footers", "Kaizena Flow site", "Kaizena Flow's custom footers."),
  platform("footer.new", "/footers/new", "New footer", "Kaizena Flow site", "Starts a Kaizena Flow footer."),
  platform("footer", "/footers/[pageId]", "Footer", "Kaizena Flow site", "Builds a Kaizena Flow footer."),
  platform("footer.preview", "/footers/[pageId]/preview", "Footer preview", "Kaizena Flow site", "Previews a Kaizena Flow footer."),
  platform("media", "/media", "Media", "Kaizena Flow site", "Kaizena Flow's media library."),
  platform("templates", "/templates", "Templates", "Kaizena Flow site", "The marketplace's templates, store owners' and Kaizena Flow's own: hide one from every store's list, or show it again.", {
    keywords: ["marketplace", "saved parts", "moderation"],
  }),
  platform("menus", "/menus", "Menus", "Kaizena Flow site", "Kaizena Flow's menus."),
  platform("navigation", "/navigation", "Header and footer", "Kaizena Flow site", "Kaizena Flow's logos, icon, business details and menus."),
  platform("fonts", "/fonts", "Fonts", "Kaizena Flow site", "Kaizena Flow's self-hosted fonts."),
  platform("site_themes", "/site-design", "Design", "Kaizena Flow site", "The themes installed on Kaizena Flow's own site, one live: add a published theme without going live, switch the site to an installed one (only the look changes: colours, fonts, header, footer and CSS) and remove one that is not live.", {
    keywords: ["theme", "look", "switch theme", "design", "kaizena site look"],
  }),
  platform("site_themes.theme", "/site-design/[install]", "Customise theme", "Kaizena Flow site", "One theme installed on Kaizena Flow's own site that is not live: its preview on Kaizena Flow's own pages, what switching to it changes (header, footer, section styles, settings that stay its own, fonts, CSS), its settings and its own CSS. Visitors see nothing of it until the site switches.", {
    keywords: ["preview theme", "try a theme", "what changes", "customise theme", "kaizena site theme"],
  }),
  platform("seo", "/seo", "Search", "Kaizena Flow site", "How search engines and AI crawlers see Kaizena Flow's site."),
  platform("cookies", "/cookies", "Cookies", "Kaizena Flow site", "Kaizena Flow's cookies, tracking and consents."),
  platform("emails", "/emails", "Emails", "Platform", "Every email Kaizena Flow and the stores sent, and email setup."),
  platform("email", "/emails/[emailId]", "Email", "Platform", "One email."),
  platform("ai", "/ai", "AI", "Platform", "Kaizena Flow's default AI provider and models, and the search eval.", { keywords: ["model", "provider"] }),
  platform("capacity", "/capacity", "Usage and limits", "Platform", "What every store used this month against its limits (storage, products, staff, domains, visits, emails and AI), the database at a glance, and a CSV.", {
    keywords: ["usage", "limits", "quota", "storage", "bandwidth", "traffic", "capacity", "load", "database"],
    tasks: ["See every store's usage this month", "Find the stores closest to their limits", "Download the month as CSV"],
  }),
  platform("ai.usage", "/ai/usage", "AI usage", "Platform", "What every store, store owner account and Kaizena Flow itself used of the AI, per provider and model.", {
    keywords: ["tokens", "cost", "spend", "requests", "usage", "consumption", "provider", "model"],
    tasks: ["See total usage per provider and model", "See usage per store owner account and per store", "Choose the period"],
  }),
  platform("languages", "/languages", "Languages", "Platform", "The languages stores can offer, chosen from the world's, and where each one's interface text stands.", {
    keywords: ["translate", "locale", "multilingual", "add a language", "world languages"],
    tasks: ["Add a language", "Switch a language off"],
  }),
  platform("language", "/languages/[lang]", "Translate a language", "Platform", "One language's interface text: translate it with AI, read it, edit it and mark it reviewed.", {
    keywords: ["interface text", "review", "translation"],
  }),
  platform("domains", "/domains", "Domains", "Platform", "Domains stores buy through Kaizena Flow (D315): the margin, floor and rounding of prices per currency, opening buying for a store, every registration with its expiry, and purchases that failed or wait.", {
    keywords: ["domain", "registrar", "dns", "buy domain", "domain prices", "renewal"],
  }),
  platform("ai.prices", "/ai/prices", "AI prices", "Platform", "What each AI model costs per million tokens in US dollars: set a price, see earlier ones, and the models used without a price. The usage pages show cost from these.", {
    keywords: ["cost", "price", "dollars", "model"],
  }),
  platform("chat", "/chat", "Chat assistant", "Support", "Kaizena Flow's public site chat assistant and its knowledge base."),
  platform("google-reviews", "/google-reviews", "Google reviews", "Kaizena Flow site", "Kaizena Flow's own Google reviews for testimonials."),
  platform("experiments", "/experiments", "A/B tests", "Platform", "Every store's A/B tests, read-only: what is running, which need a look (a version lowering orders, visitors nobody sees, a test past its end or forgotten) and what waits for a decision.", {
    keywords: ["experiment", "a/b", "test", "split", "guardrail"],
  }),
  platform("retention", "/retention", "Data retention", "Platform", "How long each kind of personal data is kept (bookkeeping periods per country, and the policy periods for emails, carts, sign-in codes and more): each period's source and how much of it was read, whether a person has reviewed it, a form that starts a new period (never an edit in place), how many tables the register of personal data holds, and the daily job's last results.", {
    keywords: ["gdpr", "retention", "keep data", "how long", "bookkeeping", "regnskap", "storage limitation", "anonymise", "register of personal data", "accountant review"],
    tasks: ["Mark a retention period as reviewed", "Change how long a kind of data is kept", "See what the daily job removed", "See which periods nobody has reviewed"],
  }),
  platform("vat", "/vat", "VAT", "Platform", "VAT for every store: the categories owners choose from, each country's rate per category with its history, source and verification, the rates nobody has verified yet, the coverage by country and how shipping is taxed.", {
    keywords: ["tax", "rates", "reduced rate", "mva", "moms", "category", "shipping vat", "verify", "oss", "ioss"],
    tasks: ["Set a country's rate for a category", "Mark a rate verified", "Add a VAT category", "Set how shipping is taxed in a country"],
  }),
  platform("vat.country", "/vat/[country]", "VAT by country", "Platform", "One country's VAT: the rate of every category with its full history, the way shipping is taxed there and a form to set a rate."),
  platform("search-test", "/search-test", "Search test", "Platform", "The search experiment: keyword against hybrid search.", { keywords: ["experiment", "a/b"] }),
  platform("activity", "/activity", "Activity log", "Platform", "What platform admins and the platform did, not tied to one store: two-step sign-in events, recovery codes used, resets, approvals. Filter by person and period.", {
    keywords: ["audit", "audit log", "history", "who did", "two-step", "security events"],
  }),
  platform("assistant", "/assistant", "AI manager", "Platform", "The platform's AI manager: conversations and what it has learned about you.", {
    keywords: ["assistant", "ai", "memory"],
  }),
];

/**
 * The pages with the store's navigation sections as their groups (D147): where a page sits is the section its address is in
 * (`src/lib/store-nav.ts`), so the AI manager's guidance follows the tabs people see.
 */
export const ADMIN_PAGES: readonly AdminPage[] = PAGES.map((page) => (page.area === "store" ? { ...page, group: sectionOf(page.path)?.label ?? "Home" } : page));

export const ADMIN_PAGES_BY_ID: Record<string, AdminPage> = Object.fromEntries(ADMIN_PAGES.map((page) => [`${page.area}:${page.id}`, page]));

/** The `[param]` names a page's address takes. */
export function pageParams(page: Pick<AdminPage, "path">): string[] {
  return [...page.path.matchAll(/\[([A-Za-z]+)\]/g)].map((m) => m[1]);
}

/** Where an area's pages start. */
export function areaBase(area: AdminArea, storeSlug?: string): string {
  return area === "store" ? `/admin/${storeSlug ?? ""}` : area === "platform" ? "/admin/platform" : "/admin";
}

/** A page's address, or null when a param is missing or not a plain value. */
export function pageHref(page: AdminPage, params: Record<string, string>, storeSlug?: string): string | null {
  let path = page.path;
  for (const name of pageParams(page)) {
    // A store's own Work screens are at `/account/work/s/[store]`: the store in hand names it.
    const value = params[name] ?? (name === "store" ? storeSlug : undefined);
    if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) return null;
    path = path.replace(`[${name}]`, value);
  }
  if (page.area === "store" && !storeSlug) return null;
  return `${areaBase(page.area, storeSlug)}${path}`;
}

export type SiteFlags = {
  /** The store's features that are on (D178, `effectiveFeatures()`); a page behind a feature is offered only while it is. */
  features?: readonly FeatureId[];
  work?: boolean;
  owner?: boolean;
  /** Whether the person can open the page (wave 1, 1f: their role's keys); where it is not given every page is open to them. Built from `canOpenPath()` in `permissions.ts`. */
  canOpen?: (page: AdminPage) => boolean;
};

/** Whether a page is offered to this person in this store. */
export function pageOffered(page: AdminPage, flags: SiteFlags): boolean {
  if (flags.canOpen && !flags.canOpen(page)) return false;
  if (page.feature !== undefined && !requirementMet(flags.features ?? [], page.feature)) return false;
  if (page.needs === "work") return Boolean(flags.work);
  if (page.needs === "owner") return Boolean(flags.owner);
  return true;
}

/** The pages of the areas one works in: a store's with account pages, or the platform's. */
export function pagesFor(area: "store" | "platform", flags: SiteFlags = {}): AdminPage[] {
  return ADMIN_PAGES.filter((page) => (page.area === area || page.area === "account") && pageOffered(page, flags));
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** The pages that best match what someone asks about, best first. */
export function findPages(area: "store" | "platform", query: string, flags: SiteFlags = {}, limit = 5): AdminPage[] {
  const asked = words(query);
  if (asked.length === 0) return [];
  const scored = pagesFor(area, flags).map((page) => {
    const title = words(page.title);
    const keywords = (page.keywords ?? []).flatMap(words);
    // Its Norwegian title and words too (D312 A2), so a person asking in Norwegian finds it; only words of four letters or more, so a short
    // English word ("for", "som") does not match a Norwegian one.
    const nb = PAGES_NB[`${page.area}:${page.id}`];
    const nbTitle = words(nb?.title ?? "").filter((w) => w.length >= 4);
    const nbKeywords = (nb?.keywords ?? []).flatMap(words).filter((w) => w.length >= 4);
    const body = words(`${page.what} ${(page.tasks ?? []).join(" ")} ${page.group}`);
    let score = 0;
    for (const word of asked) {
      const stem = word.slice(0, Math.max(4, word.length - 2));
      const hit = (list: string[]) => list.some((w) => w === word || (stem.length >= 4 && w.startsWith(stem)));
      if (hit(title) || (word.length >= 4 && hit(nbTitle))) score += 5;
      if (hit(keywords) || (word.length >= 4 && hit(nbKeywords))) score += 4;
      if (hit(body)) score += 1;
    }
    // Pages without params are where people start.
    if (score > 0 && pageParams(page).length === 0) score += 0.5;
    return { page, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.page);
}

/** Which page an address is, with its params: for telling the AI where the person is. */
export function matchPath(pathname: string): { page: AdminPage; params: Record<string, string>; storeSlug: string | null } | null {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/admin";
  const segments = clean.split("/").filter(Boolean);
  if (segments[0] !== "admin") return null;
  const candidates: { area: AdminArea; rest: string[]; storeSlug: string | null }[] = [];
  if (segments[1] === "platform") candidates.push({ area: "platform", rest: segments.slice(2), storeSlug: null });
  else if (segments.length === 1 || segments[1] === "stores" || segments[1] === "account") {
    candidates.push({ area: "account", rest: segments.slice(1), storeSlug: null });
  } else candidates.push({ area: "store", rest: segments.slice(2), storeSlug: segments[1] });
  for (const { area, rest, storeSlug } of candidates) {
    // Fixed segments beat params: try pages with fewer params first.
    const pages = ADMIN_PAGES.filter((page) => page.area === area).sort((a, b) => pageParams(a).length - pageParams(b).length);
    for (const page of pages) {
      const pattern = page.path.split("/").filter(Boolean);
      if (pattern.length !== rest.length) continue;
      const params: Record<string, string> = {};
      const ok = pattern.every((part, i) => {
        const param = /^\[([A-Za-z]+)\]$/.exec(part);
        if (param) {
          params[param[1]] = decodeURIComponent(rest[i]);
          return true;
        }
        return part === rest[i];
      });
      // A store's Work is at the owner's level (D123), but it is that store's: name it.
      if (ok) return { page, params, storeSlug: storeSlug ?? params.store ?? null };
    }
  }
  return null;
}

/** The map as the AI reads it: every page without params, one line each, by group. */
export function adminMapText(area: "store" | "platform", flags: SiteFlags = {}): string {
  const pages = pagesFor(area, flags).filter(
    (page) => pageParams(page).length === 0 && (page.area === area || (page.area === "account" && page.group === "Work")),
  );
  const groups = new Map<string, AdminPage[]>();
  for (const page of pages) groups.set(page.group, [...(groups.get(page.group) ?? []), page]);
  return [...groups.entries()]
    .map(([group, list]) => `${group}: ${list.map((page) => `${page.title} [${page.id}]`).join("; ")}`)
    .join("\n");
}
