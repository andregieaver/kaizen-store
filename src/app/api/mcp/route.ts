import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { bearerChallenge, insufficientScopeChallenge, resourceMetadataUrl, type OAuthScope } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";
import { takeMcpBudget } from "@/server/request-budget";
import { auditCall, callMcpTool, mcpCaller, mcpToolsFor, scopeNeeded, scopesMissing, storeOfCall, type McpCaller } from "@/server/store-mcp";

/** A question to the store's assistant can take a few tool rounds. */
export const maxDuration = 300;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "kaizen-store", version: "1.0.0" };
/** At most this many calls in one batch, and this many bytes in a body (D439). */
const BATCH_MAX = 10;
const BODY_MAX = 100_000;

/** Any origin may call with a bearer token (no cookie is read), and read the challenge a refusal carries. */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate" };

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: RpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...headers } });

const toolName = (rpc: RpcRequest): string => (typeof rpc.params?.name === "string" ? rpc.params.name : "");
const toolArgs = (rpc: RpcRequest): Record<string, unknown> => {
  const args = rpc.params?.arguments;
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
};

/** Whose budget a call is counted in: the grant's, or for Kaizen Life's tokens the person's. */
const budgetKey = (caller: McpCaller) => (caller.via.kind === "oauth" ? caller.via.grantId : `kaizen-life:${caller.account.id}`);

/**
 * The store's MCP server (D96, D439), Streamable HTTP with JSON-RPC 2.0 and plain JSON answers: an outside AI assistant working with its
 * person's stores. The bearer token is an access token of Kaizena Flow's authorization server bound to this address, or Kaizen Life's from
 * the store's Supabase OAuth server; without one the answer points to where to get one (RFC 9728). A call whose tool needs a scope the
 * grant does not hold answers 403 with one `insufficient_scope` challenge naming every scope the request needs (RFC 6750). Each call is
 * counted per grant and per store (`takeMcpBudget()`), a batch holds at most ten, a body at most 100 KB.
 */
export async function POST(request: Request) {
  await connection();
  const metadata = resourceMetadataUrl(siteUrl());
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const caller = token ? await mcpCaller(token) : null;
  if (!caller) {
    return json({ error: "A Kaizena Flow access token is needed: the resource metadata says where to get one." }, 401, {
      "WWW-Authenticate": bearerChallenge(metadata, Boolean(token)),
    });
  }
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return json(failure(null, -32600, "Too large."), 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return json(failure(null, -32600, "Too large."), 413);
    body = JSON.parse(raw);
  } catch {
    return json(failure(null, -32700, "Parse error."), 400);
  }
  if (Array.isArray(body) && (body.length === 0 || body.length > BATCH_MAX)) return json(failure(null, -32600, `A batch holds 1 to ${BATCH_MAX} calls.`), 400);
  const requests = (Array.isArray(body) ? body : [body]).filter((r): r is RpcRequest => typeof r === "object" && r !== null);
  if (requests.length === 0) return json(failure(null, -32600, "Invalid request."), 400);

  // Every call's scope is checked before any runs: one challenge with every scope the request needs (B3).
  const calls = requests.filter((rpc) => rpc.method === "tools/call");
  if (calls.some((rpc) => scopesMissing(caller, toolName(rpc)).length > 0)) {
    // Refused calls are in the activity log too (D439 review): each call the grant could not make, with its store when it reaches one.
    for (const rpc of calls.filter((call) => scopesMissing(caller, toolName(call)).length > 0)) {
      await auditCall(caller, storeOfCall(caller, toolArgs(rpc)), toolName(rpc), "refused", "scope");
    }
    const needed = [...new Set(calls.map((rpc) => scopeNeeded(toolName(rpc))).filter((s): s is OAuthScope => s !== null))];
    return json({ error: "insufficient_scope", scopes: needed }, 403, { "WWW-Authenticate": insufficientScopeChallenge(needed, metadata) });
  }

  const invalidate = (tag: string) => revalidateTag(tag, "max");
  let overBudget = false;
  const handle = async (rpc: RpcRequest) => {
    const storeId = rpc.method === "tools/call" ? storeOfCall(caller, toolArgs(rpc)) : null;
    if (!(await takeMcpBudget(budgetKey(caller), storeId))) {
      overBudget = true;
      return failure(rpc.id, -32000, "Too many calls: at most 120 a minute for this connection, and 1,200 a minute for a store. Wait a minute.");
    }
    switch (rpc.method) {
      case "initialize":
        return result(rpc.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "ping":
        return result(rpc.id, {});
      case "tools/list":
        return result(rpc.id, { tools: await mcpToolsFor(caller) });
      case "tools/call":
        return result(rpc.id, await callMcpTool(caller, toolName(rpc), toolArgs(rpc), invalidate));
      default:
        return failure(rpc.id, -32601, `Unknown method ${String(rpc.method)}.`);
    }
  };
  // Notifications (no id) get no answer.
  const answers = await Promise.all(requests.filter((r) => r.id !== undefined).map(handle));
  if (answers.length === 0) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? answers : answers[0], overBudget && !Array.isArray(body) ? 429 : 200, overBudget ? { "Retry-After": "60" } : {});
}

export async function GET() {
  return new Response("Use POST.", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
}

/** A browser's preflight: a bearer token and JSON, from anywhere. */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Max-Age": "3600",
    },
  });
}
