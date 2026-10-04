import { z } from "zod";

import { tool, type OwnerTool } from "./owner-tools";
import { REFERRAL_COMMISSION_BPS_MAX, REFERRAL_COOKIE_DAYS_MAX, REFERRAL_MONTHS_MAX, REFERRAL_PENDING_DAYS_MAX } from "./referrals";

/**
 * The AI manager's own tools (D103), beside the store's (`OWNER_TOOLS`) or
 * the platform's (`PLATFORM_TOOLS`): guiding through the admin, skills and
 * memory, as Kaizen Life's assistant has its app knowledge, playbooks and
 * memory. They are not owner tools, so the store's MCP server (D96) does
 * not serve them.
 */

export const MANAGER_TOOLS = [
  tool(
    "find_admin_page",
    "Finds the admin pages for what the person wants to do or see, with what each page is for and what can be done there. Use it to guide: when they ask where or how, before saying something cannot be done.",
    z.object({ question: z.string().trim().min(2).max(300).describe("What they want to do or find, in their words.") }),
  ),
  tool(
    "open_admin_page",
    "Opens an admin page for the person, by its id from the map or find_admin_page, with the ids it needs (such as orderId). Use it when they ask to go somewhere, or say yes to your offer to open it.",
    z.object({
      page: z.string().trim().min(1).max(60).describe("The page's id, such as orders, order, product.new or design."),
      params: z.record(z.string(), z.string().max(80)).default({}).describe("The page's ids, such as { orderId: '…' }; orders take their id from get_order."),
    }),
  ),
  tool(
    "use_skill",
    "Loads a skill: the playbook for a job, from the list in your instructions. Load it before doing that job, then follow it.",
    z.object({ skill: z.string().trim().min(1).max(60) }),
  ),
  tool(
    "remember",
    "Keeps something about the person for later conversations: a preference (how they like answers, their routines), a fact about their business, a way they do things, or a goal. Use it when they tell you something lasting or ask you to remember. Never keep customers' personal details, passwords or payment details.",
    z.object({
      content: z.string().trim().min(3).max(500).describe("One short statement, such as 'Prefers answers in Norwegian' or 'Ships every Tuesday and Friday'."),
      kind: z.enum(["preference", "fact", "procedure", "goal"]).default("preference"),
      everywhere: z.boolean().default(false).describe("True when it is about the person in every store; false when about this store."),
    }),
  ),
  tool(
    "forget",
    "Forgets something you remembered, by its id from what you know about them. Use it when they say it is wrong or no longer true.",
    z.object({ memory: z.uuid() }),
  ),
  tool(
    "recall",
    "Searches everything you remember about the person, beyond what is in your instructions.",
    z.object({ query: z.string().trim().min(2).max(200) }),
  ),
  tool(
    "get_my_referrals",
    "The person's own referrals (Kaizen's referral program): their link and code, visits, how many asked for a store, the stores that opened through it with the credit each earned, and their credit per currency, usable and waiting. Answers only from their own account; it never shows a referred store's customers or orders.",
    z.object({}),
  ),
  tool(
    "decide_approval",
    "Carries out the person's answer to a change waiting for their yes (listed in your instructions with its id), when they answer it in words, spoken or typed, in this message. Approving needs a plain yes from them in this message; never approve what they did not clearly agree to.",
    z.object({ approval: z.uuid(), approve: z.boolean() }),
  ),
] as const satisfies readonly OwnerTool[];

const slug = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "An address is lower-case letters, digits and dashes.");

export const PLATFORM_TOOLS = [
  tool(
    "platform_overview",
    "Kaizen at a glance: stores by status, stores on a plan, access requests waiting, plans, and stores with their own AI.",
    z.object({}),
  ),
  tool(
    "list_access_requests",
    "People asking to open a store: waiting ones first (oldest first), then the latest decided, with what they want to sell.",
    z.object({ status: z.enum(["pending", "all"]).default("pending") }),
  ),
  tool(
    "approve_access_request",
    "Approves an access request: creates the store (copied from the template) at the address given and emails the person a sign-in link. Needs the platform admin's approval.",
    z.object({
      request: z.string().trim().min(1).max(200).describe("The request's id, or the person's email."),
      slug: slug.describe("The store's address, such as kaffebrenneriet: free, lower-case letters, digits and dashes."),
      store_name: z.string().trim().max(120).optional().describe("The store's name; the one they asked for unless given."),
    }),
    "send",
  ),
  tool(
    "decline_access_request",
    "Declines an access request. Needs the platform admin's approval.",
    z.object({ request: z.string().trim().min(1).max(200).describe("The request's id, or the person's email.") }),
    "send",
  ),
  tool(
    "list_stores",
    "Every open store with its plan, plan status, fee per sale and owner. `search` matches the name, address or owner's email.",
    z.object({ search: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(100).default(25) }),
  ),
  tool(
    "get_store",
    "One store: its status, plan, fee, discount, owner and how many products and paid orders it has.",
    z.object({ store: slug.describe("The store's address (slug).") }),
  ),
  tool("list_plans", "Kaizen's plans: name, fee per sale, prices per currency and interval, and how many stores are on each.", z.object({})),
  tool(
    "list_owners",
    "Store owners and staff on Kaizen with their stores and plans. `search` matches the name or email.",
    z.object({ search: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(50).default(15) }),
  ),
  tool(
    "get_owner",
    "One owner: their stores, plans and plan checkouts they did not finish.",
    z.object({ owner: z.string().trim().min(3).max(200).describe("Their email or account id.") }),
  ),
  tool("plan_reminder_stats", "Plan checkouts owners left unfinished: how many, reminded, and finished after a reminder.", z.object({})),
  tool(
    "list_platform_emails",
    "The latest emails Kaizen and the stores sent: what, to whom, from which store and whether they went out. `failed_only` shows those that did not.",
    z.object({ failed_only: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) }),
  ),
  tool(
    "get_referral_program",
    "Kaizen's referral program: whether it is on, its commission, months, pending days and cookie days, and its totals per currency (referrers, referred stores, commission earned, credit used and credit owed). `referrers` lists the most active referrers with what they brought in and their credit.",
    z.object({ referrers: z.boolean().default(false), limit: z.number().int().min(1).max(25).default(10) }),
  ),
  tool(
    "set_referral_program",
    "Changes Kaizen's referral program: switch it on or off, or change the commission (percent of the fees the referred store pays Kaizen), the months a store earns it, the days earned credit waits before it can be used, or the days the referral cookie lasts. Leave out what should not change. A referral already made keeps the terms it was made with. Changes what Kaizen pays out, so it is kept for the platform admin's approval.",
    z.object({
      enabled: z.boolean().optional(),
      percent: z.number().min(0).max(REFERRAL_COMMISSION_BPS_MAX / 100).optional().describe(`Commission in percent of the fees the referred store pays Kaizen, 0 to ${REFERRAL_COMMISSION_BPS_MAX / 100}, at most two decimals.`),
      months: z.number().int().min(1).max(REFERRAL_MONTHS_MAX).optional().describe("How many months after a store opens it earns commission."),
      pending_days: z.number().int().min(0).max(REFERRAL_PENDING_DAYS_MAX).optional().describe("Days before earned credit can be used."),
      cookie_days: z.number().int().min(1).max(REFERRAL_COOKIE_DAYS_MAX).optional().describe("Days the referral cookie lasts, once a visitor allows it."),
    }),
    "public",
  ),
  tool(
    "list_ab_tests",
    "Every store's A/B tests, read-only: what is running, scheduled or stopped and waiting for the owner's decision, with each one's store, what it tests, its visitors and verdict sentence, and what needs a look (a version selling less, visitors divided unevenly, a test nobody sees, one past its end or forgotten, a scheduled start that did not happen). Also the tests that run on their own: the search test (keyword against hybrid) and each store's held-out recommendations. You cannot start, stop or change a store's test: the owner does; tell them what needs a look.",
    z.object({
      store: slug.optional().describe("A store's address (slug) to look only at its tests."),
      status: z.enum(["active", "all"]).default("active").describe("`active`: running, scheduled and waiting for a decision. `all` adds drafts and decided tests."),
      needs_attention: z.boolean().default(false).describe("True to list only what needs a look."),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  ),
  tool(
    "explain_ab_test",
    "One A/B test in full, by its id from list_ab_tests: a store's page test (its versions, who did what, the verdict the store worked out, whether visitors were divided as promised, and what to tell the owner), the search test, or a store's held-out recommendations. Repeat the verdict it gives and its reasons; never call a winner it does not, and say too early when it says so. Read-only.",
    z.object({ test: z.string().trim().min(8).max(80).describe("The test's id from list_ab_tests.") }),
  ),
  tool(
    "platform_ai_usage",
    "How much of the AI every store and Kaizen itself used in a period: requests and tokens in total, per provider and model, per store, per feature, and how much ran on Kaizen's own key. Ask for one store or store owner account to see theirs, per provider and model.",
    z.object({
      days: z.number().int().min(1).max(365).default(30),
      store: z.string().trim().max(60).optional().describe("A store's address (slug) to look at only that store."),
      owner: z.string().trim().max(200).optional().describe("A store owner's email to look at only the stores they own."),
    }),
  ),
] as const satisfies readonly OwnerTool[];

export type ManagerToolName = (typeof MANAGER_TOOLS)[number]["name"];
export type PlatformToolName = (typeof PLATFORM_TOOLS)[number]["name"];
export type ManagerToolInput<N extends ManagerToolName> = z.output<Extract<(typeof MANAGER_TOOLS)[number], { name: N }>["input"]>;
export type PlatformToolInput<N extends PlatformToolName> = z.output<Extract<(typeof PLATFORM_TOOLS)[number], { name: N }>["input"]>;

export const MANAGER_TOOLS_BY_NAME: Record<string, OwnerTool> = Object.fromEntries(MANAGER_TOOLS.map((t) => [t.name, t]));
export const PLATFORM_TOOLS_BY_NAME: Record<string, OwnerTool> = Object.fromEntries(PLATFORM_TOOLS.map((t) => [t.name, t]));

/** What the person sees while a tool runs. */
export const TOOL_WORDS: Record<string, string> = {
  store_overview: "Looking at the store",
  sales_summary: "Adding up sales",
  list_orders: "Looking at orders",
  get_order: "Reading the order",
  list_returns: "Looking at returns",
  explain_return: "Reading the return",
  list_privacy_requests: "Looking at privacy requests",
  explain_privacy_request: "Reading the privacy request",
  approve_return: "Preparing the answer",
  decline_return: "Preparing the answer",
  list_products: "Looking at products",
  get_product: "Reading the product",
  low_stock: "Checking stock",
  list_bookings: "Looking at bookings",
  list_discounts: "Looking at coupons",
  list_campaigns: "Looking at campaigns",
  list_pages: "Looking at pages",
  list_field_groups: "Looking at custom fields",
  get_fields: "Reading custom fields",
  create_field_group: "Preparing the custom fields",
  set_fields: "Preparing the change",
  search_insights: "Looking at searches",
  setup_progress: "Checking the setup",
  store_checkup: "Checking the store",
  get_tax_profile: "Reading the tax settings",
  tax_readiness: "Checking what the VAT features need",
  list_invoices: "Looking at invoices",
  invoice_readiness: "Checking what invoicing needs",
  list_customers: "Looking at customers",
  get_customer: "Reading the customer",
  list_subscriptions: "Looking at subscriptions",
  cart_reminder_stats: "Looking at cart reminders",
  wishlist_insights: "Looking at wishlists",
  list_emails: "Looking at emails",
  subscription_boxes: "Looking at subscription boxes",
  customer_insights: "Looking at customers",
  product_performance: "Looking at products' sales",
  sales_trend: "Working out the trend",
  sales_funnel: "Following carts to orders",
  analytics_overview: "Reading the analytics",
  explain_change: "Working out why sales changed",
  analytics_alerts: "Checking what needs a look",
  restock_suggestions: "Working out what to reorder",
  list_integrations: "Looking at integrations",
  email_customer: "Preparing the email",
  resend_order_email: "Preparing the email",
  set_stock: "Preparing the change",
  post_to_slack: "Preparing the message",
  list_experiments: "Looking at A/B tests",
  explain_results: "Reading the test's results",
  suggest_experiments: "Finding what to test",
  draft_experiment: "Making a draft test",
  start_experiment: "Preparing to start the test",
  stop_experiment: "Preparing to stop the test",
  apply_winner: "Preparing the choice",
  decide_approval: "Carrying out your answer",
  add_order_note: "Adding a note",
  mark_order_sent: "Preparing the shipment",
  cancel_booking: "Preparing the cancellation",
  archive_product: "Preparing the change",
  unpublish_page: "Preparing the change",
  refund_order: "Preparing the refund",
  create_discount: "Preparing the code",
  set_discount_active: "Preparing the change",
  create_campaign: "Preparing the campaign",
  set_campaign_active: "Preparing the change",
  get_recommendations: "Looking at recommendations",
  set_recommendations: "Preparing the recommendations change",
  add_recommendation_rule: "Preparing the rule",
  remove_recommendation_rule: "Preparing the change",
  check_recommendations: "Checking against past orders",
  get_bonus_program: "Looking at bonus credits",
  set_bonus_program: "Preparing the bonus change",
  adjust_customer_credits: "Preparing the credits change",
  get_affiliate_program: "Looking at the referral program",
  set_affiliate_program: "Preparing the referral change",
  block_affiliate: "Preparing the change",
  find_admin_page: "Finding the page",
  open_admin_page: "Opening the page",
  use_skill: "Getting the playbook",
  remember: "Remembering",
  forget: "Forgetting",
  recall: "Remembering",
  platform_overview: "Looking at Kaizen",
  list_access_requests: "Looking at requests",
  approve_access_request: "Preparing the approval",
  decline_access_request: "Preparing the answer",
  list_stores: "Looking at stores",
  get_store: "Reading the store",
  list_plans: "Looking at plans",
  list_owners: "Looking at owners",
  get_owner: "Reading the owner",
  plan_reminder_stats: "Looking at plan reminders",
  list_platform_emails: "Looking at emails",
  list_ab_tests: "Looking at the stores' A/B tests",
  explain_ab_test: "Reading the test's results",
  platform_ai_usage: "Looking at AI usage",
  get_referral_program: "Looking at referrals",
  set_referral_program: "Preparing the referral change",
  get_my_referrals: "Looking at your referrals",
  ai_usage: "Looking at AI usage",
  ask_kaizen_life: "Asking Kaizen Life",
};
