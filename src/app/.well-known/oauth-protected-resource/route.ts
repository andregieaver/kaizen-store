import { connection } from "next/server";

import { protectedResource } from "@/server/store-mcp";

/** Where Kaizen Life's MCP client learns which authorization server issues tokens for /api/mcp (RFC 9728, D96). */
export async function GET() {
  await connection();
  return Response.json(protectedResource(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
