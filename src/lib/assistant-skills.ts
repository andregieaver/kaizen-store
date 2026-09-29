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
      "When everything is done, say so and point to the Overview, where they open the store.",
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
      "For each, the order page has a printable packing slip (order.packing-slip).",
      "Marking sent needs the carrier and tracking number: mark_order_sent keeps it for their approval, one order at a time.",
      "Subscription box orders are charged as they are marked sent: say so, and send them from their order page.",
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
    id: "grow-sales",
    area: "store",
    title: "Sell more",
    when: "The owner asks how to grow, get more sales or keep customers coming back.",
    steps: [
      "Look first: sales_trend, customer_insights, product_performance, sales_funnel, search_insights, cart_reminder_stats.",
      "Common wins, only those that fit what you found: cart reminders on (cart-reminders); fixing searches that find nothing; a code for a campaign; winning back customers at risk (the win-back skill); purchase options for things people buy again (subscriptions on the product); a chat agent for questions (chat); Google reviews on the front page; passing events to a newsletter tool through Zapier or Make (integrations).",
      "Suggest at most three, each with why and the page, and offer to start with one.",
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
      "Give a short order list: product, SKU, how many to order. The numbers come from the tool; do not change them.",
      "Out-of-stock products that do not sell might rather be archived: say so, never archive without being asked.",
      "When the goods arrive, set_stock sets the new counts (kept for approval), one SKU at a time; or the product page.",
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
      "Call customer_insights, then product_performance and sales_funnel for the same period.",
      "Answer in plain words: how many come back and how often, the best sellers and what does not sell, and where carts are left.",
      "One or two suggestions that follow from it, each with its page or skill (win-back, improve-search, run-a-sale).",
      "Visits and product views are not tracked: never guess them.",
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
