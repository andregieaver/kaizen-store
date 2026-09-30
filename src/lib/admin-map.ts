/**
 * The admin, page by page (D103): what each page is for and what can be
 * done there, for the AI manager to guide owners and open the right page.
 * Every admin page is listed (a unit test walks the app's routes), so a new
 * page goes here too.
 */

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

export const ADMIN_PAGES: readonly AdminPage[] = [
  // Store: main sections --------------------------------------------------------------
  store("overview", "", "Overview", "Main", "The store's start page: the setup checklist until the store is ready, then its state at a glance.", {
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
  store("orders", "/orders", "Orders", "Main", "Every order, newest first, with filters for orders to send and unpaid checkouts.", {
    tasks: ["Find an order", "See what is waiting to be sent (?show=to-send)", "See unpaid checkouts (?show=unpaid)"],
    keywords: ["sales", "purchases", "to send", "shipping"],
  }),
  store("order", "/orders/[orderId]", "Order", "Main", "Everything about one order: lines, payment, sending with tracking, refunds, cancelling, contact, notes, history and emails.", {
    tasks: ["Mark it sent with tracking", "Refund all or part and restock", "Cancel it", "Correct the address", "Add a note", "Resend the confirmation"],
    keywords: ["refund", "tracking", "ship", "cancel order"],
  }),
  store("order.packing-slip", "/orders/[orderId]/packing-slip", "Packing slip", "Main", "A printable packing slip for one order, without prices.", {
    keywords: ["print", "slip", "pack"],
  }),
  store("subscriptions", "/subscriptions", "Subscriptions", "Main", "Shoppers' subscriptions to products bought on a schedule.", {
    keywords: ["recurring", "renewals"],
  }),
  store("subscription", "/subscriptions/[subscriptionId]", "Subscription", "Main", "One subscription: what it holds, its renewals, and pausing, skipping, changing or cancelling it.", {
    tasks: ["Pause or skip", "Change contents", "Cancel now or at period end"],
  }),
  store("products", "/products", "Products", "Main", "Every product with its status, price and stock.", {
    tasks: ["Find a product", "Add a product", "Archive products"],
    keywords: ["catalogue", "items", "inventory", "stock"],
  }),
  store("product.new", "/products/new", "New product", "Main", "Adds a product: texts per language, pictures, variants, prices per country, stock, delivery and product safety details.", {
    keywords: ["create product", "add item"],
  }),
  store("product", "/products/[productId]", "Product", "Main", "The product editor: texts, pictures, variants, prices, stock, purchase options, SEO and AI writing help.", {
    tasks: ["Change price or stock", "Edit texts and pictures", "Add purchase options (subscriptions)", "Let the AI suggest texts", "Archive or publish"],
    keywords: ["price", "stock", "variant", "edit product"],
  }),
  store("product.categories", "/products/categories", "Product categories and tags", "Main", "Categories (nested) and tags for products, used in menus, filters and layouts.", {
    keywords: ["taxonomy", "collections"],
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
  store("campaign.new", "/campaigns/new", "New campaign", "Sales", "Creates a campaign: what it gives, what it applies to, and when it runs."),
  store("campaign", "/campaigns/[campaignId]", "Campaign", "Sales", "One campaign: what it gives, what it applies to, when it runs, and switching it off or deleting it."),
  store("customers", "/customers", "Customers", "Sales", "The store's customers, with search, recent first.", { keywords: ["clients", "buyers", "people"] }),
  store("customer", "/customers/[customerId]", "Customer", "Sales", "One customer: orders, subscriptions, emails and their customer group."),
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
  store("payments", "/settings/payments", "Payments", "Sales", "Stripe: the store's accounts in test and live, going live, and invoices for orders.", {
    needs: "owner",
    keywords: ["stripe", "card", "go live", "payouts"],
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
  store("design", "/settings/design", "Design", "Store", "The store's theme: colours, fonts, buttons, cards, light and dark.", {
    keywords: ["theme", "colours", "fonts", "look"],
  }),
  store("domains", "/settings/domains", "Domains", "Store", "The store's addresses and its own domain.", { keywords: ["url", "custom domain"] }),
  store("company", "/settings/company", "Company", "Store", "The legal business, contact details, office hours and places (shops, pickup points).", {
    keywords: ["business details", "address", "vat number"],
  }),
  store("company.place.new", "/settings/company/places/new", "New place", "Store", "Adds a shop or pickup point."),
  store("company.place", "/settings/company/places/[placeId]", "Place", "Store", "One shop or pickup point."),
  store("integrations", "/integrations", "Integrations", "Store", "Zapier, Make and Slack, and how their sends are doing.", { keywords: ["zapier", "make", "slack", "webhooks"] }),
  store("integration", "/integrations/[provider]", "Integration", "Store", "Connects one integration, chooses its events, tests it, and shows recent sends."),
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
  store("staff", "/staff", "Team", "Account", "The store's members and their roles.", { needs: "owner", keywords: ["users", "roles", "invite"] }),

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
  account("account", "/account", "Your account", "Your name, picture, password, light or dark, and Kaizen Life.", {
    keywords: ["profile", "password", "avatar", "dark mode"],
  }),

  // Platform ---------------------------------------------------------------------------------
  platform("overview", "", "Overview", "Platform", "The operator's first look: requests waiting, stores by state, plans, failed emails and AI use.", {
    keywords: ["dashboard", "home", "attention", "status"],
  }),
  platform("requests", "/requests", "Access requests", "Platform", "People asking to open a store: approving creates it and emails a sign-in link.", {
    keywords: ["sign-ups", "waiting list", "approve"],
  }),
  platform("customers", "/customers", "Customers", "Platform", "Store owners with their stores, plans and invoices."),
  platform("customer", "/customers/[accountId]", "Customer", "Platform", "One store owner: stores, plans, invoices and emails."),
  platform("stores", "/stores", "Stores", "Platform", "Every store with its plan, subscription and fee."),
  platform("store", "/stores/[store]", "Store", "Platform", "One store's plan: start, change or cancel it, its fee and discount."),
  platform("store.invoice", "/stores/[store]/invoices/[invoiceId]", "Plan invoice", "Platform", "One of a store's plan invoices."),
  platform("plans", "/plans", "Plans", "Platform", "Kaizen's plans, their prices and fees, synced to Stripe.", { keywords: ["pricing", "tiers"] }),
  platform("discounts", "/discounts", "Discounts", "Platform", "Discount codes for stores' plans."),
  platform("discount", "/discounts/[discountId]", "Discount", "Platform", "One plan discount code."),
  platform("plan-reminders", "/plan-reminders", "Plan reminders", "Platform", "Emails to owners who left a plan checkout."),
  platform("plan-reminder.new", "/plan-reminders/new", "New plan reminder", "Platform", "Adds a plan reminder step."),
  platform("plan-reminder", "/plan-reminders/[stepId]", "Plan reminder", "Platform", "One plan reminder step."),
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
  platform("chat", "/chat", "Chat agent", "Kaizen site", "Kaizen's public site chat agent and its knowledge base."),
  platform("google-reviews", "/google-reviews", "Google reviews", "Kaizen site", "Kaizen's own Google reviews for testimonials."),
  platform("search-test", "/search-test", "Search test", "Platform", "The search experiment: keyword against hybrid search.", { keywords: ["experiment", "a/b"] }),
  platform("assistant", "/assistant", "AI manager", "Platform", "The platform's AI manager: conversations and what it has learned about you.", {
    keywords: ["assistant", "ai", "memory"],
  }),
];

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

export type SiteFlags = { bookings?: boolean; deliveries?: boolean; work?: boolean; owner?: boolean };

/** Whether a page is offered to this person in this store. */
export function pageOffered(page: AdminPage, flags: SiteFlags): boolean {
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
