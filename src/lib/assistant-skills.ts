/**
 * The AI manager's skills (D103): playbooks for jobs owners and platform
 * admins come back to, as Kaizen Life's assistant has its working playbooks.
 * The prompt lists each skill's name and when to use it; `use_skill` loads
 * its steps into the conversation only when needed, so the prompt stays
 * short. Steps name the tools to use and the admin pages (by their map id,
 * `src/lib/admin-map.ts`) to open.
 */

export type SkillArea = "store" | "platform";

export type AssistantSkill = {
  id: string;
  area: SkillArea;
  title: string;
  /** When to use it, in a line the model reads in every prompt. */
  when: string;
  /** The playbook, loaded by `use_skill`. */
  steps: string[];
};

export const ASSISTANT_SKILLS: readonly AssistantSkill[] = [
  {
    id: "launch-store",
    area: "store",
    title: "Get the store ready to open",
    when: "The owner is new, asks what to do first, or the store is not open yet.",
    steps: [
      "Call setup_progress and say in one line how far along they are.",
      "Take the first unfinished step only; explain why it matters in a sentence and offer to open its page (open_admin_page).",
      "Business details (company) and countries come first; then a shipping price for every country (shipping); then Stripe (payments), which Stripe itself guides.",
      "Products: suggest replacing the demo products with their own (product.new). Offer the add-product skill.",
      "A Kaizen plan (billing) is needed to open.",
      "When everything is done, say so and point to Home, where they open the store.",
      "Remember what they sell and who to, if they tell you (remember, kind fact).",
    ],
  },
  {
    id: "add-product",
    area: "store",
    title: "Add a product that sells",
    when: "The owner wants to add or improve a product.",
    steps: [
      "Ask what it is, its variants (such as sizes or colours), the price per country and how many they have, if not said.",
      "Open the new product page (product.new) or the product (product, with productId).",
      "Walk through: a clear title and a description with what it is made of and how it is used; pictures (the first is the card picture, 1600 px is plenty); variants with SKU, price per country and stock; delivery (shipped or download).",
      "The editor's AI writer can suggest texts: they check and copy them in.",
      "Product safety: the manufacturer and, for EU sales, a responsible person are needed for physical goods.",
      "Categories and tags help filters and menus (product.categories).",
      "Save as draft, then publish when it looks right. Offer to check it with get_product after.",
    ],
  },
  {
    id: "import-products",
    area: "store",
    title: "Bring products in from a file, or send them out",
    when: "The owner wants to import or export products as a CSV file, move a Shopify store's products over, asks why an import has problems, or asks about exporting orders or customers.",
    steps: [
      "Know the shape: Products, Import takes Kaizen's own file or a Shopify product export. The file is checked first (a dry run that lists every row's problem and changes nothing), then imported, one product at a time. A product with an error is left as it was.",
      "An import never deletes a product, never changes a product's web address, never imports a compare-at price (Kaizen shows a reduction only against the lowest price of the last 30 days) and never turns Shopify's Vendor into the product's manufacturer: that is a legal designation the owner makes. You cannot upload a file, start, apply or cancel an import: say where the page is (open_admin_page, products.import) and let them press the button.",
      "A Shopify file: they must say whether its prices include VAT, and a physical product needs a picture and a manufacturer before it is published (otherwise it is saved as a draft with the reason). Shopify's tax settings and backorders are not imported.",
      "Something went wrong or the check lists problems: call list_data_jobs (kind product_import) and then explain_import_problems. Repeat its counts as they are, error first, and give each group's what_to_do in plain words with the products it names; never quote a cell of their file or add a cause it did not give. Offer the job's page (products.import.job, with jobId).",
      "Exporting products: Products, Export (products.export) gives a file at once for a small store and a job with a Download button for a large one; the file reads back into Kaizen unchanged. Purchase options, download files and bookings are not in it.",
      "Orders and customers: the export pages (orders.export, customers.export) are the owner's, because the files can hold personal data. They are made without contact details unless chosen, are never emailed, and are deleted after 7 days. Say that Kaizen does not record marketing consent yet, so a customer file is not a mailing list. For the accountant, the VAT, OSS and IOSS files on the Analytics tax page are the ones to use; the order file is not a tax return.",
      "Changing many products at once (a price by a percentage, stock, a category) is done in the products list by ticking the products (products), or in the grid (products.bulk), which shows every change first and can be undone for seven days. Lowering a price shows shoppers a reduction against the lowest price of the last 30 days: say so before they confirm.",
      "Every table on the Analytics pages has a Download CSV button for the period on the page (a member who may export sees it). Say that the file is the table as the page shows it, in the store's main currency without VAT.",
    ],
  },
  {
    id: "weekly-review",
    area: "store",
    title: "Review the week",
    when: "The owner asks how the store is doing, for a review, a summary or what to focus on.",
    steps: [
      "Call sales_summary for 7 days and for 28 days, and sales_trend by week (the tools do the sums; repeat their amounts).",
      "Call store_checkup for what needs attention, and search_insights for searches that found nothing.",
      "Call product_performance for 7 days, restock_suggestions, and cart_reminder_stats and wishlist_insights if the store uses them.",
      "Answer in three parts: how sales went, what needs doing now (from the checkup, most urgent first), and up to three suggestions to sell more, each with the page to do it.",
      "Offer to open the first page, or to do what the tools can (with approval where needed).",
    ],
  },
  {
    id: "ship-orders",
    area: "store",
    title: "Send waiting orders",
    when: "The owner asks about orders to send, packing or tracking.",
    steps: [
      "Call list_orders with which to_send; oldest first matters most.",
      "For each, the order page has a printable packing slip (order.packing-slip). For several, pick_list sums what to take off the shelves (by product or by order) and gives the printable list's address; the Orders page prints their packing slips in one go.",
      "Marking sent needs the carrier and tracking number: mark_order_sent keeps it for their approval, one order at a time, and sends everything the order still has to send in one parcel.",
      "Sending only some items (the rest later) is done on the order's page, parcel by parcel: each parcel gets its own tracking and email, and the order shows Partly sent until nothing is left (list_orders with ship partly_sent finds them).",
      "Subscription box orders are charged as they are marked sent: say so, and send them from their order page.",
    ],
  },
  {
    id: "tidy-orders",
    area: "store",
    title: "Find, tag and archive orders",
    when: "The owner wants to find orders (by customer, product, tag or date), label them, or clear finished ones out of the way.",
    steps: [
      "Find them with list_orders: `search` takes up to five words (number, email or name, product or SKU, a tag, a tracking number), and the filters are the Orders page's own (pay, ship, status, tag, range, market, source, archived). Repeat the count it gives; never count yourself.",
      "Tags are staff's own internal labels (never shown to a customer): tag_orders adds or removes them on up to 25 orders at a time and says which orders it could not change.",
      "Archiving only hides: archive_orders takes finished orders out of the default list and the queues, and keeps every number, document and figure. It refuses an order that still has to be sent, was never paid, or has an open return, and says why. Nothing is deleted.",
      "More than 25 orders, or a standing rule: the Orders page's bulk bar handles up to 250 (orders), and Settings, Orders can archive finished orders by itself after a number of days (open_admin_page).",
      "Saved views (a search and filters kept under a name) are made on the Orders page: say so rather than describing one.",
      "Send in parts from the order's page: choose the items and quantities for this parcel, and the order stays Partly sent until everything is sent. Changing what a paid, unsent order holds (add, remove, fewer) is also done there, by staff; you cannot change an order, and get_order says what changed and what waits for the customer's payment.",
    ],
  },
  {
    id: "draft-order",
    area: "store",
    title: "Write a draft order and send a pay link",
    when: "The owner wants to sell to a customer by hand: a phone order, a quote, an invoice by link, or money taken in cash or by bank transfer.",
    steps: [
      "Find the SKUs (list_products, get_product) and ask for the customer's email and the country or market. Never guess a SKU, a price or an email.",
      "create_draft_order makes a DRAFT only: nothing is sent, no number is used and no stock is held. Read its summary back exactly as the store priced it (prices, VAT, shipping, total) and say any problem it lists.",
      "Custom prices, custom items, addresses, a note to the customer, tags and a shipping choice are added on the draft's page (open_admin_page with orders.draft): offer it.",
      "list_draft_orders shows what waits. send_draft_order emails the customer a pay link and holds the goods until it ends (1 to 30 days): it needs the owner's yes, and the store refuses with the reason if the draft cannot be sent yet.",
      "Taking payment in cash or by bank transfer, reopening and deleting a draft are done on the draft's page by the owner (or staff the owner allows): you cannot record a payment, ever.",
      "A paid draft is a normal order from then on: sales, VAT, the invoice and refunds work as for any order (a refund of money taken outside Kaizen is recorded on the order's page).",
    ],
  },
  {
    id: "handle-refund",
    area: "store",
    title: "Refund or cancel an order",
    when: "A customer wants their money back, an item is returned, or an order must be cancelled.",
    steps: [
      "Find the order (get_order) and say what was paid, what is left to refund and whether it is sent.",
      "Not sent yet: cancelling it on its page refunds everything and puts the items back.",
      "Sent or partly returned: refund_order with the amount and the reason; restock only what came back.",
      "Refunds go back to the card through Stripe; the customer gets an email if they choose.",
      "Add a note to the order about what was agreed (add_order_note).",
      "If the customer is withdrawing from the purchase or returning goods, use the handle-return skill: returns have their own queue and the refund is made from the return.",
    ],
  },
  {
    id: "handle-return",
    area: "store",
    title: "Answer a return or a withdrawal",
    when: "A customer withdraws from a purchase, asks to return goods, or the owner asks about returns, the right of withdrawal or what is overdue.",
    steps: [
      "Call list_returns (which overdue first, then requested) for what waits; it counts what is past the legal refund deadline, what needs an answer and withdrawals whose acknowledgement was not sent.",
      "Call explain_return for one: say what the customer asked for, the lines, where it stands, when the refund is due and what it would be now. Repeat what it says; never work out an amount or a date yourself.",
      "A withdrawal is the customer's legal right inside the withdrawal period: it cannot be refused and starts approved. The store must refund without undue delay and at most 14 days after it was told, and may wait for the goods or proof of sending. Never suggest declining one.",
      "A return request (the store's own longer window) is the owner's to answer: approve_return (kept for their approval; it emails the customer how to send the goods back) or decline_return with a plain reason the customer is sent. Ask the owner which before keeping either.",
      "Receiving, inspecting for diminished value and refunding are done on the return's page (return, with its returnId), where the working is shown before the button: you do not refund returns. Offer to open it (open_admin_page), or the queue (returns).",
      "The rules (window, who pays return shipping, instructions) are on returns.settings, owners only. A customer's defect complaint under the legal guarantee is not this flow.",
    ],
  },
  {
    id: "privacy-request",
    area: "store",
    title: "A customer asks for their data or to be forgotten",
    when: "A customer asks what the store knows about them, for a copy of their data, to be erased or forgotten, or the owner asks about GDPR requests, data requests or what is due.",
    steps: [
      "Call list_privacy_requests (which open, or overdue) for what waits: it counts the requests past the one-month deadline and those due within the week. The law gives one month from receipt to answer, free of charge; the month runs from the day the request arrived, not the day it was logged.",
      "A request that came by email, post or phone is logged by staff first: open privacy.new (kind, the address the person wrote from, the day it arrived). Offer to open it (open_admin_page). A customer who signed in and asked from their own account page has already logged it.",
      "Call explain_privacy_request for one: say what was asked, the clock (received, due, days left or overdue) and what can be done. Repeat what it says; never work out a date yourself.",
      "If the identity of the sender is in doubt, the owner replies to the address on file and asks; the request page records the doubt. Do not ask for more personal data than needed.",
      "For a copy: the owner downloads the file from the customer's page (customer, with the customer's key). It is never emailed; the owner sends it to the person themselves.",
      "For erasure: the erase page (customer.erase) first shows a plan: what goes now and what the law makes the store keep. Accounts for sales are kept for the bookkeeping period of the store's country, with the person removed, and made anonymous when it ends. Subscriptions are cancelled without a refund, saved cards detached and bonus credits lost. Say this before the owner confirms.",
      "If more time is needed it can be extended once, by up to two further months, but only within the first month and with a reason the person is told. A request that is unfounded or excessive can be refused with a reason; the person is told the reason and their right to complain. Neither is done by you.",
      "You never export, erase, extend or refuse, and you never see the person's data: these are done on the pages, behind a confirmation. The periods and the texts the person receives need a person's legal review; do not give legal advice.",
    ],
  },
  {
    id: "run-a-sale",
    area: "store",
    title: "Run a sale or campaign",
    when: "The owner wants a discount, a campaign, a sale or more traffic for a period.",
    steps: [
      "Ask what, for whom, how much off and until when.",
      "A code shoppers type: create_discount (kept for their approval); or open discount.new for codes per product or amount.",
      "An offer with no code, for a time: create_campaign (a percentage off, 3 for 2, or a free product over an amount, for the store, products, categories or tags; kept for approval). list_campaigns shows what is running.",
      "Tell shoppers: a page or front-page row (page builder), the menu (menus), and, with integrations or email tools they use, their list.",
      "Cart reminders can carry a code to win back carts (cart-reminders).",
      "After the sale, set_discount_active switches the code off (set_campaign_active for a campaign, which also stops by itself at its end date), and weekly-review shows how it went.",
    ],
  },
  {
    id: "set-up-bonus-program",
    area: "store",
    title: "Set up a bonus program",
    when: "The owner wants to reward returning customers, asks about loyalty, credits, points or cashback, or wants to change or check the bonus program.",
    steps: [
      "Call get_bonus_program to see whether it is on and how it is set. It answers from the store's own data: never guess a percentage or a balance.",
      "Explain in two sentences: signed-in customers earn credits on what they pay online for goods, and use them as a price reduction on a later order. Guests earn nothing; existing customers start at zero; turning it off keeps balances.",
      "Ask what they want: how much to give back (a typical start is 3-5%, and every percent is a cost on each order), how long before credits can be used (the return period, 14 days by default), the most of an order credits may pay (50% by default, never 100%), a minimum to use, and whether credits should expire (they never do unless chosen; an expiry sends a reminder email).",
      "Say the rules back in plain words, then call set_bonus_program with only what changes (kept for their approval). Do not turn it on until they have said yes to the rules.",
      "Tell them what they promise shoppers: credits are a price reduction when used, so the outstanding credits in get_bonus_program are what the store still owes; their accountant knows how to book unused credits.",
      "To reward one customer or correct a balance, use adjust_customer_credits with their email and a reason (kept for approval; it stays in the customer's history). get_bonus_program with `customer` shows their balance first.",
      "Open the page (bonus) for the settings and the overview; the customer page (customer) shows one customer's credits. Tell shoppers with a page or menu link (run-a-sale has the ideas).",
    ],
  },
  {
    id: "set-up-recommendations",
    area: "store",
    title: "Set up product recommendations",
    when: "The owner wants shoppers to be shown upsells, cross-sells or related products, asks about recommendations or \"you may also like\", or wants to know whether they work or what the AI costs.",
    steps: [
      "Call get_recommendations to see whether they are on, how they are set, what the AI has used of its monthly cap and what shoppers did. It answers from the store's own data: never judge the comparison yourself, repeat its words.",
      "Explain in two sentences: shoppers are shown products that suit what they look at, search for, save or have in the cart, never what they already bought; the store's AI may only reorder products the store itself picked, and a share of visitors always gets the plain ranking so the two can be compared.",
      "Switch them on or change the ceiling for upsells, the plain-ranking share or the monthly AI cap with set_recommendations (kept for approval); say the resulting settings back in plain words. The AI's cap protects the store's spend, so ask before leaving it off.",
      "Say which products go together or never should with add_recommendation_rule: goes_with (offered first), never_with, or hide (never recommended); remove_recommendation_rule undoes one (both kept for approval).",
      "Recommendations show only where a content grid that recommends is placed: open the page builder (pages), a content grid of products, and tick Recommend products for each shopper, on a product layout, the All products page, an article, any page, or a category or tag page (choose a page for them under Page roles). The chat assistant uses them too.",
      "To see if the engine finds what people really buy together, call check_recommendations (no AI, no cost). To see whether the AI's order beats the plain one, wait for visitors and call get_recommendations again: it says when there are too few.",
      "Open the page (recommendations) for the settings, rules and figures.",
    ],
  },
  {
    id: "refer-store-owners",
    area: "store",
    title: "Refer other store owners",
    when: "The owner asks about Kaizen's referral program, their referral link or code, credit on their Kaizen invoices, or how to earn from recommending Kaizen.",
    steps: [
      "Call get_my_referrals: it answers from their own account (link, code, visits, stores that opened, credit per currency). Never guess a figure, and never say anything about a referred store's customers or orders: it is not known to them and is not shown.",
      "Explain in two sentences: when another store owner opens a store through their link, they earn a share of the fees that store pays Kaizen (its plan and Kaizen's fee on its sales) for a number of months, as credit that comes off their own Kaizen plan invoices. Credit is kept per currency and waits a few days before it can be used.",
      "Their link is in the answer: offer to open the page (account.referrals) to copy it. Offer to write a short message they can send, in their own voice, without claims about savings or earnings.",
      "If the program is off or they are blocked, say so in one line and do not promise anything.",
    ],
  },
  {
    id: "set-up-referrals",
    area: "store",
    title: "Set up a referral program",
    when: "The owner wants customers to bring friends, asks about referrals, affiliates, tips or invite-a-friend discounts, or wants to change, check or police the referral program.",
    steps: [
      "Call get_affiliate_program to see whether it is on and how it is set. It answers from the store's own data: never guess a percentage or a figure.",
      "The referral program rewards in bonus credits, so the bonus program must be on first (set-up-bonus-program). If it is off, say so and set that up before anything else.",
      "Explain in two sentences: signed-in customers get their own link; a friend who orders for the first time through it gets a welcome discount, and the customer who shared it earns bonus credits. Only new customers count, nobody can refer themselves, and credits are taken back if the order is refunded or cancelled.",
      "Ask what they want: the friend's discount (10% is a typical start, with an optional cap), how much the referrer earns (5%), for how many of the friend's orders (only the first by default), an optional monthly limit per referrer, and how long a link is remembered. Every percent is a cost, twice on the first order.",
      "Say the rules back in plain words, then call set_affiliate_program with only what changes (kept for their approval). Do not turn it on until they have said yes.",
      "The link is remembered in a cookie only for visitors who allow marketing cookies, so the store's cookie banner appears once the program is on; tell the owner.",
      "To stop a customer earning (for example referring themselves with a second account), use block_affiliate with their email and a reason; get_affiliate_program with `customer` shows their friends and earnings first.",
      "Open the page (affiliates) for the settings, the referrers and the orders that came through links; the customer page (customer) shows one customer's referrals.",
    ],
  },
  {
    id: "improve-search",
    area: "store",
    title: "Help shoppers find things",
    when: "Searches find nothing, shoppers cannot find products, or the owner asks about search or filters.",
    steps: [
      "Call search_insights: the searches with no results are what to fix.",
      "For each: if the store sells it under another name, add that word to the product's title, description or tags; if it does not, it may be something to stock.",
      "Categories and tags feed the filters (product.categories).",
      "The chat agent (chat) answers shoppers from the store's pages and knowledge; add facts it lacks there.",
    ],
  },
  {
    id: "seo-checkup",
    area: "store",
    title: "Be found on Google and in AI answers",
    when: "The owner asks about SEO, Google, visibility or AI crawlers.",
    steps: [
      "Open seo: search engines and AI crawlers are allowed per country, with titles and descriptions.",
      "Products and pages each have their own search title and description in their editor.",
      "Pictures need alt texts: the media library writes them with AI (media).",
      "A blog (articles) with helpful posts brings visitors over time.",
      "A domain of the store's own (domains) helps too.",
    ],
  },
  {
    id: "custom-fields",
    area: "store",
    title: "Add extra product information (custom fields)",
    when: "The owner wants extra facts on products, pages or articles that the editor has no place for: a size guide, material, ingredients, warranty, a designer.",
    steps: [
      "Look first: list_field_groups shows the store's groups and where each applies, get_fields what one product, page or article holds. Do not make a group that already exists.",
      "A group holds fields of one kind of thing (products, pages, articles, or the store itself: site-wide facts such as opening hours or a brand story, entity store with no item). create_field_group makes one from a name and its fields (label, type, choices for select, radio, button group or checkbox); it is kept for their approval. Plain types only: text, text area, rich text, number, measurement, yes or no, choices, date, email, web address. Pictures, files, links, related products, groups and repeaters are made in the field editor (fields).",
      "Fields are private until made public: only staff see them. Make a field public (access public) only if the owner wants it shown to shoppers; the site then shows it through the product layout's Custom fields component, and the standard product page shows public groups after the description (product-layouts to place it).",
      "set_fields fills in or clears values by field name, one product, page or article at a time (kept for approval): choices by their label, yes or no as true or false, text in the store's main language. Text passes the claims filter, so no green claims, urgency, best-price claims, prices or stock levels; if it refuses, reword and try again.",
      "Rules for which products get a group (a category, a kind of product), required fields, conditional logic, translations and what shows in filters and search are set in the field editor: offer to open it (fields).",
    ],
  },
  {
    id: "design-the-store",
    area: "store",
    title: "Make the store look right",
    when: "The owner wants to change the look, front page, menus, logo or pages.",
    steps: [
      "Colours, fonts, buttons and light and dark: design.",
      "Logo, site icon and which menus show: navigation; the menus themselves: menus.",
      "The front page and other pages: pages, with the page builder; Create with AI (page.ai) builds a page from an interview.",
      "Custom headers and footers: headers, footers. Product pages' layout: product-layouts.",
      "Offer to open the page for what they want to change first.",
    ],
  },
  {
    id: "set-up-bookings",
    area: "store",
    title: "Take bookings",
    when: "The owner wants appointments, stays or rentals.",
    steps: [
      "Switch bookings on under Features (features) and set the time zone.",
      "Appointments: add staff with their hours (bookings.staff.new), then a product of kind appointment linked to them.",
      "Stays and rentals: add rooms or items (bookings.units.new), then a stay or rental product.",
      "How it is paid (now, deposit or at the venue) and cancellation rules are on the product.",
      "The calendar (bookings) shows what is booked; list_bookings reads it.",
    ],
  },
  {
    id: "set-up-subscription-boxes",
    area: "store",
    title: "Offer subscription boxes",
    when: "The owner wants shoppers to get a regular box of goods they choose.",
    steps: [
      "Switch subscription boxes on under Features (features).",
      "Add a delivery day per country with its cutoff (deliveries).",
      "Shoppers start from My account, add products with the button on product pages, and are charged when each box is sent.",
      "Each round's orders are made at the cutoff; send and charge them from their order pages. subscription_boxes shows the round.",
    ],
  },
  {
    id: "unit-prices",
    area: "store",
    title: "Show the price per kilo, litre or metre",
    when: "The owner asks about unit prices, a price per kg or litre, the comparison price shoppers must see on food, drink and other goods sold by weight, volume or length, or products that lack it.",
    steps: [
      "Call unit_price_gaps: without a product it lists the products that need their content (a pack's weight, volume or length) and still lack it, with why and the SKUs, worked out by the store. Repeat its list; never guess which products need one.",
      "To see what shoppers are shown for one product, call unit_price_gaps with the product (or get_product): each variant's content and the price per kg, litre or metre in each country, with or without VAT as the store shows it. Repeat the figures; do the arithmetic never.",
      "You cannot set content: open the product (product, with productId) and say where it goes: each variant's content (an amount and a unit) in the editor. A product marked as sold by measure, or in a category that needs a price per kg or litre, cannot be saved active without it.",
      "To make a whole category need it, open the categories page (product.categories) and tick it there; products already on sale stay on sale and show no unit price until their content is set.",
      "Say plainly that which comparison unit a country allows (1 kg or 100 g, 1 l or 100 ml) and what the law requires of a store is for the owner or a lawyer to confirm: the store shows the safe default of 1 kg or 1 l unless the owner chose otherwise, and Germany never shows 100 g.",
    ],
  },
  {
    id: "vat-and-reverse-charge",
    area: "store",
    title: "Understand how the store charges VAT",
    when: "The owner asks about VAT, a VAT number, selling VAT-free to a business in another EU country, OSS or IOSS, or why an order was charged VAT.",
    steps: [
      "Call tax_readiness and get_tax_profile: they say what is on and what is missing, worked out in code. Repeat their words; never guess a rule.",
      "Prices include VAT and each sale is charged the VAT of the country it goes to. Reverse charge needs the store's own VAT number to be checked valid, and then only goods and downloads sold to a business in another EU country that gives a valid VAT number for the country the goods go to.",
      "To fix what is missing, open the Tax page (tax); only an owner changes it. You never change a VAT number, a registration or a rate: say the owner does it there.",
      "For why an order was charged VAT, open the order (order, with orderId): its VAT treatment says the reason in plain words.",
      "A reduced rate for a product (food, books and so on) is the product's VAT category in the product editor; the rate comes from the platform's table, which says where no reduced rate is known and the standard rate applies.",
      "Say plainly that this is not tax advice and that an accountant should confirm anything about OSS, IOSS or thresholds.",
      "For the store's VAT by country and rate, and for what an OSS or IOSS return would hold, use the VAT, OSS and IOSS reports skill (vat-oss-ioss-reports) and the VAT page (analytics.tax).",
    ],
  },
  {
    id: "vat-oss-ioss-reports",
    area: "store",
    title: "Read the VAT, OSS and IOSS reports",
    when: "The owner asks how much VAT they charged, per country or rate, what to give the accountant, what an OSS or IOSS return holds, or whether the VAT figures agree with their orders and invoices.",
    steps: [
      "These are the owner's own figures, made from the store's invoices and credit notes, for the owner and their accountant. Say at the start that they are not a tax return, that Kaizen files nothing, and that an accountant should read them. Never tell the owner what to file, when a return is late, or that they owe or are owed anything: the tools give figures and a deadline sentence, repeat only those.",
      "VAT by country and rate: call vat_report (a named period such as last_month or last_quarter, or from and to). It gives, per country, rate and basis, the VAT charged, credited and after credits in the invoice's currency and the main currency, and where each sale is reported. Repeat its amounts; never add or convert them yourself.",
      "Does it agree with Finance and the orders: vat_report also gives the reconciliation. When it says Equal, every difference is named (for example paid orders with no invoice yet, which are listed by cause). When it says Does not reconcile, say so plainly, repeat the lines, and send the owner to the VAT page (analytics.tax). Orders waiting for an invoice are fixed on the Invoices page (invoices).",
      "OSS (a quarter) and IOSS (a month): call oss_return_data with the scheme and, if the owner names one, the period (2026-Q3 or 2026-09; leave it out for the last completed one). Mode filing is what a return holds; books counts every credit note in the period it was made. Repeat the parts, the euro rates used and the deadline sentence as they are.",
      "A figure that says not known or a return that is not complete is missing a euro rate: say which currency and day, and that the owner fetches the ECB's rate or enters their own on the VAT page (analytics.tax). Never read a missing figure as zero. Under Not in this return, say why sales are left out (for example domestic sales belong in the store's own VAT return), using its words.",
      "If IOSS says it is off, the store has no IOSS number: say the owner sets it on the Tax page (tax) and that nothing is reported until then. A registration that does not fit the sales is a note to repeat, never a decision.",
      "You cannot make or send a file or change a rate, a registration or a VAT number. The CSV files are exported by the owner on the VAT page (analytics.tax), for their accountant. For anything about what a country requires, which scheme applies, or a threshold, say it is not tax advice and that an accountant should confirm it.",
    ],
  },
  {
    id: "invoices-and-credit-notes",
    area: "store",
    title: "Understand the store's invoices and credit notes",
    when: "The owner asks about invoices, credit notes, a missing or waiting invoice, invoice numbers, the PDF a shopper gets, or what the accountant needs.",
    steps: [
      "Call invoice_readiness: it says whether invoicing is on, what the store's own details still lack, the two number series and how many orders wait, worked out in code. Repeat its words.",
      "For the documents themselves call list_invoices (invoices, credit_notes, or waiting for orders with no invoice yet and refunds with no credit note, with why each waits). It gives numbers, days and amounts, never a buyer's name or address: for those open the order (order, with orderId).",
      "An invoice is made by the store when an order is paid and a credit note when a refund succeeds; you cannot make, change, renumber or send one. Waiting ones are tried again every five minutes; after fixing the cause the owner presses Check again on the Invoices page (invoices).",
      "Missing seller details are fixed on the Company page (company); a VAT number under the Tax page (tax); the switch, the note on every document and the numbering at the invoicing settings (invoices.settings), which only an owner changes. The accountant's file is the CSV on the Invoices page.",
      "A reverse-charge order waiting past the 15th of the month after it was paid is overdue: say so plainly. For anything else about what an invoice must say in a country, say this is not tax or accounting advice and that an accountant should confirm it.",
    ],
  },
  {
    id: "grow-sales",
    area: "store",
    title: "Sell more",
    when: "The owner asks how to grow, get more sales or keep customers coming back.",
    steps: [
      "Look first: analytics_overview (the figures and what is missing), analytics_alerts (what needs a look), explain_change when sales moved, then sales_trend, customer_insights, product_performance, sales_funnel, search_insights, cart_reminder_stats.",
      "Common wins, only those that fit what you found: cart reminders on (cart-reminders); fixing searches that find nothing; a code for a campaign; winning back customers at risk (the win-back skill); purchase options for things people buy again (subscriptions on the product); a chat agent for questions (chat); Google reviews on the front page; passing events to a newsletter tool through Zapier or Make (integrations).",
      "Suggest at most three, each with why and the page, and offer to start with one.",
    ],
  },
  {
    id: "ab-test",
    area: "store",
    title: "Test two versions of a page",
    when: "The owner wants to find out which version of a page, the header, the footer or a product layout works better, asks what to test, or asks how a test is going.",
    steps: [
      "Know what a test is: visitors who accepted statistics cookies are split between the original and a version; the store counts who adds to the cart, reaches checkout, orders or clicks, and says in words when there is a winner. Everyone else sees the original.",
      "Not started yet: call suggest_experiments, pick at most three things worth testing with a sentence of why each (what is on the page, an earlier test, the orders and the cart-to-order figures), and say plainly that nothing starts without their yes. Never state how many visitors they have or how long a test will take unless they told you (visitors_per_day, current_rate_percent) and the tool worked it out.",
      "One thing at a time: a heading, a button's words or a text. Choose one goal: more orders, more revenue per visitor, more people adding to the cart or reaching checkout, or more clicks on a named button. Small stores learn sooner from adding to the cart or a click than from orders.",
      "Write the new words with them and call draft_experiment (block ids come from suggest_experiments). The words must not promise prices, stock, urgency or 'best'; they are checked. A draft shows nothing to visitors: tell them to look at version B in the admin (open_admin_page, experiments) before starting.",
      "Start with start_experiment, which needs their approval. It runs at least 14 days before it says anything, so tell them not to stop it early because a number looks good.",
      "Running: list_experiments, then explain_results in their words and language. Repeat the verdict the tool gives and its reasons; never call a winner it does not, and say too early when it says so.",
      "Deciding: apply_winner with the version, or `original` to keep what is there (it stops a running test first). Prices, discounts, shipping and legal pages are never tested.",
    ],
  },
  {
    id: "fix-broken-links",
    area: "store",
    title: "Fix broken links with redirects",
    when: "The owner asks about broken links, pages shoppers or Google cannot find, 404s, an address that changed, or moving from another shop and keeping its addresses.",
    steps: [
      "Know what a redirect is here: a permanent redirect (308) from an old address on the store to a page that exists, the same in every country and language. The store makes one itself when a product's, category's or tag's address changes; the owner's own are for everything else (an old shop's /collections/… or /pages/… addresses, a page that was deleted).",
      "Call redirect_overview and say, in a few lines, how many redirects the store has and which addresses were asked for that were not there, most asked first. Every count is at least what happened (a cached request is not seen): say 'at least', never add or estimate a number, and if the list is empty say that nothing was recorded, not that nothing is broken.",
      "For each address worth fixing offer one target: use a suggested target the tool gave, or the page the owner names. Never invent an address. An address that looks like a robot's probe, or one nobody needs, can be left; the owner hides it on the Pages not found page (open_admin_page, redirects.404s).",
      "Make it with add_redirect (from and to as paths on the store, no country in front). It needs their approval and the tool checks it first: it refuses a live page, a cart or checkout address, another website and a loop, and says why; repeat that reason in plain words. After a yes, say what was added and that it works at once.",
      "Many addresses at once, or a list from the old shop: do not add them one by one. Explain that the Redirects page imports a CSV file with the columns Redirect from and Redirect to (Shopify's file reads as it is), checks every line first and writes nothing until they confirm, and offer to open it (open_admin_page, redirects.import). list_data_jobs shows how an import or export is going.",
      "You cannot edit, delete or import redirects yourself: for those open the Redirects page (redirects). Changing a product's or category's address later needs nothing more: the store leaves the redirect.",
    ],
  },
  {
    id: "restock",
    area: "store",
    title: "Reorder in time",
    when: "The owner asks what to reorder, about stock running out, or is placing an order with a supplier.",
    steps: [
      "Ask, if not known, how long their supplier takes to deliver and how many days the stock should last; remember the answer (remember, kind procedure).",
      "Call restock_suggestions with those days; start with what is urgent (it runs out before new stock could arrive).",
      "Give a short order list: product, SKU, how many to order. The numbers come from the tool; do not change them. A variant with units owed to customers (owed_to_customers) is sold on backorder: its suggestion already adds those units, and they are the first to ship when the goods arrive.",
      "For the figures behind a variant (on hand at each location, committed to checkouts, owed, its own warning level) call stock_levels; stock_history shows what changed it, when and why.",
      "Out-of-stock products that do not sell might rather be archived: say so, never archive without being asked.",
      "When the goods arrive, set_stock sets the new counts (kept for approval), one SKU at a time: the quantity is the new total counted at that location, not the number received, and the location is named when the store keeps stock in more than one place. Give the reason received, or count after a recount, and never a note about a person. Many SKUs at once: the Inventory page (open_admin_page, inventory) reviews every change before it saves, and its file import (inventory.import) checks a counted file first.",
    ],
  },
  {
    id: "backorders",
    area: "store",
    title: "Sell when out of stock",
    when: "The owner asks to keep selling a product that is sold out, to take orders for goods that are not in yet, or what happens when a variant goes below zero.",
    steps: [
      "Explain in two sentences what it is: a variant set to keep selling at zero stock takes orders and ships when the goods arrive, and shoppers are told a delivery time before they buy, on the product page, in the cart, on the order and in the confirmation email. Stock then goes below zero; the units owed are shown as owed on the Inventory page.",
      "The delivery time is a promise the store makes: ask how many days it really takes, from 1 to 90, and use exactly that. Never choose it yourself and never suggest a shorter one to sell more. If they say more than 30 days, say that the customer then agrees to a longer time by ordering and that it must be said clearly; the wording shoppers see is the store's own and is reviewed by a person, so do not rewrite it.",
      "Only goods that are shipped can keep selling at zero; downloads, services, bookings and subscription plans cannot. Call stock_levels (status backorder or out) to find the variant and its SKU, and say what its figures are now.",
      "Make the change with set_backorder (policy continue with the days, or deny to stop). It needs their approval and checks the variant first. Say what shoppers will be told, in the tool's words.",
      "Turning it off stops new orders at zero but leaves the orders already placed owing their units: say how many are owed (stock_levels, owed_to_customers) and that those orders still need the goods.",
      "Many variants at once, or a warning level for each: the Inventory page does it for the selected rows (open_admin_page, inventory). A free gift or a weekly subscription box is never sold on backorder, whatever the setting.",
    ],
  },
  {
    id: "win-back",
    area: "store",
    title: "Win back customers",
    when: "The owner wants returning customers, to reach customers who stopped buying, or to thank the best ones.",
    steps: [
      "Call customer_insights: the at-risk customers bought twice or more but not for three months or more.",
      "Suggest a code for them (create_discount with once_per_customer and an end date), kept for approval.",
      "Draft a short, personal email with the owner: what is new, the code and its last day; nothing the tools did not give.",
      "email_customer sends one email per customer, each kept for the owner's approval: offer to prepare them for the first few, or a Zapier/Make link to their newsletter tool for many (integrations).",
      "Afterwards, customer_insights and list_discounts show who came back.",
    ],
  },
  {
    id: "know-your-customers",
    area: "store",
    title: "Understand the customers",
    when: "The owner asks who buys, how loyal customers are, what sells, or where shoppers drop off.",
    steps: [
      "Call customer_insights, then product_performance and sales_funnel for the same period. For how the store is doing in money, or why sales moved, call analytics_overview and explain_change and repeat their sentences and figures: they are counted in code, with what is missing (product costs, visit counting) said plainly.",
      "Answer in plain words: how many come back and how often, the best sellers and what does not sell, and where carts are left.",
      "One or two suggestions that follow from it, each with its page or skill (win-back, improve-search, run-a-sale).",
      "Visits are counted only when the store has switched visit counting on (analytics_overview says whether it has): never guess them, and never give a profit figure the tool did not.",
    ],
  },
  {
    id: "write-to-customer",
    area: "store",
    title: "Write to a customer",
    when: "The owner wants to tell a customer something: a delay, an answer to a question, a thank-you, or to resend an email.",
    steps: [
      "Find the order or customer first (get_order, get_customer) so the facts are right.",
      "A lost confirmation or tracking email: resend_order_email, kept for approval.",
      "Otherwise draft the email with the owner in the customer's language: short, friendly, signed as the store, facts only from the tools.",
      "email_customer keeps it for the owner's approval; the approval shows the whole text, so they can check it. Add a note to the order about what was said (add_order_note).",
    ],
  },
  {
    id: "review-requests",
    area: "platform",
    title: "Handle access requests",
    when: "The platform admin asks about sign-ups or access requests.",
    steps: [
      "Call list_access_requests; say who is waiting, since when and what they want to sell.",
      "approve_access_request creates the store and emails the person (kept for approval); it needs a store address (slug) that is free.",
      "decline_access_request declines (kept for approval).",
      "Offer to open the requests page (requests).",
    ],
  },
  {
    id: "platform-health",
    area: "platform",
    title: "Check the platform",
    when: "The platform admin asks how Kaizen is doing, for a review or what needs attention.",
    steps: [
      "Call platform_overview for stores, plans and requests.",
      "Call plan_reminder_stats for plan checkouts left unfinished, list_platform_emails for emails that failed, and platform_ai_usage for how much of the AI was used, by whom and on whose key.",
      "Say what needs doing first (waiting requests, failed emails, stores without a plan), each with its page.",
    ],
  },
  {
    id: "ab-tests-platform",
    area: "platform",
    title: "Watch the stores' A/B tests",
    when: "The platform admin asks about the stores' A/B tests, which tests are running, stuck or hurting sales, or how the search test or a store's recommendations test is going.",
    steps: [
      "Call list_ab_tests (needs_attention: true to see only the trouble, or store for one store). Start with what needs a look, each with its store and the sentence the tool gives.",
      "Call explain_ab_test with a test's id for its figures and verdict. Repeat the verdict and its reasons; never call a winner it does not and never give a verdict of your own. Say too early when it says so: a test says nothing before its minimum visitors and days.",
      "You cannot start, stop or change a store's test: the owner does that. For a test that needs a look, say what to tell the owner (the tool's what_next) and offer to open the stores' tests page (experiments).",
      "A version selling clearly less is stopped by the hourly check and the owners are emailed: say so rather than offering to stop it.",
      "The search test and a store's held-out recommendations count searches and tabs, not visitors who accepted cookies: say what was counted. Never add amounts across currencies.",
    ],
  },
  {
    id: "referral-program",
    area: "platform",
    title: "Run the referral program",
    when: "The platform admin asks about referrals, affiliates, commission for referring store owners, or wants to change the program's terms.",
    steps: [
      "Call get_referral_program (with referrers: true to see who brings in the most). Say whether it is on, the terms, and the totals per currency: never add amounts across currencies.",
      "set_referral_program changes it (kept for approval). A referral keeps the commission and months it was made with, so a change only affects stores referred afterwards; off stops new referrals and new commission but earned credit stays usable.",
      "Blocking a referrer, voiding a referral and adjusting credit are done on the page (referrals), each with a reason: offer to open it.",
      "Turning it on also lists the referral cookie on the cookie page and shows visitors the marketing cookie choice; say so.",
    ],
  },
  {
    id: "store-billing",
    area: "platform",
    title: "Help with a store's plan",
    when: "The platform admin asks about a store's plan, invoices, fee or discount.",
    steps: [
      "Find the store (list_stores, then get_store).",
      "Say its plan, status, fee per sale and any discount.",
      "Changes to plans and fees are made on the store's page (store, with its slug): offer to open it.",
    ],
  },
];

export function skillsFor(area: SkillArea): AssistantSkill[] {
  return ASSISTANT_SKILLS.filter((s) => s.area === area);
}

/** The skills as the prompt lists them. */
export function skillsText(area: SkillArea): string {
  return skillsFor(area)
    .map((s) => `${s.id}: ${s.when}`)
    .join("\n");
}
