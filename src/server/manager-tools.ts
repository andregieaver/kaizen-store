import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ADMIN_PAGES, findPages, pageHref, pageOffered, pageParams, type SiteFlags } from "@/lib/admin-map";
import { groupUsage, summarizeUsage, withOwner } from "@/lib/ai-usage";
import { ASSISTANT_SKILLS } from "@/lib/assistant-skills";
import {
  MANAGER_TOOLS_BY_NAME,
  PLATFORM_TOOLS_BY_NAME,
  type ManagerToolInput,
  type ManagerToolName,
  type PlatformToolInput,
  type PlatformToolName,
} from "@/lib/manager-tools";
import { formatMoney } from "@/lib/money";
import { readToolInput } from "@/lib/owner-tools";
import { saysYes } from "@/lib/speech-text";
import { siteUrl } from "@/lib/site";

import type { AiConnection } from "./ai";
import { countStoresWithOwnAi } from "./ai";
import { usageRows } from "./ai-usage";
import { keepMemory, memoriesFor, deleteMemory } from "./assistant-memory";
import { audit, type Account } from "./auth";
import { getStoreBilling, listPlans, listStoreBilling } from "./billing";
import { listEmails } from "./email";
import { OwnerToolError } from "./owner-tools";
import { planReminderStats } from "./plan-reminders";
import { approveAccessRequest, declineAccessRequest, listAccessRequests } from "./platform";
import { getPlatformCustomer, listPlatformCustomers } from "./platform-customers";
import { getStore, type Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What the AI manager's own tools do (D103): guide through the admin
 * (find and open pages), load skills, and keep and use memories; and, on
 * the platform, Kaizen's own reads and the access-request decisions.
 */

export type ManagerContext = {
  account: Account;
  /** The store it works in; null on the platform. */
  store: Store | null;
  flags: SiteFlags;
  connection: AiConnection | null;
  /** Tells the person's browser to open a page. */
  navigate: (href: string, label: string) => void;
  invalidate: (tag: string) => void;
  /** The turn being answered, for deciding kept changes in words (D104); none outside a turn. */
  turn?: {
    conversationId: string;
    /** What the person said in this turn. */
    said: string;
    startedAt: Date;
    /** Runs the person's answer (`decideApproval()`), reporting it to their browser. */
    decide: (approvalId: string, approve: boolean) => Promise<{ status: string; outcome: string | null } | null>;
  };
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const area = (ctx: ManagerContext) => (ctx.store ? "store" : "platform");

// Guiding ------------------------------------------------------------------------------------

function describe(ctx: ManagerContext, page: (typeof ADMIN_PAGES)[number]) {
  const params = pageParams(page);
  return {
    id: page.id,
    title: page.title,
    group: page.group,
    what: page.what,
    ...(page.tasks && { can_do: page.tasks }),
    ...(params.length === 0 ? { href: pageHref(page, {}, ctx.store?.slug) } : { needs: params }),
  };
}

async function findAdminPage(ctx: ManagerContext, { question }: ManagerToolInput<"find_admin_page">) {
  const pages = findPages(area(ctx), question, ctx.flags);
  if (pages.length === 0) return { found: [], note: "No page matches. The map in your instructions lists every section." };
  return { found: pages.map((page) => describe(ctx, page)) };
}

async function openAdminPage(ctx: ManagerContext, { page: id, params }: ManagerToolInput<"open_admin_page">) {
  const page = ADMIN_PAGES.find((p) => p.id === id && (p.area === area(ctx) || p.area === "account"));
  if (!page) return fail(`There is no page "${id}". Use find_admin_page.`);
  if (!pageOffered(page, ctx.flags)) return fail(`${page.title} is not available here${page.needs === "owner" ? ": it is for owners" : ": its feature is off (Features)"}.`);
  const href = pageHref(page, params, ctx.store?.slug);
  if (!href) return fail(`${page.title} needs ${pageParams(page).join(", ")}: look it up first.`);
  ctx.navigate(href, page.title);
  return { opened: href, title: page.title, note: "The page is opening for them. Say what to do there in a line or two." };
}

async function useSkill(ctx: ManagerContext, { skill }: ManagerToolInput<"use_skill">) {
  const found = ASSISTANT_SKILLS.find((s) => s.id === skill && s.area === area(ctx));
  if (!found) return fail(`There is no skill "${skill}" here. The list is in your instructions.`);
  return { skill: found.id, title: found.title, steps: found.steps };
}

// Memory ----------------------------------------------------------------------------------

async function rememberTool(ctx: ManagerContext, { content, kind, everywhere }: ManagerToolInput<"remember">) {
  if (/\b\d{12,}\b|password|passord/i.test(content)) return fail("That looks like a secret or a card number: it is not kept.");
  const kept = await keepMemory({
    accountId: ctx.account.id,
    storeId: everywhere || !ctx.store ? null : ctx.store.id,
    kind,
    content,
    source: "told",
    connection: ctx.connection,
  });
  return { done: kept.merged ? "Updated what I knew." : "Remembered.", id: kept.id };
}

async function forgetTool(ctx: ManagerContext, { memory }: ManagerToolInput<"forget">) {
  return (await deleteMemory(ctx.account.id, memory)) ? { done: "Forgotten." } : fail("There is no such memory.");
}

async function recallTool(ctx: ManagerContext, { query }: ManagerToolInput<"recall">) {
  const found = await memoriesFor(ctx.account.id, ctx.store?.id ?? null, query, ctx.connection, 10);
  return found.map((m) => ({ id: m.id, kind: m.kind, content: m.content, about: m.storeName ?? "everywhere" }));
}

// Answers in words (D104) --------------------------------------------------------------------

/**
 * A change kept for approval, answered in words: only one of this
 * conversation's, asked for before this message, and approved only when
 * the message plainly says yes (`saysYes()`), whatever the model thinks.
 */
async function decideApprovalTool(ctx: ManagerContext, { approval, approve }: ManagerToolInput<"decide_approval">) {
  const turn = ctx.turn;
  if (!turn) return fail("Answers are given with the buttons here.");
  const [row] = await db().execute<Row>(sql`
    select summary, status, created_at from commerce.assistant_approvals
    where id = ${approval}::uuid and conversation_id = ${turn.conversationId}::uuid and account_id = ${ctx.account.id}::uuid
      and ${ctx.store ? sql`store_id = ${ctx.store.id}::uuid` : sql`store_id is null`}
  `);
  if (!row) return fail("There is no such change waiting in this conversation.");
  if (row.status !== "pending") return fail(`That change is already ${String(row.status)}.`);
  if (new Date(String(row.created_at)) >= turn.startedAt) return fail("They have not seen this change yet: ask them first.");
  if (approve && !saysYes(turn.said)) return fail("Their message is not a plain yes: ask them to confirm, or they can use the button.");
  const decided = await turn.decide(approval, approve);
  if (!decided) return fail("That change was already decided.");
  return approve
    ? { done: decided.status === "failed" ? `It could not be done: ${decided.outcome ?? ""}` : (decided.outcome ?? "Done."), what: String(row.summary) }
    : { done: "Declined; nothing was done.", what: String(row.summary) };
}

type Handler = (ctx: ManagerContext, input: never) => Promise<unknown>;

const MANAGER_HANDLERS: Record<ManagerToolName, Handler> = {
  find_admin_page: findAdminPage,
  open_admin_page: openAdminPage,
  use_skill: useSkill,
  remember: rememberTool,
  forget: forgetTool,
  recall: recallTool,
  decide_approval: decideApprovalTool,
};

export async function runManagerTool(ctx: ManagerContext, name: string, raw: unknown): Promise<unknown> {
  const tool = MANAGER_TOOLS_BY_NAME[name];
  if (!tool) return fail(`There is no tool called ${name}.`);
  const input = readToolInput(tool, raw);
  if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
  return MANAGER_HANDLERS[name as ManagerToolName](ctx, input.input as never);
}

// The platform ------------------------------------------------------------------------------

const money = (minor: number, currency: string) => formatMoney(minor, currency.toUpperCase(), "en-GB");
const percent = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} %`;

async function platformOverview() {
  const [[counts], plans, ownAi] = await Promise.all([
    db().execute<Row>(sql`
      select
        count(*) filter (where s.status = 'active')::int as open,
        count(*) filter (where s.status = 'setup')::int as in_setup,
        count(*) filter (where s.status not in ('active', 'setup', 'closed'))::int as other,
        (select count(*)::int from commerce.store_billing b where b.status in ('active', 'trialing')) as on_plan,
        (select count(*)::int from commerce.store_billing b where b.status in ('past_due', 'unpaid')) as plan_overdue,
        (select count(*)::int from commerce.access_requests r where r.status = 'pending') as requests_waiting
      from commerce.stores s where not s.is_template
    `),
    listPlans(),
    countStoresWithOwnAi(),
  ]);
  return {
    stores: { open: Number(counts.open), in_setup: Number(counts.in_setup), other: Number(counts.other) },
    stores_on_a_plan: Number(counts.on_plan),
    plans_overdue: Number(counts.plan_overdue),
    access_requests_waiting: Number(counts.requests_waiting),
    plans: plans.filter((p) => p.active).map((p) => ({ name: p.name, stores: p.stores })),
    stores_with_their_own_ai: ownAi,
  };
}

async function listRequests(_ctx: ManagerContext, { status }: PlatformToolInput<"list_access_requests">) {
  const rows = await listAccessRequests();
  return rows
    .filter((r) => status === "all" || r.status === "pending")
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      store_name: r.storeName,
      message: r.message.slice(0, 500),
      status: r.status,
      asked: r.createdAt,
      store: r.storeSlug,
      has_account: r.hasAccount,
    }));
}

async function findRequest(ref: string) {
  const rows = await listAccessRequests();
  const found = rows.find((r) => r.id === ref || r.email.toLowerCase() === ref.toLowerCase());
  if (!found) return fail(`No access request "${ref}". Use list_access_requests.`);
  if (found.status !== "pending") return fail(`${found.email}'s request is already ${found.status}.`);
  return found;
}

async function approveRequest(ctx: ManagerContext, { request, slug, store_name }: PlatformToolInput<"approve_access_request">) {
  const found = await findRequest(request);
  const result = await approveAccessRequest(ctx.account, found.id, slug, store_name || found.storeName, siteUrl());
  if (!result.ok) return fail(result.problems.join(" "));
  await audit(ctx.account.id, null, "platform.assistant.approve_access_request", { request: found.id, slug });
  return { done: `Approved: the store is at /s/${result.slug}${result.invited ? `, and ${result.email} got a sign-in link` : ", but the sign-in email could not be sent"}.` };
}

async function declineRequest(ctx: ManagerContext, { request }: PlatformToolInput<"decline_access_request">) {
  const found = await findRequest(request);
  await declineAccessRequest(ctx.account, found.id);
  await audit(ctx.account.id, null, "platform.assistant.decline_access_request", { request: found.id });
  return { done: `Declined ${found.email}'s request.` };
}

async function listStores(_ctx: ManagerContext, { search, limit }: PlatformToolInput<"list_stores">) {
  const q = search?.toLowerCase() ?? "";
  const rows = await listStoreBilling();
  return rows
    .filter((s) => !q || [s.name, s.slug, s.ownerEmail ?? ""].some((v) => v.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((s) => ({
      store: s.slug,
      name: s.name,
      owner: s.ownerEmail,
      plan: s.planName ?? "none",
      plan_status: s.status,
      fee: percent(s.feeBps),
      admin: `/admin/platform/stores/${s.slug}`,
    }));
}

async function getStoreTool(_ctx: ManagerContext, { store: slug }: PlatformToolInput<"get_store">) {
  const store = await getStore(slug);
  if (!store) return fail(`No store at ${slug}.`);
  const [billing, [counts]] = await Promise.all([
    getStoreBilling(store.id),
    db().execute<Row>(sql`
      select (select count(*)::int from commerce.products where store_id = ${store.id}::uuid and status = 'active') as products,
        (select count(*)::int from commerce.orders where store_id = ${store.id}::uuid and status in ('paid', 'fulfilled', 'closed')) as orders
    `),
  ]);
  return {
    store: store.slug,
    name: store.name,
    status: store.status,
    countries: store.markets.map((m) => m.code),
    payments: store.paymentsOn ? (store.paymentsTest ? "test mode" : "live") : "off",
    products_on_sale: Number(counts.products),
    paid_orders: Number(counts.orders),
    plan: billing?.planName ?? "none",
    plan_status: billing?.status ?? null,
    plan_price: billing?.price ? `${money(billing.price.amountMinor, billing.price.currency)} per ${billing.price.interval}` : null,
    renews: billing?.currentPeriodEnd ?? null,
    ending: billing?.cancelAtPeriodEnd ?? false,
    fee: billing ? percent(billing.feeBps) : null,
    discount: billing?.discount?.code ?? null,
    owner: billing?.ownerEmail ?? null,
    admin: `/admin/platform/stores/${store.slug}`,
  };
}

async function listPlansTool() {
  const plans = await listPlans();
  return plans.map((p) => ({
    name: p.name,
    active: p.active,
    fee: percent(p.saleFeeBps),
    stores: p.stores,
    prices: p.prices.filter((x) => x.active).map((x) => `${money(x.amountMinor, x.currency)} per ${x.interval}`),
  }));
}

async function listOwners(_ctx: ManagerContext, { search, limit }: PlatformToolInput<"list_owners">) {
  const rows = await listPlatformCustomers({ q: search ?? "", limit });
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    email: o.email,
    since: o.createdAt,
    stores: o.stores.map((s) => ({ store: s.slug, role: s.role, plan: s.planName ?? "none", plan_status: s.status })),
    admin: `/admin/platform/customers/${o.id}`,
  }));
}

async function getOwner(_ctx: ManagerContext, { owner }: PlatformToolInput<"get_owner">) {
  let id = /^[0-9a-f-]{36}$/i.test(owner) ? owner : null;
  if (!id) id = (await listPlatformCustomers({ q: owner, limit: 1 }))[0]?.id ?? null;
  const found = id ? await getPlatformCustomer(id) : null;
  if (!found) return fail(`No owner "${owner}". Use list_owners.`);
  return {
    name: found.name,
    email: found.email,
    platform_admin: found.platformAdmin,
    stores: found.stores.map((s) => ({ store: s.slug, role: s.role, plan: s.planName ?? "none", plan_status: s.status, renews: s.currentPeriodEnd })),
    unfinished_plan_checkouts: found.unpaidPlans.map((u) => ({ store: u.storeSlug, plan: u.planName, since: u.capturedAt, reminders: u.remindersSent })),
    admin: `/admin/platform/customers/${found.id}`,
  };
}

async function planReminders() {
  return { period: "all time", ...(await planReminderStats()) };
}

async function listPlatformEmails(_ctx: ManagerContext, { failed_only, limit }: PlatformToolInput<"list_platform_emails">) {
  const rows = await listEmails({ limit: failed_only ? 200 : limit });
  return rows
    .filter((e) => !failed_only || ["failed", "bounced", "complained"].includes(e.status))
    .slice(0, limit)
    .map((e) => ({ what: e.kind, to: e.to, subject: e.subject, store: e.storeName ?? "Kaizen", status: e.status, error: e.error, sent: e.createdAt }));
}

async function platformAiUsage(_ctx: ManagerContext, { days, store, owner }: PlatformToolInput<"platform_ai_usage">) {
  let storeId: string | null = null;
  let ownedBy: string | null = null;
  if (store) {
    const found = await getStore(store);
    if (!found) return fail(`No store at ${store}.`);
    storeId = found.id;
  }
  if (owner) {
    const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${owner})`);
    if (!account) return fail(`No account with the email ${owner}.`);
    ownedBy = String(account.id);
  }
  const rows = await usageRows({ days, storeId, ownedBy });
  const owners = groupUsage(rows, withOwner).slice(0, 12).map((g) => ({ owner: g.label, ...(g.sub && { email: g.sub }), requests: g.sums.requests, tokens: g.sums.inputTokens + g.sums.outputTokens }));
  return { period: `the last ${days} days, today included`, ...summarizeUsage(rows), by_store_owner_account: owners, admin: "/admin/platform/ai/usage" };
}

const PLATFORM_HANDLERS: Record<PlatformToolName, Handler> = {
  platform_overview: platformOverview,
  list_access_requests: listRequests,
  approve_access_request: approveRequest,
  decline_access_request: declineRequest,
  list_stores: listStores,
  get_store: getStoreTool,
  list_plans: listPlansTool,
  list_owners: listOwners,
  get_owner: getOwner,
  plan_reminder_stats: planReminders,
  list_platform_emails: listPlatformEmails,
  platform_ai_usage: platformAiUsage,
};

/** Runs a platform tool for a platform admin; gated ones only once approved. */
export async function runPlatformTool(ctx: ManagerContext, name: string, raw: unknown): Promise<unknown> {
  if (!ctx.account.platformAdmin) return fail("Only platform admins can do this.");
  const tool = PLATFORM_TOOLS_BY_NAME[name];
  if (!tool) return fail(`There is no tool called ${name}.`);
  const input = readToolInput(tool, raw);
  if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
  return PLATFORM_HANDLERS[name as PlatformToolName](ctx, input.input as never);
}
