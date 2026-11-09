import "server-only";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { publicEnv } from "@/lib/env";
import { isReadOnly, MCP_TOOLS, toolScope, type McpToolInfo } from "@/lib/mcp-catalogue";
import { missingScopes, protectedResourceMetadata, scopeKeys, STORES_READ, type AccessLevel, type OAuthScope } from "@/lib/oauth";
import { toolFeature, toolOffered } from "@/lib/owner-tool-features";
import { toolKey, toolRefusal } from "@/lib/owner-tool-permissions";
import { can } from "@/lib/permissions";
import { OWNER_TOOLS_BY_NAME, readToolInput } from "@/lib/owner-tools";
import { siteUrl } from "@/lib/site";

import { noticeApproval } from "./assistant-notices";
import { activeAccount, audit, holderOf, passMembership, type Account, type Membership } from "./auth";
import { log } from "./log";
import { getWorkSummary } from "./work-summary";
import { ACCESS_PREFIX, oauthAccess } from "./oauth";
import { clientConversation, keepForApproval, kaizenLifeConversation, runTurn, type AssistantEvent } from "./owner-assistant";
import type { OutsideAsker } from "./manager-tools";
import { gateNeeded, OwnerToolError, preflightOwnerTool, runOwnerTool } from "./owner-tools";
import { memberCan } from "./permissions";
import { getStore, type Store } from "./stores";
import { col, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * The store's MCP server (D96, wave 14 unit B D439): the owner assistant's tools, served to an outside AI assistant for the person who
 * connected it. Two kinds of bearer token are taken: an access token of Kaizena Flow's own authorization server (`kfa_`, D439), bound to
 * `/api/mcp` and to a grant whose scopes and stores the person chose, which acts as that person with what both the grant and their role in
 * the store allow now; and, as before, Kaizen Life's tokens from the store's Supabase OAuth server (`KAIZEN_LIFE_CLIENT_ID`), for an
 * account that owns stores. Every tool takes the store it is for; changes that send, publish or cost money (and under *Read and propose
 * changes* every change) are kept for the person's yes in the store's admin, never run from here.
 */

export type McpVia =
  | { kind: "kaizen-life" }
  | {
      kind: "oauth";
      grantId: string;
      client: { id: string; clientId: string; name: string; verified: boolean };
      scopes: string[];
      access: AccessLevel;
    };

export type McpCaller = {
  account: Account;
  stores: { id: string; slug: string; name: string }[];
  /** The assurance level of the token (`aal` claim, or the grant's): a store that requires two-step, and a platform admin, are served at `aal2` only (wave 1, 1f). */
  aal: "aal1" | "aal2";
  /** How the caller came: Kaizen Life's Supabase token, or a grant of Kaizena Flow's authorization server (D439). */
  via: McpVia;
};

/** The name a caller's client goes by: on approvals, notices and the audit log. */
export const clientName = (caller: Pick<McpCaller, "via">): string => (caller.via.kind === "oauth" ? caller.via.client.name : "Kaizen Life");

/** Who a bearer token is: a person through one of our grants (`kfa_`), or an owner with the stores they own if the token is Kaizen Life's. */
export async function mcpCaller(token: string): Promise<McpCaller | null> {
  if (token.startsWith(ACCESS_PREFIX)) return oauthCaller(token);
  const clientId = process.env.KAIZEN_LIFE_CLIENT_ID?.trim();
  if (!clientId || token.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  let claims: Record<string, unknown> | null = null;
  try {
    const env = publicEnv();
    const supabase = createSupabase(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data) return null;
    claims = data.claims as Record<string, unknown>;
    if (claims.iss !== `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`) return null;
  } catch {
    return null;
  }
  return callerFromClaims(claims, clientId);
}

/** The caller for verified claims: Kaizen Life's client, not expired, an active account that owns stores. */
export async function callerFromClaims(claims: Record<string, unknown>, clientId: string): Promise<McpCaller | null> {
  if (claims.client_id !== clientId || typeof claims.sub !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  return ownerCaller(sql`a.auth_user_id = ${claims.sub}::uuid`, claims.aal === "aal2" ? "aal2" : "aal1");
}

/**
 * Kaizen Life's assistant over the account link (docs/assistants-together.md): the linked account, owner of the stores it owns, at the
 * assurance of the session that switched the assistants on in Kaizena Flow. The same caller as Kaizen Life's tokens (D96), so the same
 * rules hold: owners' stores only, changes kept for the owner's yes in the admin, a platform admin and a two-step store at `aal2` only.
 */
export async function callerOfLink(accountId: string, aal: "aal1" | "aal2"): Promise<McpCaller | null> {
  return ownerCaller(sql`a.id = ${accountId}::uuid`, aal);
}

/** An active account that owns stores, as Kaizen Life's caller: the stores it owns that are open to it at this assurance. */
async function ownerCaller(who: SQL, aal: "aal1" | "aal2"): Promise<McpCaller | null> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, a.name, a.platform_admin, s.id as store_id, s.slug, s.name as store_name, s.require_two_step
    from commerce.accounts a
    join commerce.store_members m on m.account_id = a.id and m.role = 'owner' and m.disabled_at is null
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
      -- Never a store the platform keeps for itself (a store template's frozen copy, a design profile's workspace, D177).
      and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
    where ${who} and a.disabled_at is null
    order by s.name
  `);
  if (rows.length === 0) return null;
  const first = rows[0];
  // A platform admin works at the second step only, wherever they sign in: a token that did not pass it is refused whole.
  if (first.platform_admin && aal !== "aal2") return null;
  // A store that requires two-step is not served to a token that did not pass it, as its admin is not.
  const served = rows.filter((row) => aal === "aal2" || !row.require_two_step);
  if (served.length === 0) return null;
  return {
    account: { id: String(first.id), email: String(first.email), name: first.name ? String(first.name) : null, platformAdmin: Boolean(first.platform_admin) },
    stores: served.map((row) => ({ id: String(row.store_id), slug: String(row.slug), name: String(row.store_name) })),
    aal,
    via: { kind: "kaizen-life" },
  };
}

/**
 * The caller for one of our access tokens (D439): its grant live and for `/api/mcp` (`oauthAccess()`), its person's account active, and of
 * the grant's stores those where the person is a member now (a person removed from a store loses it at once), not closed, and, for a grant
 * approved without the second step, none that requires it. A platform admin's grant must have been approved at `aal2`.
 */
export async function oauthCaller(token: string): Promise<McpCaller | null> {
  const grant = await oauthAccess(token, "mcp");
  if (!grant) return null;
  const account = await activeAccount(grant.accountId);
  if (!account) return null;
  if (account.platformAdmin && grant.aal !== "aal2") return null;
  const rows = await typedRows(
    z.object({ id: col.uuid, slug: col.text, name: col.text, require_two_step: col.bool }),
    sql`
      select s.id, s.slug, s.name, s.require_two_step from commerce.stores s
      join commerce.store_members m on m.store_id = s.id and m.account_id = ${account.id}::uuid
        and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      where s.id = any(${grant.storeIds.length ? sql`array[${sql.join(grant.storeIds.map((id) => sql`${id}::uuid`), sql`, `)}]` : sql`'{}'::uuid[]`})
        and s.status <> 'closed'
        and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
      order by s.name, s.slug
    `,
  );
  return {
    account,
    stores: rows.filter((row) => grant.aal === "aal2" || !row.require_two_step).map(({ id, slug, name }) => ({ id, slug, name })),
    aal: grant.aal,
    via: { kind: "oauth", grantId: grant.grantId, client: grant.client, scopes: grant.scopes, access: grant.access },
  };
}

// The tools ------------------------------------------------------------------------------

/** The tools and their catalogue (titles and annotations, D438) are pure: `src/lib/mcp-catalogue.ts`. */
export { MCP_TOOLS, type McpToolInfo };

/**
 * The person's membership of the store a call names, if the caller reaches it: Kaizen Life's owner as an owner; a grant's person as their
 * membership is now (`passMembership()`), capped by the grant's scopes (`Membership.limit`), so every check the tools make asks both.
 */
async function memberFor(caller: McpCaller, slug: unknown): Promise<Membership | null> {
  const reached = caller.stores.find((s) => s.slug === slug);
  if (!reached) return null;
  if (caller.via.kind === "kaizen-life") {
    const store = await getStore(reached.slug);
    return store ? { account: caller.account, store, role: "owner" } : null;
  }
  const member = await passMembership(reached.slug, caller.account.id);
  return member ? { ...member, limit: scopeKeys(caller.via.scopes) } : null;
}

/**
 * The tools listed to a caller (D178, D439): a tool behind a store feature only when one of its stores has it on; through a grant, only
 * the tools whose scope the grant holds and that the person may use in at least one of its stores now. A call still names its store, and
 * is refused there when the feature is off or the person may not (`runOwnerTool()`, `preflightOwnerTool()`).
 */
export async function mcpToolsFor(caller: McpCaller): Promise<McpToolInfo[]> {
  if (caller.via.kind === "kaizen-life") {
    const stores = (await Promise.all(caller.stores.map((s) => getStore(s.slug)))).filter((s): s is Store => s !== null);
    return MCP_TOOLS.filter((tool) => toolFeature(tool.name) === undefined || stores.some((store) => toolOffered(store, tool.name)));
  }
  const scopes = caller.via.scopes;
  const members = (await Promise.all(caller.stores.map((s) => memberFor(caller, s.slug)))).filter((m): m is Membership => m !== null);
  return MCP_TOOLS.filter((tool) => {
    const scope = toolScope(tool.name);
    if (!scope || missingScopes(scopes, [scope]).length > 0) return false;
    if (scope === STORES_READ) return true;
    return members.some((member) => memberCan(member, scope) && (toolFeature(tool.name) === undefined || toolOffered(member.store, tool.name)));
  });
}

/**
 * The scopes a call needs that the caller's grant does not hold (B3): empty for Kaizen Life's tokens, a tool of no scope, and a grant that
 * holds them. A batch's calls answer one challenge with every scope they need (`insufficientScopeChallenge()`).
 */
export function scopesMissing(caller: McpCaller, name: string): OAuthScope[] {
  if (caller.via.kind !== "oauth") return [];
  const scope = toolScope(name);
  return scope ? missingScopes(caller.via.scopes, [scope]) : [];
}

/** The scope a call needs, for the challenge's list: what the tool asks, whether or not the grant holds it. */
export const scopeNeeded = (name: string): OAuthScope | null => toolScope(name);

/** The store a call names, if the caller reaches it: what its budget is counted under. */
export const storeOfCall = (caller: McpCaller, args: Record<string, unknown>): string | null => caller.stores.find((s) => s.slug === args.store)?.id ?? null;

export type McpToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: unknown, isError = false): McpToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError && { isError: true }),
});

const askInput = z.object({ store: z.string(), question: z.string().trim().min(1).max(4000), continue_admin_conversation: z.boolean().optional() });

/** How recent the owner's admin conversation must be for an outside assistant to go on in it (PSI AGT-13). */
const RESUME_HOURS = 24;

/** The owner's latest conversation with the store's assistant in the admin, if it is recent enough to go on in; else null. */
export async function recentAdminConversation({ store, account }: Membership): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select id from commerce.assistant_conversations
    where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid and source = 'admin'
      and updated_at > now() - make_interval(hours => ${RESUME_HOURS})
    order by updated_at desc limit 1
  `);
  return row ? String(row.id) : null;
}

/** Who asks, for the AI manager: the client's name, how it came, its grant, and whether the grant only proposes changes. */
const outsideOf = (caller: McpCaller): OutsideAsker =>
  caller.via.kind === "oauth"
    ? { client: clientName(caller), via: "oauth", grantId: caller.via.grantId, propose: caller.via.access === "propose" }
    : { client: clientName(caller), via: "kaizen-life", propose: false };

/** The caller's conversation in a store: Kaizen Life's, or the client's for this person ("From Claude"). */
const conversationOf = (caller: McpCaller, member: Membership): Promise<string> =>
  caller.via.kind === "oauth" ? clientConversation(member, caller.via.client) : kaizenLifeConversation(member);

/**
 * Every call is written in the store's activity log with the client that made it (`via: "mcp"`, D439), refused ones too (a scope the
 * grant lacks, a store it does not reach): under no store, in the person's account. The tool's name is kept only when it is a tool, so a
 * made-up name is never written. Never stops the answer.
 */
export async function auditCall(caller: McpCaller, storeId: string | null, tool: string, outcome: "done" | "kept" | "refused" | "failed", why?: "scope" | "store"): Promise<void> {
  try {
    await audit(
      caller.account.id,
      storeId,
      "integration.mcp_call",
      {
        via: "mcp",
        client: clientName(caller),
        ...(caller.via.kind === "oauth" && { client_id: caller.via.client.clientId, grant: caller.via.grantId }),
        tool: toolScope(tool) ? tool : "unknown",
        outcome,
        ...(why && { why }),
      },
      storeId ? {} : { area: "account" },
    );
  } catch (error) {
    log("error", "store_mcp.audit_failed", { tool }, error);
  }
}

/** One tool call from an outside assistant, for its person: answered, refused or kept for approval. */
export async function callMcpTool(
  caller: McpCaller,
  name: string,
  args: Record<string, unknown>,
  invalidate: (tag: string) => void,
): Promise<McpToolResult> {
  // The route answers a missing scope with its challenge first; this holds the rule here too.
  if (scopesMissing(caller, name).length > 0) {
    await auditCall(caller, null, name, "refused", "scope");
    return text(`This connection was not given what ${toolScope(name) ? name : "that tool"} needs.`, true);
  }
  if (name === "list_stores") {
    await auditCall(caller, null, name, "done");
    return text({ stores: caller.stores.map(({ slug, name: storeName }) => ({ slug, name: storeName })) });
  }
  if (name === "work_summary") {
    // Across the stores the caller reaches; Work's own rule (`settings:read` in the person's role) picks among them.
    const summary = await getWorkSummary(caller.account, { onlyStores: new Set(caller.stores.map((s) => s.slug)) });
    await auditCall(caller, null, name, "done");
    return text(summary);
  }
  const member = await memberFor(caller, args.store);
  if (!member) {
    await auditCall(caller, null, name, "refused", "store");
    return text(`"${String(args.store ?? "").slice(0, 100)}" is not one of the stores this connection reaches. Use list_stores.`, true);
  }
  const outcome = await callInStore(caller, member, name, args, invalidate);
  await auditCall(caller, member.store.id, name, outcome.outcome);
  return outcome.result;
}

type Outcome = { result: McpToolResult; outcome: "done" | "kept" | "refused" | "failed" };
const refused = (message: string): Outcome => ({ result: text(message, true), outcome: "refused" });

/** What a call that would change a suspended or closed store (D171) is answered: it only reads and handles what already happened. */
const STORE_NOT_OPEN = "This store is not open: only reading, and handling what already happened, can be done in it.";

async function callInStore(caller: McpCaller, member: Membership, name: string, args: Record<string, unknown>, invalidate: (tag: string) => void): Promise<Outcome> {
  if (name === "ask_store_assistant") {
    // The AI manager is the owner's (`/assistant` needs `owner`), and through a grant its scope too.
    if (!memberCan(member, "owner")) return refused("Only the store's owner can ask its assistant.");
    const input = askInput.safeParse(args);
    if (!input.success) return refused("Ask a question in words.");
    const result = await askStoreAssistant(caller, member, input.data.question, invalidate, input.data.continue_admin_conversation === true);
    return { result, outcome: result.isError ? "failed" : "done" };
  }

  // A name that is no tool, `constructor` and `toString` included, is refused: never looked up on an object's prototype (D439 review).
  const tool = Object.hasOwn(OWNER_TOOLS_BY_NAME, name) ? OWNER_TOOLS_BY_NAME[name] : undefined;
  if (!tool) return refused("There is no such tool.");
  // What the member may do in this store now, as `tools/list` asks it: a suspended or closed store (D171) only reads.
  const key = toolKey(name);
  if (!key || !memberCan(member, key)) return refused(key && member.store.status !== "active" && can(holderOf(member), key) ? STORE_NOT_OPEN : toolRefusal(name));
  const { store: _store, ...rest } = args;
  void _store;
  const ctx = { account: member.account, store: member.store, invalidate, holder: holderOf(member) };
  const gated = Boolean(tool.gate) && (await gateNeeded(member.store, name, rest));
  // Under *Read and propose changes* every change waits for a yes, gated or not (D439).
  const proposed = !gated && caller.via.kind === "oauth" && caller.via.access === "propose" && !isReadOnly(tool);
  if (gated || proposed) {
    const input = readToolInput(tool, rest);
    if (!input.ok) return refused(`The arguments could not be read: ${input.problem}`);
    try {
      await preflightOwnerTool(ctx, name, rest);
    } catch (error) {
      if (error instanceof OwnerToolError) return refused(error.message);
      log("error", "store_mcp.preflight_failed", { tool: name }, error);
      return { result: text("The tool failed.", true), outcome: "failed" };
    }
    // A yes is given in the AI manager, which is the owner's: a member who cannot open it gets nothing kept they could never answer.
    if (!memberCan(member, "owner")) return refused("This change waits for a yes in the store's AI manager, which only its owner uses: nothing was done.");
    const outside = outsideOf(caller);
    const conversation = await conversationOf(caller, member);
    const approval = await keepForApproval(
      { account: member.account, store: member.store, invalidate, outside },
      conversation,
      name,
      gated && tool.gate ? tool.gate : "change",
      input.input as Record<string, unknown>,
    );
    // The person hears of it in the admin too (D350): the change waits in this conversation, the client named on it.
    await noticeApproval(approval, conversation, member.account.id, member.store.id);
    return {
      result: text({
        kept_for_approval: true,
        what: approval.summary,
        where: `${siteUrl()}/admin/${member.store.slug}/assistant?c=${conversation}`,
        note: "Not done yet: the owner approves or declines it in Kaizena Flow's admin.",
      }),
      outcome: "kept",
    };
  }
  try {
    return { result: text(await runOwnerTool(ctx, name, rest)), outcome: "done" };
  } catch (error) {
    if (error instanceof OwnerToolError) return refused(error.message);
    log("error", "store_mcp.tool_failed", { tool: name }, error);
    return { result: text("The tool failed.", true), outcome: "failed" };
  }
}

/**
 * An outside assistant asking the store's (D96, D439): a turn in its conversation for this person (or the owner's admin conversation when
 * asked to go on in it), answered with the store's tools and the manager's reading ones, never asking Kaizen Life back. Changes wait for
 * the person's yes in the admin; an answer in words from the assistant never gives it.
 */
async function askStoreAssistant(caller: McpCaller, member: Membership, question: string, invalidate: (tag: string) => void, resume = false): Promise<McpToolResult> {
  // Going on in the owner's admin conversation (PSI AGT-13): the same assistant, the same history, its answer shown there too. Kaizen
  // Life's only, the owner's own app: another client's words would sit in the owner's conversation as theirs, and it would read that
  // conversation beyond its grant (D439 review), so it always asks in its own.
  const admin = resume && caller.via.kind === "kaizen-life" ? await recentAdminConversation(member) : null;
  const conversationId = admin ?? (await conversationOf(caller, member));
  const events: AssistantEvent[] = [];
  await runTurn({
    member,
    conversationId,
    message: question,
    emit: (e) => events.push(e),
    invalidate,
    fromKaizenLife: caller.via.kind === "kaizen-life",
    outside: outsideOf(caller),
  });
  const done = events.find((e) => e.type === "done");
  const failed = events.find((e) => e.type === "error");
  const approvals = events.flatMap((e) => (e.type === "approval" ? [e.approval.summary] : []));
  if (!done) return text(failed?.type === "error" ? failed.message : "The store's assistant did not answer.", true);
  return text({
    answer: done.message.content,
    ...(admin && { conversation: "the owner's conversation in the admin", where: `${siteUrl()}/admin/${member.store.slug}/assistant?c=${conversationId}` }),
    ...(approvals.length > 0 && {
      waiting_for_approval: approvals,
      where: `${siteUrl()}/admin/${member.store.slug}/assistant?c=${conversationId}`,
    }),
  });
}

/** The owner MCP's protected resource metadata (RFC 9728): our issuer first, then Supabase's while Kaizen Life uses it (D439). */
export function protectedResource() {
  let supabase: string | null = null;
  if (process.env.KAIZEN_LIFE_CLIENT_ID?.trim()) {
    try {
      supabase = `${publicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
    } catch {
      supabase = null;
    }
  }
  return protectedResourceMetadata(siteUrl(), supabase);
}
