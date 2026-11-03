import recorded from "@/data/api-contract.json";
import { mcpCatalogue } from "@/lib/mcp-catalogue";

/**
 * The owner MCP's tool catalogue (D438), public and without any store's data: each tool's title, description, inputs, gate, permission,
 * feature and MCP annotations, as `/api/mcp` lists them to a signed-in client.
 */
export function GET() {
  return Response.json(
    { contract_version: recorded.version, ...mcpCatalogue() },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
