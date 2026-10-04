import "server-only";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { publicEnv } from "@/lib/env";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition, type OwnerTool } from "@/lib/owner-tools";
import { siteUrl } from "@/lib/site";

import { holderOf, type Account, type Membership } from "./auth";
import { keepForApproval, kaizenLifeConversation, runTurn, type AssistantEvent } from "./owner-assistant";
import { OwnerToolError, preflightOwnerTool, runOwnerTool } from "./owner-tools";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * The store's MCP server (D96): the owner assistant's tools, served to
 * Kaizen Life's assistant for the owner who connected it. Access tokens
 * come from the store's own Supabase OAuth server, issued to the Kaizen
 * Life client (`KAIZEN_LIFE_CLIENT_ID`) for an account that owns stores;
 * any other token is refused. Every tool takes the store it is for, one of
 * the owner's; changes that send, publish or cost money are kept for the
 * owner's approval in the store's admin, never run from here.
 */

export type McpCaller = {
  account: Account;
  stores: { id: string; slug: string; name: string }[];
  /** The assurance level of the token (`aal` claim): a store that requires two-step, and a platform admin, are served at `aal2` only (wave 1, 1f). */
  aal: "aal1" | "aal2";
};

/** Who a bearer token is: an owner, with the stores they own, if the token is Kaizen Life's. */
export async function mcpCaller(token: string): Promise<McpCaller | null> {
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
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, a.name, a.platform_admin, s.id as store_id, s.slug, s.name as store_name, s.require_two_step
    from commerce.accounts a
    join commerce.store_members m on m.account_id = a.id and m.role = 'owner' and m.disabled_at is null
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
    where a.auth_user_id = ${claims.sub}::uuid and a.disabled_at is null
    order by s.name
  `);
  if (rows.length === 0) return null;
  const first = rows[0];
  const aal = claims.aal === "aal2" ? "aal2" : "aal1";
  // A platform admin works at the second step only, wherever they sign in: a token that did not pass it is refused whole.
  if (first.platform_admin && aal !== "aal2") return null;
  // A store that requires two-step is not served to a token that did not pass it, as its admin is not.
  const served = rows.filter((row) => aal === "aal2" || !row.require_two_step);
  if (served.length === 0) return null;
  return {
    account: { id: String(first.id), email: String(first.email), name: first.name ? String(first.name) : null, platformAdmin: Boolean(first.platform_admin) },
    stores: served.map((row) => ({ id: String(row.store_id), slug: String(row.slug), name: String(row.store_name) })),
    aal,
  };
}

// The tools ------------------------------------------------------------------------------

const STORE_ARG = { type: "string", description: "The store, by its slug from list_stores." };

export type McpToolInfo = { name: string; description: string; inputSchema: Record<string, unknown> };

/** Kaizen Life's view of a store tool: the same, plus the store it is for. */
function withStore(tool: OwnerTool): McpToolInfo {
  const { parameters } = toolDefinition(tool);
  const properties = { store: STORE_ARG, ...((parameters.properties as Record<string, unknown>) ?? {}) };
  const required = ["store", ...(((parameters.required as string[]) ?? []))];
  const gate = tool.gate ? " It is not done from here: it is kept for the owner to approve in Kaizen Store's admin." : "";
  return { name: tool.name, description: `${tool.description}${gate}`, inputSchema: { ...parameters, properties, required } };
}

export const MCP_TOOLS: McpToolInfo[] = [
  {
    name: "list_stores",
    description: "The stores the owner has in Kaizen Store: slug, name. Every other tool takes one of these slugs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask_store_assistant",
    description:
      "Asks the store's own assistant, in Kaizen Store, a question or for something to be done, in words; it answers from the store's data with its tools. Changes it prepares wait for the owner's approval in Kaizen Store's admin.",
    inputSchema: {
      type: "object",
      properties: { store: STORE_ARG, question: { type: "string", maxLength: 4000 } },
      required: ["store", "question"],
      additionalProperties: false,
    },
  },
  ...OWNER_TOOLS.map(withStore),
];

export type McpToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: unknown, isError = false): McpToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError && { isError: true }),
});

/** The owner's membership of the store a call names, if it is theirs. */
async function memberFor(caller: McpCaller, slug: unknown): Promise<Membership | null> {
  const owned = caller.stores.find((s) => s.slug === slug);
  const store = owned ? await getStore(owned.slug) : null;
  return store ? { account: caller.account, store, role: "owner" } : null;
}

const askInput = z.object({ store: z.string(), question: z.string().trim().min(1).max(4000) });

/** One tool call from Kaizen Life, for its owner: answered, refused or kept for approval. */
export async function callMcpTool(
  caller: McpCaller,
  name: string,
  args: Record<string, unknown>,
  invalidate: (tag: string) => void,
): Promise<McpToolResult> {
  if (name === "list_stores") return text({ stores: caller.stores.map(({ slug, name: storeName }) => ({ slug, name: storeName })) });
  const member = await memberFor(caller, args.store);
  if (!member) return text(`"${String(args.store ?? "")}" is not one of the owner's stores. Use list_stores.`, true);

  if (name === "ask_store_assistant") {
    const input = askInput.safeParse(args);
    if (!input.success) return text("Ask a question in words.", true);
    return askStoreAssistant(member, input.data.question, invalidate);
  }

  const tool = OWNER_TOOLS_BY_NAME[name];
  if (!tool) return text(`There is no tool called ${name}.`, true);
  const { store: _store, ...rest } = args;
  void _store;
  if (tool.gate) {
    const input = readToolInput(tool, rest);
    if (!input.ok) return text(`The arguments could not be read: ${input.problem}`, true);
    try {
      await preflightOwnerTool({ account: member.account, store: member.store, invalidate, holder: holderOf(member) }, name, rest);
    } catch (error) {
      if (error instanceof OwnerToolError) return text(error.message, true);
      console.error(`[store-mcp] ${name}`, error);
      return text("The tool failed.", true);
    }
    const conversation = await kaizenLifeConversation(member);
    const approval = await keepForApproval(
      { account: member.account, store: member.store, invalidate },
      conversation,
      name,
      tool.gate,
      input.input as Record<string, unknown>,
    );
    return text({
      kept_for_approval: true,
      what: approval.summary,
      where: `${siteUrl()}/admin/${member.store.slug}/assistant?c=${conversation}`,
      note: "Not done yet: the owner approves or declines it in Kaizen Store's admin.",
    });
  }
  try {
    return text(await runOwnerTool({ account: member.account, store: member.store, invalidate, holder: holderOf(member) }, name, rest));
  } catch (error) {
    if (error instanceof OwnerToolError) return text(error.message, true);
    console.error(`[store-mcp] ${name}`, error);
    return text("The tool failed.", true);
  }
}

/**
 * Kaizen Life's assistant asking the store's (D96): a turn in the owner's
 * Kaizen Life conversation, answered with the store's tools but none of
 * Kaizen Life's, so the two never ask each other in a loop.
 */
async function askStoreAssistant(member: Membership, question: string, invalidate: (tag: string) => void): Promise<McpToolResult> {
  const conversationId = await kaizenLifeConversation(member);
  const events: AssistantEvent[] = [];
  await runTurn({ member, conversationId, message: question, emit: (e) => events.push(e), invalidate, fromKaizenLife: true });
  const done = events.find((e) => e.type === "done");
  const failed = events.find((e) => e.type === "error");
  const approvals = events.flatMap((e) => (e.type === "approval" ? [e.approval.summary] : []));
  if (!done) return text(failed?.type === "error" ? failed.message : "The store's assistant did not answer.", true);
  return text({
    answer: done.message.content,
    ...(approvals.length > 0 && {
      waiting_for_approval: approvals,
      where: `${siteUrl()}/admin/${member.store.slug}/assistant?c=${conversationId}`,
    }),
  });
}

/** The address Kaizen Life's MCP client connects to, and its authorization server (for discovery). */
export function protectedResource() {
  const env = publicEnv();
  return {
    resource: `${siteUrl()}/api/mcp`,
    authorization_servers: [`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "Kaizen Store",
  };
}
