import recorded from "@/data/api-contract.json";
import { ucpCatalogue } from "@/lib/ucp-catalogue";

/** The shopping agents' tool catalogue (D438), public: what every store's `/api/ucp/{store}/mcp` serves, with titles and MCP annotations. */
export function GET() {
  return Response.json(
    { contract_version: recorded.version, ...ucpCatalogue() },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
