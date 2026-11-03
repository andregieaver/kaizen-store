import { connection } from "next/server";

import { protectedResource } from "@/server/store-mcp";

/** The owner MCP's protected resource metadata at its path-suffixed address (RFC 9728 3.1, D439): the same document as the plain one. */
export async function GET() {
  await connection();
  return Response.json(protectedResource(), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
