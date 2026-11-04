import { createHash } from "node:crypto";

import { connection } from "next/server";

import { UCP_TOOLS } from "@/lib/ucp-catalogue";
import { UCP_VERSION } from "@/lib/shopping-agents";
import { takeBudget } from "@/server/request-budget";
import { AgentToolError, agentStore, runAgentTool } from "@/server/shopping-agents";

/**
 * A store's public MCP server for AI shopping agents (D353, UCP over MCP): Streamable HTTP with JSON-RPC 2.0 and plain JSON answers, apart
 * from `/api/mcp`, which stays Kaizen Life's alone. No token, no cookie and nothing of a person: anyone may ask while the store serves shopping
 * agents (`agentStore()`), within a budget per store and per caller (a daily hash of the address, never the address); a batch holds 1 to 10
 * calls and a body at most 50,000 bytes. Nothing is ordered or paid here: `create_cart` answers a link to the store's own checkout.
 */
export const maxDuration = 30;

const SERVER_INFO = { name: "kaizena-flow-store", version: UCP_VERSION };
const PROTOCOL_VERSION = "2025-06-18";
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
/**
 * At most this many calls in one batch, so one request stays within the budget it was counted as, and this many bytes in a body (UTF-8, not
 * characters). A larger batch, or an empty one, is refused whole, as the owner MCP (`/api/mcp`) refuses it.
 */
const BATCH_MAX = 10;
const BODY_MAX = 50_000;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: RpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const callerOf = (request: Request) => {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${address}|${new Date().toISOString().slice(0, 10)}|kaizen-ucp`).digest("hex").slice(0, 32);
};

export async function POST(request: Request, { params }: RouteContext<"/api/ucp/[store]/mcp">) {
  await connection();
  const store = await agentStore((await params).store);
  if (!store) return Response.json(failure(null, -32001, "This store does not take requests from shopping agents."), { status: 404, headers: HEADERS });
  if (!(await takeBudget(store.id, "agent", callerOf(request)))) {
    return Response.json(failure(null, -32002, "Too many requests. Wait a minute."), { status: 429, headers: { ...HEADERS, "Retry-After": "60" } });
  }
  const tooLarge = () => Response.json(failure(null, -32600, "Too large."), { status: 413, headers: HEADERS });
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return tooLarge();
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return tooLarge();
    body = JSON.parse(raw);
  } catch {
    return Response.json(failure(null, -32700, "Parse error."), { status: 400, headers: HEADERS });
  }
  if (Array.isArray(body) && (body.length === 0 || body.length > BATCH_MAX)) {
    return Response.json(failure(null, -32600, `A batch holds 1 to ${BATCH_MAX} calls.`), { status: 400, headers: HEADERS });
  }
  const handle = async (rpc: RpcRequest) => {
    switch (rpc.method) {
      case "initialize":
        return result(rpc.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "ping":
        return result(rpc.id, {});
      case "tools/list":
        return result(rpc.id, { tools: UCP_TOOLS });
      case "tools/call": {
        const name = typeof rpc.params?.name === "string" ? rpc.params.name : "";
        const args = rpc.params?.arguments;
        try {
          const answer = await runAgentTool(store, name, args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {});
          return result(rpc.id, { structuredContent: answer, content: [{ type: "text", text: JSON.stringify(answer) }] });
        } catch (error) {
          if (error instanceof AgentToolError) return result(rpc.id, { isError: true, content: [{ type: "text", text: error.message }] });
          throw error;
        }
      }
      default:
        return failure(rpc.id, -32601, `Unknown method ${String(rpc.method)}.`);
    }
  };
  const requests = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  const answers = await Promise.all(requests.filter((r) => r && typeof r === "object" && r.id !== undefined).map(handle));
  if (answers.length === 0) return new Response(null, { status: 202, headers: HEADERS });
  return Response.json(Array.isArray(body) ? answers : answers[0], { headers: HEADERS });
}

export async function GET() {
  return new Response("Use POST.", { status: 405, headers: { Allow: "POST" } });
}
