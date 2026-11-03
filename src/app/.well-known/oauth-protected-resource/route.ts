import { connection } from "next/server";

import { protectedResource } from "@/server/store-mcp";

/**
 * Where an MCP client learns which authorization servers issue tokens for /api/mcp (RFC 9728, D96, D439): Kaizena Flow's own first, then
 * Supabase's while Kaizen Life uses it. Also at the path-suffixed address (`/.well-known/oauth-protected-resource/api/mcp`).
 */
export async function GET() {
  await connection();
  return Response.json(protectedResource(), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
