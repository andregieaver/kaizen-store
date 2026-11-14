import { z } from "zod";

import { BRAND_TOOLS, RESEARCH_TOOLS, SITE_TOOLS, tool, type OwnerTool } from "./owner-tools";
import { savePlatformMenuInput, setPlatformPlaceInput } from "./site-tools";
import { FOLLOW_UP_REPEATS, TASK_MAX } from "./follow-ups";
import { goalTargetInput, TARGETS_MAX } from "./autopilot-goals";
import { planInput } from "./autopilot-plans";
import { SKILL_TITLE_MAX, SKILL_WHEN_MAX } from "./saved-skills";
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
    "Loads a skill: the playbook for a job, from the list in your instructions (built in, or saved by the person). Load it before doing that job, then follow it.",
    z.object({ skill: z.string().trim().min(1).max(60) }),
  ),
  tool(
    "save_skill",
    "Saves a skill for the person (D350): a way of doing a job they come back to, in their words, which you load with use_skill next time. Give skill (its key) to change one of theirs. Never with a customer's details, an email address, a password or a marketing claim. Use it when they ask you to remember how they want a job done, or to save what you just did as a skill.",
    z.object({
      skill: z.string().trim().max(60).optional().describe("To change one of theirs: its key from the list in your instructions."),
      title: z.string().trim().min(1).max(SKILL_TITLE_MAX).describe("A short name, such as 'Weekly stock check'."),
      when: z.string().trim().max(SKILL_WHEN_MAX).default("").describe("When to use it, in one line."),
      steps: z.array(z.string().trim().min(1).max(500)).min(1).max(20).describe("The steps, each a short line naming the tools or pages to use."),
    }),
  ),
  tool(
    "delete_skill",
    "Deletes one of the person's saved skills, by its key. Use it when they no longer want it.",
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
    "The person's own referrals (Kaizena Flow's referral program): their link and code, visits, how many asked for a store, the stores that opened through it with the credit each earned, and their credit per currency, usable and waiting. Answers only from their own account; it never shows a referred store's customers or orders.",
    z.object({}),
  ),
  tool(
    "contact_kaizen_support",
    "Asks Kaizena Flow's own support for help on the person's behalf (D216): opens a conversation with Kaizena Flow with their summary as the first message, which Kaizena Flow's assistant and people answer under Your requests to Kaizena Flow. Use it when they want help from Kaizena Flow itself (a bug, billing with Kaizena Flow, something the admin cannot do), never for their customers. Needs their approval.",
    z.object({
      summary: z.string().trim().min(10).max(1000).describe("What they need help with, in their words, as the first message to Kaizena Flow."),
      store: z.string().trim().max(63).optional().describe("The store it is about (its address name), if any."),
    }),
    "send",
  ),
  tool(
    "decide_approval",
    "Carries out the person's answer to a change waiting for their yes (listed in your instructions with its id), when they answer it in words, spoken or typed, in this message. Approving needs a plain yes from them in this message; never approve what they did not clearly agree to.",
    z.object({ approval: z.uuid(), approve: z.boolean() }),
  ),
  tool(
    "follow_up",
    "Comes back to something later (PSI AGT-04): at the time, you are given the task in this conversation, do it with your tools, and they get an email that your answer is there. Use it when they ask you to remind them, check something again later, or check something regularly (\"every Monday, tell me what needs a look\": repeat weekly, with analytics_alerts and store_checkup then). It never approves anything: what needs their yes still waits for them.",
    z.object({
      task: z.string().trim().min(3).max(TASK_MAX).describe("What to do then, as a note to yourself in their words, such as 'Check whether order 1042 has been sent'."),
      at: z.string().trim().max(20).optional().describe("When, as YYYY-MM-DD HH:MM in the time zone of your instructions."),
      in_hours: z.number().min(0.1).max(8760).optional().describe("Or: how many hours from now."),
      repeat: z.enum(FOLLOW_UP_REPEATS).default("none").describe("none, daily or weekly: the same time of day again."),
    }),
  ),
  tool("list_follow_ups", "The follow-ups waiting for this person here: what, when and how often, with their ids.", z.object({})),
  tool(
    "cancel_follow_up",
    "Cancels a waiting follow-up, by its id from list_follow_ups. Use it when they no longer want it.",
    z.object({ follow_up: z.uuid() }),
  ),
  // The autopilot (D309, `docs/ai-autopilot.md` 7): goals, and plans whose steps run in the background in the person's name.
  tool(
    "set_goal",
    "Keeps one of the owner's goals for the business: their vision in their words and up to five targets measured from the store's own figures (net sales or orders in 30 days, conversion, open by a date, active products, published pages; on Kaizena Flow's own site published pages and open stores). Give goal to change an existing one. Use it when they say what they want to achieve; then offer a plan for it.",
    z.object({
      goal: z.uuid().optional().describe("To change an existing goal: its id from list_goals."),
      title: z.string().trim().min(1).max(120).describe("A short name, such as 'First 100 orders'."),
      vision: z.string().trim().max(2000).optional().describe("What they want, in their own words."),
      targets: z.array(goalTargetInput).max(TARGETS_MAX).default([]),
      due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("By when, YYYY-MM-DD."),
    }),
  ),
  tool("list_goals", "The goals here, each with its progress worked out from the store's own figures.", z.object({ all: z.boolean().default(false).describe("Also met and dropped ones.") })),
  tool("drop_goal", "Drops a goal they no longer want, by its id from list_goals.", z.object({ goal: z.uuid() })),
  tool(
    "make_autopilot_plan",
    "Makes a plan the autopilot carries out in the background, step by step, in the person's name: each step is one tool call with its arguments (kind tool), a task done with a few named tools from a brief (task), a question for the owner (question) or a wait (wait), with the steps it waits for and a check that says it worked. It is only a draft: show it in a few lines and ask whether to start it (start_autopilot_plan). Prefer tool steps where the arguments are known; use tasks for work that needs judgement; ask the owner only what only they can decide.",
    planInput,
  ),
  tool(
    "revise_autopilot_plan",
    "Replaces the steps of a plan that have not run yet (done steps stay, and new steps may wait for them). A running or paused plan becomes a draft again and must be started again.",
    z.object({ plan: z.uuid(), title: z.string().trim().min(1).max(120).optional(), summary: z.string().trim().max(2000).optional(), steps: planInput.shape.steps }),
  ),
  tool(
    "start_autopilot_plan",
    "Starts a draft plan, once the person has seen it: their yes starts exactly the version they saw. Needs their approval.",
    z.object({ plan: z.uuid() }),
    "plan",
  ),
  tool(
    "resume_autopilot_plan",
    "Resumes a paused plan, on the person's yes. Needs their approval.",
    z.object({ plan: z.uuid() }),
    "plan",
  ),
  tool("pause_autopilot_plan", "Pauses a running plan: no further step runs until it is resumed.", z.object({ plan: z.uuid() })),
  tool("stop_autopilot_plan", "Stops a plan for good: what it did stays, nothing more runs. Always allowed.", z.object({ plan: z.uuid() })),
  tool("get_autopilot_plan", "One plan with every step: what it does, its status, its result or problem, and what it asks.", z.object({ plan: z.uuid() })),
  tool("list_autopilot_plans", "The autopilot's plans here, running and recent, with their status and what waits.", z.object({ finished: z.boolean().default(false).describe("Also plans finished more than 30 days ago.") })),
  tool(
    "answer_autopilot_question",
    "Gives the owner's answer to a plan's question (a step that asks), when they answer it in this message: one of its options, in their words. Never answer for them.",
    z.object({ plan: z.uuid(), step: z.string().trim().min(1).max(40).describe("The step's key, such as s3."), answer: z.string().trim().min(1).max(500) }),
  ),
] as const satisfies readonly OwnerTool[];

const slug = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "An address is lower-case letters, digits and dashes.");

export const PLATFORM_TOOLS = [
  // Kaizena Flow's own site (D308 A2c): the store's website tools, on its own pages, menus, header and footer.
  tool(
    "list_pages",
    "Kaizena Flow's own pages or blog articles: id, title, address and whether they are published.",
    z.object({ type: z.enum(["page", "article"]).default("page") }),
  ),
  ...SITE_TOOLS,
  ...RESEARCH_TOOLS,
  ...BRAND_TOOLS,
  tool(
    "set_page_place",
    "Shows one of Kaizena Flow's own PUBLISHED pages as its front page, its blog or its 404 page, or the standard one again with page null (the theme store's pages are chosen from Themes). A page is in one place at a time. Needs the admin's approval.",
    setPlatformPlaceInput,
    "public",
  ),
  tool(
    "save_menu",
    "Makes one of Kaizena Flow's own menus or replaces its links, saved as the menu editor saves it: its pages and articles by id (list_pages), its front page, blog, sign-up and sign-in, categories and tags by slug, and web addresses. A menu shown on the site needs the admin's approval; a new one, or one shown nowhere, is saved at once. Read get_menus first.",
    savePlatformMenuInput,
    "public",
  ),
  tool(
    "support_overview",
    "Kaizena Flow's own support desk in figures (waiting now, with the AI or a person, tone alerts, today, and the last 30 days: the AI alone, hand-overs, first answer, missed, ratings, topics), and the stores' support in totals over the last 30 days: how many stores have it, conversations, how many wait now and the busiest stores, counts and rates only. A store's conversations are its own: never ask for or describe one. Rates and medians need 10 conversations; repeat what is missing when it says so.",
    z.object({}),
  ),
  tool(
    "platform_overview",
    "Kaizena Flow at a glance: stores by status, stores on a plan, access requests waiting, plans, and stores with their own AI.",
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
  tool("list_plans", "Kaizena Flow's plans: name, fee per sale, prices per currency and interval, and how many stores are on each.", z.object({})),
  tool(
    "list_owners",
    "Store owners and staff on Kaizena Flow with their stores and plans. `search` matches the name or email.",
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
    "The latest emails Kaizena Flow and the stores sent: what, to whom, from which store and whether they went out. `failed_only` shows those that did not.",
    z.object({ failed_only: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) }),
  ),
  tool(
    "get_referral_program",
    "Kaizena Flow's referral program: whether it is on, its commission, months, pending days and cookie days, and its totals per currency (referrers, referred stores, commission earned, credit used and credit owed). `referrers` lists the most active referrers with what they brought in and their credit.",
    z.object({ referrers: z.boolean().default(false), limit: z.number().int().min(1).max(25).default(10) }),
  ),
  tool(
    "set_referral_program",
    "Changes Kaizena Flow's referral program: switch it on or off, or change the commission (percent of the fees the referred store pays Kaizena Flow), the months a store earns it, the days earned credit waits before it can be used, or the days the referral cookie lasts. Leave out what should not change. A referral already made keeps the terms it was made with. Changes what Kaizena Flow pays out, so it is kept for the platform admin's approval.",
    z.object({
      enabled: z.boolean().optional(),
      percent: z.number().min(0).max(REFERRAL_COMMISSION_BPS_MAX / 100).optional().describe(`Commission in percent of the fees the referred store pays Kaizena Flow, 0 to ${REFERRAL_COMMISSION_BPS_MAX / 100}, at most two decimals.`),
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
    "How much of the AI every store and Kaizena Flow itself used in a period: requests and tokens in total, per provider and model, per store, per feature, and how much ran on Kaizena Flow's own key. Ask for one store or store owner account to see theirs, per provider and model.",
    z.object({
      days: z.number().int().min(1).max(365).default(30),
      store: z.string().trim().max(60).optional().describe("A store's address (slug) to look at only that store."),
      owner: z.string().trim().max(200).optional().describe("A store owner's email to look at only the stores they own."),
    }),
  ),
  tool(
    "store_usage",
    "What stores used this month (D314), measured by Kaizena Flow: storage, products, staff, domains, visits, server errors, emails, marketing emails and AI on Kaizena Flow's key. Ask for one store by its address for its lines against its limits, or for the stores using most of one thing. Figures are written in code; a figure not measured yet is said so. Read-only: limits are changed on Plans → Limits and a store's page.",
    z.object({
      store: z.string().trim().max(60).optional().describe("A store's address (slug) to look at only that store, against its limits."),
      top: z.enum(["storage_bytes", "products", "requests", "server_errors", "emails", "marketing_emails", "ai_cost_micros"]).default("storage_bytes").describe("Without a store: the stores using most of this."),
      limit: z.number().int().min(1).max(25).default(10),
    }),
  ),
] as const satisfies readonly OwnerTool[];

export type ManagerToolName = (typeof MANAGER_TOOLS)[number]["name"];
export type PlatformToolName = (typeof PLATFORM_TOOLS)[number]["name"];
export type ManagerToolInput<N extends ManagerToolName> = z.output<Extract<(typeof MANAGER_TOOLS)[number], { name: N }>["input"]>;
export type PlatformToolInput<N extends PlatformToolName> = z.output<Extract<(typeof PLATFORM_TOOLS)[number], { name: N }>["input"]>;

// Without a prototype, so a name such as `constructor` finds nothing (D439 review).
export const MANAGER_TOOLS_BY_NAME: Record<string, OwnerTool> = Object.assign(Object.create(null) as Record<string, OwnerTool>, Object.fromEntries(MANAGER_TOOLS.map((t) => [t.name, t])));
export const PLATFORM_TOOLS_BY_NAME: Record<string, OwnerTool> = Object.assign(Object.create(null) as Record<string, OwnerTool>, Object.fromEntries(PLATFORM_TOOLS.map((t) => [t.name, t])));

/**
 * The manager's own tools a turn an outside assistant asked for may use (D439): the ones that only read or guide within the store.
 * Remembering and recalling (the person's memories reach beyond what a grant gives), their referrals (the account's, beyond the store),
 * saving skills, follow-ups, goals, plans, Kaizena Flow's support and answering a kept change in words stay the person's own, in the admin.
 */
export const OUTSIDE_MANAGER_TOOLS: ReadonlySet<string> = new Set([
  "find_admin_page",
  "open_admin_page",
  "use_skill",
  "list_follow_ups",
  "list_goals",
  "get_autopilot_plan",
  "list_autopilot_plans",
]);

export { TOOL_WORDS } from "./tool-words";
