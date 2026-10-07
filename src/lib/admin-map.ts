/**
 * The admin, page by page (D103): what each page is for and what can be
 * done there, for the AI manager to guide owners and open the right page.
 * Every admin page is listed (a unit test walks the app's routes), so a new
 * page goes here too.
 */

import { sectionOf } from "./store-nav";

export type AdminArea = "store" | "platform" | "account";

/** What must be on for a page to be offered. */
export type PageNeeds = "bookings" | "deliveries" | "work" | "owner";

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
  store("setup.step", "/setup/[step]", "Setup step", "Main", "One step of the setup wizard: details, countries, payments, products or launch.", {
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
  }),
  store("order", "/orders/[orderId]", "Order", "Main", "Everything about one order: lines, payment, sending in parcels (choose the items and quantities of each parcel, with its own tracking, email and packing slip), refunds, cancelling, changing its items after purchase (or why it cannot be changed, and a change waiting for the customer's payment), contact, notes, history and emails.", {
    tasks: ["Mark it sent with tracking", "Send part of it now and the rest later", "Email a parcel's tracking again", "Refund all or part and restock", "Cancel it", "Change its items", "Send a change's pay link again, or cancel the change", "Correct the address", "Add a note", "Resend the confirmation"],
    keywords: ["refund", "tracking", "ship", "cancel order", "partial fulfilment", "partly sent", "split shipment", "parcel", "edit order", "change order"],
  }),
  store("order.edit", "/orders/[orderId]/edit", "Edit order", "Main", "Changes a paid order that is not sent yet: lower a quantity, take an item off, add products (at the market's price or one you type) and change the shipping, with the reason. Items kept keep their price and discounts. The summary is worked out by the checkout's own rules: a lower total is refunded at once, a higher one is paid by the customer through a pay link (or recorded as paid outside Kaizen) before the order changes. The order keeps its number; an invoiced order gets a credit note and an additional invoice.", {
    tasks: ["Take an item off an order", "Lower a quantity", "Add a product to a paid order", "Change the shipping price", "Send the customer a pay link for a higher total", "Record a change as paid outside Kaizen"],
    keywords: ["edit order", "change order", "modify order", "add item", "remove item", "order edit", "endre ordre", "swap item"],
  }),
  store("orders.export", "/orders/export", "Export orders", "Main", "Downloads orders as a CSV file for your bookkeeping: one row for each order line (or each order), with the VAT of each line and of the shipping, discounts, refunds, payment, the amounts in the order's currency and the store's, and copied history and hosts' orders marked. The owner's only, because it can hold personal data; the file is made without contact details unless you choose them, and is never emailed.", {
    needs: "owner",
    tasks: ["Export the orders of a period", "Export some orders by their numbers", "Include the buyer's email and address", "Download a finished export"],
    keywords: ["export orders", "csv", "orders spreadsheet", "accountant", "bookkeeping", "download orders", "excel", "eksporter ordre"],
  }),
  store("order.packing-slip", "/orders/[orderId]/packing-slip", "Packing slip", "Main", "A printable packing slip for one order, without prices: what is still to send (all of it, marked already sent, when nothing is left), or one parcel's items (?shipment=) with a line when more follows; for a gift order it also prints the buyer's gift message.", {
    keywords: ["print", "slip", "pack", "gift receipt", "gift slip"],
  }),
  store("orders.packing-slips", "/orders/packing-slips", "Packing slips", "Main", "Packing slips for several orders in one document, each order on its own page and in its own language, without prices, each with what is still to send (a partly sent order its remainder). Orders already sent, withdrawn, with nothing to ship and copied history are left out, with the reason.", {
    keywords: ["print packing slips", "bulk print", "print many", "pick", "gift slip"],
    tasks: ["Print the slips of the orders you ticked"],
  }),
  store("orders.pick-list", "/orders/pick-list", "Pick list", "Main", "What to take off the shelves for the ticked orders (at most 100): the units still to send summed by product, variant and SKU with the number of orders, or listed order by order. Downloads, services, units already sent and units withdrawn before sending are left out, and orders that cannot be picked are listed with the reason. No prices, names or addresses.", {
    tasks: ["Print a pick list of the ticked orders", "Pick by product or by order", "Sort by SKU, title or quantity"],
    keywords: ["pick list", "picking list", "picklist", "warehouse", "pick", "plukkliste"],
  }),
  store("orders.drafts", "/orders/drafts", "Draft orders", "Main", "Draft orders: orders you make for a customer, newest first, with what each is worth and where it stands (open, sent, paid, expired). A draft holds no stock until it is sent as a pay link.", {
    tasks: ["Make a draft order", "See drafts waiting for payment (?status=sent)", "Open a draft"],
    keywords: ["draft", "quote", "manual order", "phone order", "payment link", "pay link", "invoice a customer", "create order", "utkast"],
  }),
  store("orders.draft.new", "/orders/drafts/new", "New draft order", "Main", "Starts a draft order in a market (the country, language and currency it is priced in).", {
    keywords: ["new draft", "create order", "manual order"],
  }),
  store("orders.draft", "/orders/drafts/[draftId]", "Draft order", "Main", "One draft order: the customer, lines (products and custom items, with a custom price), a discount the buyer sees, shipping, notes and tags, and the summary with VAT worked out by the checkout's own rules. Send it to the customer as a pay link or make a link to share, reopen a sent draft, or record that it was paid outside Kaizen (bank transfer, cash).", {
    tasks: ["Add products and custom items", "Give a discount or a custom price", "Send the pay link", "Make a link to share", "Reopen a sent draft", "Record a payment taken outside Kaizen"],
    keywords: ["pay link", "payment link", "send invoice", "mark as paid", "paid outside", "bank transfer", "cash", "custom item", "custom price", "staff discount"],
  }),
  store("order.terms", "/orders/[orderId]/terms/[role]", "Terms as shown", "Main", "One of the texts an order was placed under (the terms or the privacy statement), as the shopper was shown it: the kept copy, its version and when it was accepted.", {
    keywords: ["terms accepted", "terms snapshot", "privacy statement", "what the customer agreed to"],
  }),
  store("returns", "/returns", "Returns", "Main", "Customers' withdrawals from a purchase (the legal right to change their mind) and return requests inside the store's own window: a queue with what is overdue, to approve, to receive and to refund.", {
    tasks: ["See what is past its refund deadline (?overdue=1)", "See return requests to answer (?status=requested)", "Search by return, order, name or email (?q=)", "Open a return and work it to a refund"],
    keywords: ["return", "withdrawal", "withdraw", "right of withdrawal", "angrerett", "refund deadline", "send back", "14 days", "return request", "RMA"],
  }),
  store("return", "/returns/[returnId]", "Return", "Main", "One withdrawal or return: the customer's statement and its acknowledgement, the lines, approving or declining, instructions, receiving, inspecting for diminished value, the refund with its working, and closing.", {
    tasks: ["Approve or decline a return request", "Set return instructions and address", "Mark the goods in transit or received", "Inspect the goods and set a deduction", "Refund with the working shown", "Send the acknowledgement again", "Close or cancel"],
    keywords: ["refund", "inspect", "restock", "acknowledgement", "withdrawal statement", "deduction", "diminished value"],
  }),
  store("invoices", "/invoices", "Invoices", "Main", "The store's invoices and credit notes (one for every paid order and every refund that succeeds, numbered in the store's own series): search by number, order or email, view, print or download the PDF, the orders still waiting for an invoice and why, and a CSV for the accountant.", {
    tasks: ["Find an invoice or credit note (?q=)", "See what is waiting for an invoice (?tab=waiting)", "Check again after fixing the business details", "Download a CSV for the accountant", "Open or download an invoice's PDF"],
    keywords: ["invoice", "faktura", "credit note", "kreditnota", "kreditfaktura", "receipt", "pdf", "accountant", "bookkeeper", "vat invoice", "invoice number", "waiting for an invoice"],
  }),
  store("subscriptions", "/subscriptions", "Subscriptions", "Main", "Shoppers' subscriptions to products bought on a schedule.", {
    keywords: ["recurring", "renewals"],
  }),
  store("subscription", "/subscriptions/[subscriptionId]", "Subscription", "Main", "One subscription: what it holds, its renewals, and pausing, skipping, changing or cancelling it.", {
    tasks: ["Pause or skip", "Change contents", "Cancel now or at period end"],
  }),
  store("products", "/products", "Products", "Main", "Every product with its status, price and stock, and the products that still need their content for the price per kg or litre (unit price).", {
    tasks: ["Find a product", "Add a product", "Archive products", "Find products that need content for the unit price"],
    keywords: ["catalogue", "items", "inventory", "stock", "unit price", "price per kg", "price per litre", "enhetspris"],
  }),
  store("product.new", "/products/new", "New product", "Main", "Adds a product: texts per language, pictures, variants, prices per country, stock, delivery and product safety details.", {
    keywords: ["create product", "add item"],
  }),
  store("product", "/products/[productId]", "Product", "Main", "The product editor: texts, pictures, variants, prices, content per variant (unit price), stock, purchase options, SEO and AI writing help.", {
    tasks: ["Change price or stock", "Edit texts and pictures", "Add purchase options (subscriptions)", "Let the AI suggest texts", "Archive or publish", "Give a variant its content (g, kg, ml, l, m) for the price per kg or litre"],
    keywords: ["price", "stock", "variant", "edit product", "unit price", "price per kg", "price per litre", "content", "sold by measure", "enhetspris"],
  }),
  store("product.categories", "/products/categories", "Product categories and tags", "Main", "Categories (nested) and tags for products, used in menus, filters and layouts; a category can require a price per kg or litre (unit price) of its products.", {
    keywords: ["taxonomy", "collections", "unit price", "price per kg", "requires unit price"],
  }),
  store("products.export", "/products/export", "Export products", "Main", "Downloads the store's products as a CSV file: one row for each variant, with texts in every language, options, prices for each country, stock, cost, product safety details, categories, tags and pictures. A small store gets the file at once, a large one a job with a Download button. The file reads back into Kaizen as it is.", {
    tasks: ["Export all products, a status, or a category or tag", "Choose the Excel (Nordic) or the standard file format", "Download a finished export", "See what the file does not carry"],
    keywords: ["export products", "csv", "download products", "spreadsheet", "excel", "backup", "product file", "eksporter produkter"],
  }),
  store("products.import", "/products/import", "Import products", "Main", "Brings products in from a CSV file: Kaizen's own file or a Shopify product file. Upload the file, choose what the import does, check it (a dry run that lists every row's problem and changes nothing), then import. Never deletes a product or changes an address. Needs the right to change products.", {
    tasks: ["Upload a product file", "Import a Shopify product file", "Continue an open import", "See the recent imports"],
    keywords: ["import products", "csv", "upload products", "shopify", "migrate", "bulk add", "product file", "importer produkter"],
  }),
  store("products.import.job", "/products/import/[jobId]", "Product import", "Main", "One product import: its options, the check's findings row by row, the counts, the confirmation, progress while it works and the result. Download the problems as a CSV, cancel an import that is running.", {
    tasks: ["Choose the options and check the file", "Read each row's problems", "Import after the check", "Cancel the import", "Download the problems as CSV"],
    keywords: ["dry run", "check the file", "import problems", "import result", "cancel import"],
  }),
  store("products.bulk", "/products/bulk", "Edit products in a grid", "Main", "Edits the variants of the products chosen in the list as a table: price for each market, SKU, stock and cost. Review every change before it is written, apply it, and undo it for seven days. Without chosen products it shows the recent bulk changes, where an undo can be made. Tick products in the list for the other bulk actions: set status, archive, categories and tags, price (a percentage or an amount) and stock.", {
    tasks: ["Change prices for many products by a percentage or an amount", "Edit prices, SKUs, stock and cost in a grid", "Archive or publish many products", "Add many products to a category or tag", "Set stock for many products", "Undo a bulk change"],
    keywords: ["bulk edit", "bulk editing", "mass edit", "change many products", "price change", "percentage", "sale", "undo", "spreadsheet", "grid", "rediger flere produkter"],
  }),
  store("inventory", "/inventory", "Inventory", "Main", "Stock for each variant and stock location: on hand, held by checkouts in progress, available and owed on backorder, with counts of what is low, sold out or owed. Change a level with a reason (received, correction, count, damaged, theft or loss, promotion), review every change before it is saved, and set a variant to keep selling at zero stock or to warn at a low level. Needs the right to change products to adjust.", {
    tasks: ["See what is low, sold out, owed or below zero", "Adjust stock with a reason", "Count stock and set it to the counted figure", "Keep selling a variant when it is sold out (backorder) with a delivery time", "Set a low-stock level", "Find a variant by SKU, title or location"],
    keywords: ["inventory", "stock", "stock levels", "on hand", "committed", "available", "backorder", "sell when out of stock", "oversell", "low stock", "count", "recount", "adjust stock", "received", "damaged", "lager", "lagerbeholdning", "restordre"],
  }),
  store("inventory.history", "/inventory/history", "Stock history", "Main", "Every change of a stock level, newest first: when, which variant and location, the change and the new figure, the reason and who or what made it (a staff member, an order, a return, a file, the AI manager). Filter by SKU, location, reason and dates. Kept 24 months; a wrong change is corrected by a new one.", {
    tasks: ["See why a stock figure changed", "Find the order or return behind a change", "Filter the history by SKU, location, reason or dates"],
    keywords: ["stock history", "inventory history", "movements", "adjustment history", "audit", "who changed the stock", "lagerhistorikk"],
  }),
  store("inventory.locations", "/inventory/locations", "Stock locations", "Main", "The places stock is held: add, rename and rank locations (an order's units are taken from the top location first), and, for owners, deactivate a location after seeing how many units stop being for sale, or reactivate it. A store always keeps one active location; a location is never deleted.", {
    tasks: ["Add or rename a stock location", "Change the order locations are used in", "Deactivate or reactivate a location (owner)", "See the units held at each location"],
    keywords: ["locations", "warehouse", "stock locations", "routing", "order routing", "deactivate location", "multi location", "lager", "lokasjon"],
  }),
  store("inventory.import", "/inventory/import", "Import stock", "Main", "Sets stock from a counted CSV file: SKU, location and on hand, with an optional on-hand-was column so a row that is out of date becomes a conflict instead of undoing a sale. Upload the file, check it (a dry run that lists every row and changes nothing), then import. Never creates a variant or a location. Needs the right to change products.", {
    tasks: ["Upload a counted stock file", "Check a file before it is imported", "Import after the check", "Continue an open import"],
    keywords: ["import stock", "stock count", "csv", "inventory upload", "recount", "bulk stock", "importer lager"],
  }),
  store("inventory.import.job", "/inventory/import/[jobId]", "Stock import", "Main", "One stock import: the check's result row by row (the change for each SKU and location, conflicts and problems), the counts, the confirmation, progress while it works and the result. Download the problems as a CSV, cancel an import that is running.", {
    tasks: ["Read what the check found", "Import after the check", "Cancel the import", "Download the problems as CSV"],
    keywords: ["dry run", "conflict", "stock import result", "cancel import"],
  }),
  store("inventory.export", "/inventory/export", "Export stock", "Main", "Downloads stock as a CSV file: one row for each variant at each active location with on hand, committed, available, the policy at zero stock and the low-stock level. A small store gets the file at once, a large one a job with a Download button. Count from it and import it back.", {
    tasks: ["Download the stock file", "Choose the Excel (Nordic) or the standard file format", "Download a finished export"],
    keywords: ["export stock", "stock file", "inventory csv", "download inventory", "stock count sheet", "eksporter lager"],
  }),
  store("product-layouts", "/product-layouts", "Product layouts", "Main", "Layouts for product pages, built in the page builder with product parts.", {
    keywords: ["product page design", "template"],
  }),
  store("product-layout.new", "/product-layouts/new", "New product layout", "Main", "Starts a new product page layout."),
  store("product-layout", "/product-layouts/[pageId]", "Product layout", "Main", "Builds a product layout in the page builder."),
  store("product-layout.preview", "/product-layouts/[pageId]/preview", "Product layout preview", "Main", "Previews a product layout with a real product."),
  store("product-layout.assign", "/product-layouts/[pageId]/assign", "Where a layout is used", "Main", "Chooses where a layout applies: the store's default, categories, tags or single products."),
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
  }),
  store("discount.new", "/discounts/new", "New coupon", "Main", "Creates a discount code."),
  store("discount", "/discounts/[discountId]", "Coupon", "Main", "One discount code: its rules, uses, and switching it off."),
  store("wishlists", "/wishlists", "Wishlists", "Main", "Shoppers' wishlists, the most wished products and how wishes turn into sales.", {
    keywords: ["favourites", "saved"],
  }),
  store("wishlist", "/wishlists/[wishlistId]", "Wishlist", "Main", "One shopper's wishlist."),
  store("wishlists.activity", "/wishlists/activity", "Wishlist activity", "Main", "Wishlist items put in carts and bought."),
  store("emails", "/emails", "Emails", "Main", "Every email the store sent to shoppers, and whether it went out.", { keywords: ["sent emails", "email log"] }),
  store("email", "/emails/[emailId]", "Email", "Main", "One email as the shopper got it."),

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
    needs: "bookings",
    keywords: ["appointments", "calendar", "schedule"],
  }),
  store("bookings.staff", "/bookings/staff", "Staff and hours", "Bookings", "The people shoppers book, with their opening hours.", { needs: "bookings" }),
  store("bookings.staff.new", "/bookings/staff/new", "New staff member", "Bookings", "Adds a person who can be booked.", { needs: "bookings" }),
  store("bookings.staff.one", "/bookings/staff/[staffId]", "Staff member", "Bookings", "One bookable person: hours, services and blocks.", { needs: "bookings" }),
  store("bookings.stays", "/bookings/stays", "Stays and rentals", "Bookings", "Two weeks of rooms and items booked, and cancelling stays or rentals.", {
    needs: "bookings",
    keywords: ["rooms", "rentals", "occupancy"],
  }),
  store("bookings.units", "/bookings/units", "Rooms and items", "Bookings", "Rooms, homes and items for stays and rentals, with their calendars.", { needs: "bookings" }),
  store("bookings.units.new", "/bookings/units/new", "New room or item", "Bookings", "Adds a room, home or item.", { needs: "bookings" }),
  store("bookings.unit", "/bookings/units/[unitId]", "Room or item", "Bookings", "One room or item: capacity, blocks, calendar sync.", { needs: "bookings" }),
  store("hosts", "/hosts", "Hosts", "Bookings", "Outside hosts whose stays and rentals the store lists, with their commission.", { needs: "bookings" }),
  store("host", "/hosts/[hostId]", "Host", "Bookings", "One host: listings, payouts and commission.", { needs: "bookings" }),
  store("hosts.dac7", "/hosts/dac7", "DAC7 report", "Bookings", "The yearly DAC7 tax report on hosts' income.", { needs: "bookings", keywords: ["tax", "dac7"] }),

  // Store: sales ---------------------------------------------------------------------------
  store("campaigns", "/campaigns", "Campaigns", "Sales", "Offers without a code, for a time: a percentage off, buy more and pay for fewer (3 for 2), or a free product above a basket amount, for the whole store, chosen products, categories or tags.", {
    tasks: ["Start a sale", "Set up 3 for 2", "Give a free product over an amount", "Schedule a campaign", "Switch a campaign off"],
    keywords: ["sale", "offer", "promotion", "3 for 2", "bundle", "free gift", "discount", "black friday", "time-limited"],
  }),
  store("recommendations", "/recommendations", "Recommendations", "Sales", "Product recommendations: upsells, cross-sells and complements picked for each shopper from what they look at, search for, save and put in the cart, never what they already bought, shown in a product grid that recommends (on a product page, an article, the All products page or any page) and used by the chat assistant. Switch them on, let the store's AI re-rank the best candidates, set how much dearer than a product an upsell may be, cap the AI's monthly tokens, choose which products go together, are never shown together or are never recommended, and see clicks, add-to-cart rate and revenue per visitor with and without the AI.", {
    tasks: ["Turn recommendations on or off", "Cap the AI's monthly use for recommendations", "Say which products go together", "Hide a product from recommendations", "See what recommendations earn"],
    keywords: ["recommendations", "recommended", "upsell", "cross-sell", "cross sell", "complementary", "you may also like", "related products", "personalised", "personalized", "ai recommendations", "suggestions", "frequently bought together"],
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
  store("campaign.new", "/campaigns/new", "New campaign", "Sales", "Creates a campaign: what it gives, what it applies to, and when it runs."),
  store("campaign", "/campaigns/[campaignId]", "Campaign", "Sales", "One campaign: what it gives, what it applies to, when it runs, and switching it off or deleting it."),
  store("bonus", "/bonus", "Bonus credits", "Sales", "The bonus program: signed-in customers earn credits on what they pay and use them as a price reduction on a later order. Set the percentage back, the wait before credits can be used, the most of an order they can pay, the minimum and whether credits expire, and see what the store owes in credits.", {
    tasks: ["Turn the bonus program on or off", "Change how much customers earn back", "Set when credits expire", "See the credits the store owes"],
    keywords: ["bonus", "credits", "loyalty", "points", "rewards", "reward customers", "returning customers", "repeat customers", "cashback", "store credit", "earn", "redeem", "reward program"],
  }),
  store("affiliates", "/affiliates", "Referral program", "Sales", "The referral program: signed-in customers share a link, a friend's first order gets a welcome discount and the customer who shared it earns bonus credits. Set the friend's discount, the reward, how many orders earn it, a monthly limit and how long a link is remembered; needs the bonus program. See the referrers and the orders that came through links, and block a referrer with a reason.", {
    tasks: ["Turn the referral program on or off", "Change the friend's welcome discount", "Change how much a referrer earns", "Block a referrer who abuses it", "See who referred whom"],
    keywords: ["referral", "refer a friend", "affiliate", "affiliates", "tip a friend", "friend discount", "welcome discount", "invite friends", "referral link", "word of mouth", "ambassador"],
  }),
  store("customers", "/customers", "Customers", "Sales", "The store's customers, with search, recent first.", { keywords: ["clients", "buyers", "people"] }),
  store("customers.export", "/customers/export", "Export customers", "Sales", "Downloads the store's customers as a CSV file: name, email, phone, address, company, customer group, language, when they joined, their paid orders, whether their address unsubscribed from emails, and the custom fields staff entered about them. The owner's only. Kaizen does not record marketing consent yet, so the file must not be used as a mailing list.", {
    needs: "owner",
    tasks: ["Export all customers", "Download a finished export"],
    keywords: ["export customers", "csv", "customer list", "download customers", "mailing list", "excel", "eksporter kunder"],
  }),
  store("customer", "/customers/[customerId]", "Customer", "Sales", "One customer: orders, subscriptions, emails, their customer group and their bonus credits (balance, history, and adding or removing credits with a reason)."),
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
  }),
  store("customer-group", "/customer-groups/[groupId]", "Customer group", "Sales", "One discount group: its percentage, its customers and the companies using it."),
  store("b2b-companies", "/companies", "Companies", "Sales", "Companies that buy from the store: a discount group, a main account that invites employees, and the share of the discount employees get.", {
    keywords: ["b2b", "business customers", "employees", "company account", "invite", "wholesale"],
    tasks: ["Make a company with a main account", "Invite or remove a company's employees"],
  }),
  store("b2b-company", "/companies/[companyId]", "Company", "Sales", "One company: settings, its accounts, invitations, and inviting or removing employees."),
  store("deliveries", "/deliveries", "Subscription boxes", "Sales", "Delivery days, the round being packed and shoppers' subscription box lists.", {
    needs: "deliveries",
    tasks: ["Add a delivery day", "Send and charge this round's orders"],
    keywords: ["subscription box", "standing order", "weekly delivery", "grocery"],
  }),
  store("cart-reminders", "/cart-reminders", "Cart reminders", "Sales", "Emails to shoppers who left their checkout, with their steps and results.", {
    keywords: ["abandoned cart", "recovery"],
  }),
  store("cart-reminder.new", "/cart-reminders/new", "New cart reminder", "Sales", "Adds a reminder step."),
  store("cart-reminder", "/cart-reminders/[stepId]", "Cart reminder", "Sales", "One reminder step: when it goes, its words and any coupon."),
  store("shipping", "/settings/shipping", "Shipping", "Sales", "One shipping price per country, optionally free above a basket value.", { keywords: ["delivery price", "freight"] }),
  store("returns.settings", "/settings/returns", "Returns settings", "Sales", "The store's rules for returns: the return window (never under the legal 14 days), the transit allowance, who pays return shipping, when refunds are made, goods the law excludes, companies, the return address and the instructions customers get (with translations).", {
    needs: "owner",
    keywords: ["return window", "withdrawal", "return policy", "return address", "who pays return shipping", "refund when", "instructions", "angrerett"],
    tasks: ["Set the return window", "Choose who pays for return shipping", "Write the return instructions", "Translate the return instructions"],
  }),
  store("orders.settings", "/settings/orders", "Orders settings", "Sales", "How the store handles orders: whether shoppers may mark an order as a gift with a message, automatic archiving of finished orders after a number of days (off by default), how many days a draft order's pay link is valid, and whether staff other than the owner may record a payment taken outside Kaizen.", {
    keywords: ["gift message", "gift", "auto archive", "archive orders", "pay link valid", "draft order link", "payment outside", "cash", "bank transfer", "staff may mark paid"],
    tasks: ["Turn gift messages on or off", "Archive finished orders automatically", "Set how long a draft's pay link is valid", "Let staff record payments taken outside Kaizen"],
  }),
  store("tax", "/settings/tax", "Tax settings", "Sales", "How the store charges VAT: its VAT registration and number (checked in VIES, or the Norwegian register), where goods are sent from, its OSS and IOSS registrations, and what is on or missing for reverse charge and IOSS.", {
    needs: "owner",
    keywords: ["vat", "mva", "moms", "vat number", "reverse charge", "oss", "ioss", "one stop shop", "vies", "tax", "registration"],
    tasks: ["Save the store's VAT number", "Check the VAT number", "Record an OSS or IOSS registration", "See what is missing for reverse charge"],
  }),
  store("invoices.settings", "/settings/invoices", "Invoicing settings", "Sales", "Invoicing for orders: the switch, what is missing before it can be switched on (business details, tax profile), the prefix and first number of the invoice and credit note series until the first is issued, the note printed on every document, and whether the confirmation email carries the invoice.", {
    needs: "owner",
    keywords: ["invoice", "faktura", "invoice numbers", "numbering", "series", "prefix", "credit note", "footer note", "bank details", "invoicing off", "stripe invoice"],
    tasks: ["Switch invoicing on or off", "See what is missing for invoices", "Set the invoice number prefix and first number", "Write the note printed on every invoice"],
  }),
  store("payments", "/settings/payments", "Payments", "Sales", "Stripe: the store's accounts in test and live, going live, and invoices for orders.", {
    needs: "owner",
    keywords: ["stripe", "card", "go live", "payouts"],
  }),

  // Store: analytics (D152) ------------------------------------------------------------------
  store("analytics", "/analytics", "Analytics", "Analytics", "The store's cockpit: revenue, profit, orders, conversion, basket size, customers and refunds against the previous period and last year, the funnel, best sellers, channels, target progress and what needs doing today.", {
    keywords: ["dashboard", "kpi", "revenue", "sales", "profit", "conversion", "statistics", "report", "performance"],
    tasks: ["See how the store is doing", "Find out why sales changed", "See what needs doing today"],
  }),
  store("analytics.finance", "/analytics/finance", "Finance", "Analytics", "From gross sales to net revenue, contribution profit and estimated operating profit: discounts, refunds, VAT, cost of goods, payment and platform fees, shipping and marketing.", {
    keywords: ["profit", "margin", "cogs", "fees", "vat", "net sales", "contribution"],
  }),
  store("analytics.tax", "/analytics/tax", "VAT, OSS and IOSS reports", "Analytics", "VAT by delivery country, rate and basis made from your invoices and credit notes, the quarterly OSS and monthly IOSS return data in euro at the ECB rate, how they reconcile with Finance and your orders, and CSV files for your accountant. Your own figures, never a tax return.", {
    keywords: ["vat", "moms", "mva", "oss", "ioss", "one stop shop", "return", "rate", "country", "accountant", "reconciliation", "tax report", "ecb", "euro"],
  }),
  store("analytics.customers", "/analytics/customers", "Customer analytics", "Analytics", "New against returning customers, repeat purchase rate, purchase frequency, lifetime value, customer segments (RFM) and cohort retention.", {
    keywords: ["ltv", "retention", "cohort", "rfm", "repeat", "loyal", "churn"],
  }),
  store("analytics.products", "/analytics/products", "Product analytics", "Analytics", "Revenue, units, margin, refund rate and share of revenue and profit for each product.", {
    keywords: ["best sellers", "top products", "margin", "pareto"],
  }),
  store("analytics.inventory", "/analytics/inventory", "Inventory analytics", "Analytics", "Stock on hand and its value, sales velocity, days of stock left, products about to run out and dead stock.", {
    keywords: ["stock", "stockout", "velocity", "turnover", "dead stock", "reorder"],
  }),
  store("analytics.marketing", "/analytics/marketing", "Marketing analytics", "Analytics", "Channels with sessions, orders, revenue, conversion, cost to win a customer and return on ad spend; ad spend entry; discounts and coupons.", {
    keywords: ["cac", "roas", "ads", "channels", "campaign", "spend", "discounts", "coupons"],
    tasks: ["Enter this month's ad spend", "See which channel earns the most"],
  }),
  store("analytics.subscriptions", "/analytics/subscriptions", "Subscription analytics", "Analytics", "Monthly recurring revenue and how it moves, churn, failed renewals and subscribers.", {
    keywords: ["mrr", "arr", "churn", "recurring"],
  }),
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
  store("localization", "/settings/localization", "Languages and currencies", "Store", "The languages and currencies the store offers, each country's language, and the rates amounts are converted at.", {
    keywords: ["translate", "euro", "exchange rate", "multilingual", "language", "currency", "ECB"],
  }),
  store("translate", "/translate", "Translate the store", "Store", "Translate products, menus, pages and articles into another language with AI, reading and keeping each text before it is saved.", {
    keywords: ["translation", "language", "AI", "multilingual", "products", "legal"],
    tasks: ["Translate the store into English", "Find what is not translated yet"],
  }),
  store("search", "/search", "Search", "Store", "What shoppers searched for in the last 30 days, and searches that found nothing.", {
    keywords: ["site search", "queries"],
  }),
  store("chat", "/chat", "Chat agent", "Store", "The storefront chat agent that helps shoppers, and its knowledge base.", {
    keywords: ["customer chat", "chatbot", "knowledge"],
  }),
  store("seo", "/settings/seo", "SEO & Reach", "Store", "How search engines, social sharing and AI crawlers see the store, per country.", {
    keywords: ["google", "meta description", "crawlers"],
  }),
  store("menus", "/menus", "Menus", "Store", "The store's menus: links to pages, products, categories and more, nested and ordered.", {
    keywords: ["navigation", "links"],
  }),
  store("redirects", "/redirects", "Redirects", "Store", "Redirects send shoppers and search engines from an address that moved to its new one, in every country and language. Kaizen makes one itself when a product's, category's or tag's address changes; here you add, edit, delete and search your own (a path to a path on the store, permanent), and see how often each was used. Needs the right to change the website.", {
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
  store("design", "/settings/design", "Design", "Store", "The store's theme: colours, fonts, buttons, cards, light and dark; and design profiles, a whole look (theme, header, footer, product page and CSS) to apply and put back.", {
    keywords: ["theme", "colours", "fonts", "look", "design profile", "design template"],
  }),
  store("close", "/settings/close", "Close store", "Store", "Closes the store: stops sales, ends the Kaizen plan at the end of its period, releases its domains and cancels orders waiting for payment, after a fresh sign-in and the store's address typed in. Blocked while paid goods are unsent or subscriptions and weekly deliveries run. Nothing is deleted; the owner can reopen for thirty days. For a closed or suspended store the page shows its status and the reopen button.", {
    needs: "owner",
    keywords: ["close store", "delete store", "archive store", "shut down", "stop selling", "reopen store", "suspend"],
    tasks: ["Close the store", "See what stops me closing the store", "Reopen a closed store"],
  }),
  store("domains", "/settings/domains", "Domains", "Store", "The store's addresses and its own domain.", { keywords: ["url", "custom domain"] }),
  store("company", "/settings/company", "Company", "Store", "The legal business, contact details, office hours and places (shops, pickup points).", {
    keywords: ["business details", "address", "vat number"],
  }),
  store("company.place.new", "/settings/company/places/new", "New place", "Store", "Adds a shop or pickup point."),
  store("company.place", "/settings/company/places/[placeId]", "Place", "Store", "One shop or pickup point."),
  store("integrations", "/integrations", "Integrations", "Store", "Zapier, Make and Slack, and how their sends are doing; shipping carriers being prepared.", { keywords: ["zapier", "make", "slack", "webhooks", "shipping carriers"] }),
  store("integration", "/integrations/[provider]", "Integration", "Store", "Connects one integration, chooses its events, tests it, and shows recent sends."),
  store("integrations.shipping", "/integrations/shipping/[carrier]", "Shipping carrier", "Store", "Saves the store's own agreement with Posten / Bring, PostNord, Porterbuddy or Helthjem, ready for the day its connection arrives.", {
    keywords: ["posten", "bring", "postnord", "porterbuddy", "helthjem", "carrier", "freight", "labels", "tracking"],
  }),
  store("integrations.google-reviews", "/integrations/google-reviews", "Google reviews", "Store", "Shows the store's Google rating and reviews on its pages."),
  store("ai", "/settings/ai", "AI", "Store", "The store's own AI provider and models, or Kaizen's.", { keywords: ["model", "provider", "openai"] }),
  store("features", "/settings/features", "Features", "Store", "Switches on bookings and subscription boxes, and sets the store's time zone. (Work is switched on under Work, at the owner's level.)", {
    needs: "owner",
    keywords: ["modules", "bookings", "subscription boxes", "time zone"],
  }),
  store("cookies", "/settings/cookies", "Cookies and tracking", "Store", "The cookie scan, tracking tools, the consent banner and the store's own code.", {
    keywords: ["gdpr", "consent", "pixel", "analytics"],
  }),

  // Store: account ---------------------------------------------------------------------------
  store("billing", "/billing", "Billing", "Account", "The store's Kaizen plan, the fee per sale, and Kaizen's invoices.", {
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
  account("account.billing", "/account/billing", "Billing", "The plan of each store you own, what it costs, when it renews and Kaizen's fee.", {
    keywords: ["plan", "subscription", "invoice", "renews", "fee", "cost"],
  }),
  account("account.usage", "/account/usage", "AI usage", "What the AI used for the stores you own, per provider and model and per store.", {
    keywords: ["tokens", "cost", "spend", "requests", "usage", "consumption", "ai", "provider", "model"],
    tasks: ["See your total AI usage per provider and model", "See usage per store", "Choose the period"],
  }),
  account("account.referrals", "/account/referrals", "Referrals", "Your referral link and code, how many came by it, the stores that opened through it and the credit you earned on what they pay Kaizen, which comes off your own Kaizen invoices.", {
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
  account("account", "/account", "Your account", "Your name, picture, password, light or dark, and Kaizen Life.", {
    keywords: ["profile", "password", "avatar", "dark mode"],
  }),

  // Platform ---------------------------------------------------------------------------------
  platform("website", "/website", "Website", "Kaizen site", "Kaizen's own website: pages, blog, media, templates, menus, header, footer and fonts, each a card.", { keywords: ["site"] }),
  platform("settings", "/settings", "Settings", "Platform", "Kaizen's own settings: header and footer, search, SEO, cookies, Google reviews, Stripe, AI, chat agent, emails and languages, each a card.", { keywords: ["configuration"] }),
  platform("overview", "", "Home", "Platform", "The operator's first look: requests waiting, stores by state, plans, failed emails and AI use.", {
    keywords: ["dashboard", "home", "attention", "status"],
  }),
  platform("requests", "/requests", "Access requests", "Platform", "People asking to open a store: approving creates it and emails a sign-in link.", {
    keywords: ["sign-ups", "waiting list", "approve"],
  }),
  platform("customers", "/customers", "Customers", "Platform", "Store owners with their stores, plans and invoices."),
  platform("customer", "/customers/[accountId]", "Customer", "Platform", "One store owner: stores, plans, invoices and emails."),
  platform("stores", "/stores", "Stores", "Platform", "Every store with its plan, subscription and fee."),
  platform("store-templates", "/store-templates", "Store templates", "Platform", "Starting points for new stores (D175), each a store set up for one kind of business (appointments, retail, downloads, rentals and stays, subscriptions, services): make one, describe it, publish or unpublish it, order them, open its admin to set it up and preview its storefront.", {
    tasks: ["Make a new store template", "Publish a store template", "Preview a store template", "Edit a store template's products and pages"],
    keywords: ["starter", "starting point", "store template", "blueprint"],
  }),
  platform("store-template", "/store-templates/[starterId]", "Store template", "Platform", "One store template's title, summary, description, category and picture, and the design profile it recommends."),
  platform("design-profiles", "/design-profiles", "Design profiles", "Platform", "A store's look kept to use again (D176): theme, header, footer, product page layout and CSS, never content or brand. Make one from a store, update it from its store, publish or unpublish it, order them and preview it on a store template; any store applies one from its Design settings and people creating a store choose one.", {
    tasks: ["Make a design profile from a store", "Publish a design profile", "Preview a design profile", "Update a design profile from its store"],
    keywords: ["design template", "look", "theme preset", "style", "skin"],
  }),
  platform("design-profile", "/design-profiles/[presetId]", "Design profile", "Platform", "One design profile's title, summary, description and picture, with previews on each store template."),
  platform("store", "/stores/[store]", "Store", "Platform", "One store's plan: start, change or cancel it, its fee and discount; apply a design profile to it."),
  platform("store.invoice", "/stores/[store]/invoices/[invoiceId]", "Plan invoice", "Platform", "One of a store's plan invoices."),
  platform("plans", "/plans", "Plans", "Platform", "Kaizen's plans, their prices and fees, synced to Stripe.", { keywords: ["pricing", "tiers"] }),
  platform("plan-features", "/plans/features", "Plan features", "Platform", "Every feature in a table with the plans as columns, and a box to tick what each plan includes.", {
    keywords: ["compare plans", "features", "what is included", "tiers"],
  }),
  platform("discounts", "/discounts", "Discounts", "Platform", "Discount codes for stores' plans."),
  platform("discount", "/discounts/[discountId]", "Discount", "Platform", "One plan discount code."),
  platform("plan-reminders", "/plan-reminders", "Plan reminders", "Platform", "Emails to owners who left a plan checkout."),
  platform("plan-reminder.new", "/plan-reminders/new", "New plan reminder", "Platform", "Adds a plan reminder step."),
  platform("plan-reminder", "/plan-reminders/[stepId]", "Plan reminder", "Platform", "One plan reminder step."),
  platform("referrals", "/referrals", "Referrals", "Platform", "Kaizen's referral program: whether it is on, the commission, months, pending days and cookie days; the referrers with block, unblock and credit adjustments; the referred stores with void; and totals per currency.", {
    keywords: ["referral", "refer", "affiliate", "commission", "invite", "credit", "referrer"],
    tasks: ["Switch the referral program on or off and set its terms", "Block or unblock a referrer", "Void a referral", "Add or remove a referrer's credit with a reason"],
  }),
  platform("stripe", "/stripe", "Stripe", "Platform", "Kaizen's Stripe webhooks per mode, the default fee per sale and the checkout's look."),
  platform("pages", "/pages", "Pages", "Kaizen site", "Kaizen's own website pages."),
  platform("page.new", "/pages/new", "New page", "Kaizen site", "Starts a Kaizen page."),
  platform("page", "/pages/[pageId]", "Page", "Kaizen site", "Builds a Kaizen page."),
  platform("page.preview", "/pages/[pageId]/preview", "Page preview", "Kaizen site", "Previews a Kaizen page."),
  platform("page.ai", "/pages/ai", "Create a page with AI", "Kaizen site", "The AI page studio for Kaizen's site."),
  platform("page.categories", "/pages/categories", "Page categories and tags", "Kaizen site", "Categories and tags for Kaizen's pages."),
  platform("articles", "/articles", "Blog", "Kaizen site", "Kaizen's blog."),
  platform("article.new", "/articles/new", "New article", "Kaizen site", "Starts a Kaizen article."),
  platform("article", "/articles/[pageId]", "Article", "Kaizen site", "Writes a Kaizen article."),
  platform("article.preview", "/articles/[pageId]/preview", "Article preview", "Kaizen site", "Previews a Kaizen article."),
  platform("article.categories", "/articles/categories", "Blog categories and tags", "Kaizen site", "Categories and tags for Kaizen's articles."),
  platform("headers", "/headers", "Headers", "Kaizen site", "Kaizen's custom headers."),
  platform("header.new", "/headers/new", "New header", "Kaizen site", "Starts a Kaizen header."),
  platform("header", "/headers/[pageId]", "Header", "Kaizen site", "Builds a Kaizen header."),
  platform("header.preview", "/headers/[pageId]/preview", "Header preview", "Kaizen site", "Previews a Kaizen header."),
  platform("footers", "/footers", "Footers", "Kaizen site", "Kaizen's custom footers."),
  platform("footer.new", "/footers/new", "New footer", "Kaizen site", "Starts a Kaizen footer."),
  platform("footer", "/footers/[pageId]", "Footer", "Kaizen site", "Builds a Kaizen footer."),
  platform("footer.preview", "/footers/[pageId]/preview", "Footer preview", "Kaizen site", "Previews a Kaizen footer."),
  platform("media", "/media", "Media", "Kaizen site", "Kaizen's media library."),
  platform("templates", "/templates", "Templates", "Kaizen site", "The marketplace's templates, store owners' and Kaizen's own: hide one from every store's list, or show it again.", {
    keywords: ["marketplace", "saved parts", "moderation"],
  }),
  platform("menus", "/menus", "Menus", "Kaizen site", "Kaizen's menus."),
  platform("navigation", "/navigation", "Header and footer", "Kaizen site", "Kaizen's logos, icon, business details and menus."),
  platform("fonts", "/fonts", "Fonts", "Kaizen site", "Kaizen's self-hosted fonts."),
  platform("seo", "/seo", "Search", "Kaizen site", "How search engines and AI crawlers see Kaizen's site."),
  platform("cookies", "/cookies", "Cookies", "Kaizen site", "Kaizen's cookies, tracking and consents."),
  platform("emails", "/emails", "Emails", "Platform", "Every email Kaizen and the stores sent, and email setup."),
  platform("email", "/emails/[emailId]", "Email", "Platform", "One email."),
  platform("ai", "/ai", "AI", "Platform", "Kaizen's default AI provider and models, and the search eval.", { keywords: ["model", "provider"] }),
  platform("ai.usage", "/ai/usage", "AI usage", "Platform", "What every store, store owner account and Kaizen itself used of the AI, per provider and model.", {
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
  platform("ai.prices", "/ai/prices", "AI prices", "Platform", "What each AI model costs per million tokens in US dollars: set a price, see earlier ones, and the models used without a price. The usage pages show cost from these.", {
    keywords: ["cost", "price", "dollars", "model"],
  }),
  platform("chat", "/chat", "Chat agent", "Kaizen site", "Kaizen's public site chat agent and its knowledge base."),
  platform("google-reviews", "/google-reviews", "Google reviews", "Kaizen site", "Kaizen's own Google reviews for testimonials."),
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
  bookings?: boolean;
  deliveries?: boolean;
  work?: boolean;
  owner?: boolean;
  /** Whether the person can open the page (wave 1, 1f: their role's keys); where it is not given every page is open to them. Built from `canOpenPath()` in `permissions.ts`. */
  canOpen?: (page: AdminPage) => boolean;
};

/** Whether a page is offered to this person in this store. */
export function pageOffered(page: AdminPage, flags: SiteFlags): boolean {
  if (flags.canOpen && !flags.canOpen(page)) return false;
  if (page.needs === "bookings") return Boolean(flags.bookings);
  if (page.needs === "deliveries") return Boolean(flags.deliveries);
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
    const body = words(`${page.what} ${(page.tasks ?? []).join(" ")} ${page.group}`);
    let score = 0;
    for (const word of asked) {
      const stem = word.slice(0, Math.max(4, word.length - 2));
      const hit = (list: string[]) => list.some((w) => w === word || (stem.length >= 4 && w.startsWith(stem)));
      if (hit(title)) score += 5;
      if (hit(keywords)) score += 4;
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
