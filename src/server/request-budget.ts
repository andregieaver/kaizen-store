import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addressPrefix } from "@/lib/client-address";

import { log } from "./log";

/**
 * Budgets on a store's costly public endpoints (D314, `docs/capacity.md` step 3.2), so one busy or misbehaving visitor or store cannot
 * slow the others: counters in `commerce.chat_usage` (the same table and upsert as the chat's and the ECB's limits), bucket
 * `budget:{endpoint}` for the store and `budget:{endpoint}:{visitor}` for one visitor, whose key is the chat's daily-changing hash
 * (`visitorKey()`), never an address. Ceilings against abuse, generous enough that a real shop never meets them; never used on a page
 * load, the cart, checkout, payment or a webhook. `pruneChatUsage()` removes the rows after two days.
 */

export type BudgetWindow = "minute" | "hour";

/** The ceilings, per window: what one visitor and one store may ask of an endpoint. */
export const BUDGETS = {
  suggest: { window: "minute", visitor: 120, store: 6000 },
  // A product feed (D302): channels fetch a few times a day; the visitor is the feed's address.
  feed: { window: "hour", visitor: 60, store: 600 },
  // A private store's password (D339): a few tries a minute for one visitor, the store's own ceiling against guessing from many.
  unlock: { window: "minute", visitor: 10, store: 120 },
  // A shopping agent's calls to the store's MCP endpoint (D353): the visitor is a daily hash of the caller's address.
  agent: { window: "minute", visitor: 60, store: 1200 },
  // The Admin API (D355): 120 calls a minute per token (the visitor is the token's id), a store's tokens together ten times that.
  api: { window: "minute", visitor: 120, store: 1200 },
  // The supplier API (D553): a drop-shipping supplier's system polls its orders and posts tracking and stock (the visitor is the supplier's id).
  supply: { window: "minute", visitor: 60, store: 600 },
  // 46elks posting a store's replies and delivery reports (D565): the visitor is the start of the store's inbound key; a campaign's reports
  // come at 46elks's pace (100 texts a minute an account), the whole platform's under one ceiling.
  sms: { window: "minute", visitor: 600, store: 6000 },
  // The storefront API (D362): a headless site's calls, its visitors' together under one token (the visitor is the token's id).
  storefront: { window: "minute", visitor: 1200, store: 6000 },
  // A cookie choice (D58, D389 SEC-10): a visitor makes a few; the store's ceiling stops a flood of records from many.
  consent: { window: "minute", visitor: 20, store: 3000 },
  // A browser's versions of the running A/B tests (D148, D389 SEC-10): asked once a page view at most.
  ab: { window: "minute", visitor: 60, store: 6000 },
  // The site-wide Report-Only policy's reports (D389 SEC-05), counted under no store: the whole platform shares the ceiling.
  csp: { window: "minute", visitor: 20, store: 2000 },
  // Notices of illegal content on Kaizena Flow's form (DSA art. 16, D411): each sends email and an AI reading, so a few an hour from one
  // visitor (past it, refused). Past the whole site's 30 a notice is still kept, without its emails or its first AI reading, so a few
  // senders cannot keep everyone else's notices out (`sendContentReport()`).
  report: { window: "hour", visitor: 5, store: 30 },
  // The docs' "Was this page helpful?" (D442): a yes or no and a sentence a page; one reader reads many pages in an hour, a flood of
  // answers from many is stopped by the whole site's ceiling, counted under no store.
  docs_feedback: { window: "hour", visitor: 60, store: 3000 },
  // The docs' search (D443): the dialog asks once a pause in typing and the search page once a search, so two a second at most from one
  // reader; the whole site's ceiling (under no store) stops a flood from many. Each search may ask the platform's AI for its words' vector,
  // which costs money, so a failed count refuses (`FAIL_CLOSED`) rather than letting searches through unmetered.
  docs_search: { window: "minute", visitor: 120, store: 6000 },
  // A docs page read, for *Most read* (D443): one a page view, and one reader's same page counts once an hour anyway.
  docs_read: { window: "hour", visitor: 600, store: 60000 },
  // A search of the docs that found nothing, for their gap list (D443): one reader's same search counts once an hour anyway.
  docs_miss: { window: "hour", visitor: 60, store: 3000 },
  // The docs guide (D444): each message asks the platform's AI, so a reader sends a few a minute at most (beside the chat's own 30 per ten
  // minutes and the guide's daily limit, `takeChatTurn()`); the whole site's ceiling stops a flood from many. A failed count refuses.
  docs_guide: { window: "minute", visitor: 10, store: 600 },
  // Wrong admin passwords kept in the audit log (PSI SEC-02, SEC-11), which keeps entries 24 months: one visitor trying many addresses
  // writes at most this many an hour, the whole platform ten times more. The tries are still counted per address beyond it.
  sign_in_audit: { window: "hour", visitor: 20, store: 600 },
  // The owner MCP (D439, `takeMcpBudget()`): 120 calls a minute a grant (Kaizen Life's: a person) across its stores; a store's outside
  // assistants and apps together ten times that.
  mcp: { window: "minute", visitor: 120, store: 1200 },
  // The authorization server's token and revocation endpoints (D439), per address: a backstop, generous because a hosted client (claude.ai,
  // ChatGPT) swaps codes and refreshes for many people from a few addresses; `oauth_token` counts each client.
  oauth: { window: "minute", visitor: 600, store: 60000 },
  // The same endpoints per client (D439 review): the visitor is the client's id (hashed), the store bucket the whole site's. Charged only
  // for a request that proved itself (`chargeClient()`): made-up codes naming a client are paid for by their addresses, never by it.
  oauth_token: { window: "minute", visitor: 3000, store: 30000 },
  // Registering a client (RFC 7591, D439): ten an hour from one address, the whole platform's ceiling against a flood.
  oauth_register: { window: "hour", visitor: 10, store: 1000 },
  // Fetching a client's metadata document for an authorization request (D439): the server fetches an address a visitor names, so a few
  // an hour from one address and a ceiling for the site; a document already kept is not fetched again.
  oauth_fetch: { window: "hour", visitor: 30, store: 3000 },
  // Kaizen Life's account link (docs/life-work-summary.md 3.3): lookups, links and unlinks from Kaizen Life's server, counted under no store;
  // the visitor is the door. A ceiling against a loop on Life's side, never met by people signing up.
  life_link: { window: "minute", visitor: 300, store: 900 },
  // The Work summary Kaizen Life reads for a linked account: the visitor is the account, the whole site's ceiling under no store.
  life_summary: { window: "minute", visitor: 60, store: 6000 },
  // Tasks the assistants hand each other (docs/assistants-together.md step 2), and Kaizen Life's reports on them: the visitor is the Kaizen
  // Life user, the whole site's ceiling under no store. Beside the day's cap of tasks (`HANDOFFS_PER_DAY`).
  life_handoff: { window: "minute", visitor: 30, store: 3000 },
  // Making a page builder sandbox (D457): each is a copied store, so a few an hour from one network and a ceiling for the whole site,
  // counted under no store; a failed count refuses. The platform's daily cap (`platform_settings.sandbox_daily_cap`) stands beside it.
  sandbox: { window: "hour", visitor: 5, store: 200 },
  // A sandbox copying a Google Fonts family into Kaizena Flow's shared fonts (D457): the visitor is the sandbox's id.
  sandbox_font: { window: "hour", visitor: 20, store: 600 },
  // A sandbox placing a template or a theme's section (D457), each copying its pictures into the sandbox's library: the visitor is the
  // sandbox's id, the ceiling the whole site's.
  sandbox_copy: { window: "hour", visitor: 30, store: 1500 },
  // A sandbox's call to the platform's AI (D457 S3): beside its allowance in money, a count, since a model with no price set costs nothing
  // there. The visitor is the sandbox's id, the ceiling the whole site's; a failed count refuses, as the AI costs money.
  sandbox_ai: { window: "hour", visitor: 20, store: 600 },
} as const satisfies Record<string, { window: BudgetWindow; visitor: number; store: number }>;

export type BudgetEndpoint = keyof typeof BUDGETS;

/**
 * Endpoints a failed count refuses rather than allows (PSI SEC-10): guessing a password must not get easier while the database struggles,
 * nor the notice form become a way to send mail from Kaizena Flow's address, nor the docs' search or guide a way to spend the platform's AI
 * unmetered (D443: each search may embed its words; D444: each message to the guide asks its text model), nor the sandbox a way to copy
 * stores or call the AI unmetered (D457).
 */
export const FAIL_CLOSED: ReadonlySet<BudgetEndpoint> = new Set<BudgetEndpoint>(["unlock", "report", "oauth_register", "oauth_fetch", "docs_search", "docs_guide", "sandbox", "sandbox_ai"]);

/** The bucket names of an endpoint, for the store and a visitor. */
export function budgetBuckets(endpoint: BudgetEndpoint, visitor: string): { store: string; visitor: string } {
  return { store: `budget:${endpoint}`, visitor: `budget:${endpoint}:${visitor}` };
}

/**
 * A visitor as a budget knows them from the request: a hash of their address that changes every day (as the chat's `visitorKey()`), so
 * it names no one and is never kept beyond the counters' two days.
 */
export function budgetVisitor(headers: Headers): string {
  // An IPv6 caller by its /64 (D439 review): every address of one network counts as one.
  const address = addressPrefix(headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "");
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-budget`).digest("hex").slice(0, 32);
}

/** Whether one ask was within each budget: the visitor's and the store's (or, under no store, the whole site's). */
export type BudgetRoom = { visitor: boolean; store: boolean };

/**
 * Counts one ask and says, for each budget, whether it is within it; `storeId` null is Kaizena Flow's own site (its counters, `store_id`
 * null, are one bucket as the table's key treats nulls as equal). The store's (or site's) bucket counts an ask only when the visitor's own
 * was within its ceiling (D439 review): one caller past its own limit can never use up everyone's. Counting never blocks the answer when
 * the database is busy: a failure allows, except for an endpoint in `FAIL_CLOSED`, where a guess is what the budget stops (a private
 * store's password).
 */
export async function budgetRoom(storeId: string | null, endpoint: BudgetEndpoint, visitor: string): Promise<BudgetRoom> {
  const budget = BUDGETS[endpoint];
  const buckets = budgetBuckets(endpoint, visitor);
  const window = budget.window === "minute" ? sql`date_trunc('minute', now())` : sql`date_trunc('hour', now())`;
  try {
    const [row] = await db().execute<{ visitor: number; store: number | null }>(sql`
      with mine as (
        insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, ${buckets.visitor}, ${window}, 1)
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
        returning count
      ), everyone as (
        insert into commerce.chat_usage (store_id, bucket, "window", count)
        select ${storeId}::uuid, ${buckets.store}, ${window}, 1 from mine where mine.count <= ${budget.visitor}
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
        returning count
      )
      select (select count from mine) as visitor, (select count from everyone) as store
    `);
    const mine = Number(row?.visitor ?? 0);
    // Past its own ceiling the ask was not counted for everyone: the store's room is not known, and the visitor is refused anyway.
    return { visitor: mine <= budget.visitor, store: row?.store == null ? true : Number(row.store) <= budget.store };
  } catch (error) {
    log("warn", "budget.count_failed", { endpoint }, error);
    const open = !FAIL_CLOSED.has(endpoint);
    return { visitor: open, store: open };
  }
}

/**
 * One call of the owner MCP (D439): counted for its grant across every store it reaches (`budget:mcp:{grant}`, under no store, so a grant's
 * calls to many stores share one budget) and, when it names a store, for that store's outside callers together (`budget:mcp`). Both must
 * have room; a failed count allows, as the API's does.
 */
export async function takeMcpBudget(grantKey: string, storeId: string | null): Promise<boolean> {
  const budget = BUDGETS.mcp;
  const buckets = budgetBuckets("mcp", grantKey);
  try {
    // The store's bucket counts a call only when the grant's own was within its ceiling, so one grant cannot use up a store's (D439 review).
    const [row] = await db().execute<{ mine: number; store: number | null }>(sql`
      with mine as (
        insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${buckets.visitor}, date_trunc('minute', now()), 1)
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
        returning count
      ), everyone as (
        insert into commerce.chat_usage (store_id, bucket, "window", count)
        select ${storeId}::uuid, ${buckets.store}, date_trunc('minute', now()), 1 from mine where ${storeId !== null} and mine.count <= ${budget.visitor}
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
        returning count
      )
      select (select count from mine) as mine, (select count from everyone) as store
    `);
    if (Number(row?.mine ?? 0) > budget.visitor) return false;
    return !storeId || Number(row?.store ?? 0) <= budget.store;
  } catch (error) {
    log("warn", "budget.count_failed", { endpoint: "mcp" }, error);
    return true;
  }
}

/** Counts one ask and says whether it is within both budgets (`budgetRoom()`). */
export async function takeBudget(storeId: string | null, endpoint: BudgetEndpoint, visitor: string): Promise<boolean> {
  const room = await budgetRoom(storeId, endpoint, visitor);
  return room.visitor && room.store;
}
