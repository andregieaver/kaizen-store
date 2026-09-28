import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { siteUrl } from "@/lib/site";
import { callMcpTool, MCP_TOOLS, mcpCaller } from "@/server/store-mcp";

/** A question to the store's assistant can take a few tool rounds. */
export const maxDuration = 300;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "kaizen-store", version: "1.0.0" };

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: RpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * The store's MCP server (D96), Streamable HTTP with JSON-RPC 2.0 and plain
 * JSON answers: Kaizen Life's assistant working with the owner's stores.
 * The bearer token is an access token from the store's Supabase OAuth
 * server, issued to Kaizen Life; without one the answer points to where
 * to get it (RFC 9728).
 */
export async function POST(request: Request) {
  await connection();
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const caller = token ? await mcpCaller(token) : null;
  if (!caller) {
    return new Response(JSON.stringify({ error: "A Kaizen Store access token for Kaizen Life is needed." }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${siteUrl()}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return Response.json(failure(null, -32600, "Too large."), { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json(failure(null, -32700, "Parse error."), { status: 400 });
  }
  const invalidate = (tag: string) => revalidateTag(tag, "max");
  const handle = async (rpc: RpcRequest) => {
    switch (rpc.method) {
      case "initialize":
        return result(rpc.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "ping":
        return result(rpc.id, {});
      case "tools/list":
        return result(rpc.id, { tools: MCP_TOOLS });
      case "tools/call": {
        const name = typeof rpc.params?.name === "string" ? rpc.params.name : "";
        const args = rpc.params?.arguments;
        return result(rpc.id, await callMcpTool(caller, name, args && typeof args === "object" ? (args as Record<string, unknown>) : {}, invalidate));
      }
      default:
        return failure(rpc.id, -32601, `Unknown method ${String(rpc.method)}.`);
    }
  };
  const requests = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  // Notifications (no id) get no answer.
  const answers = await Promise.all(requests.filter((r) => r && r.id !== undefined).map(handle));
  if (answers.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? answers : answers[0], { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return new Response("Use POST.", { status: 405, headers: { Allow: "POST" } });
}
