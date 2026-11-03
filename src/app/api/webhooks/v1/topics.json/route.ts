import recorded from "@/data/api-contract.json";
import { webhookCatalogue } from "@/lib/webhook-topics";

/** The webhook topics (D438), public: each topic's payload, the headers every delivery carries and how to check its signature. */
export function GET() {
  return Response.json(
    { contract_version: recorded.version, ...webhookCatalogue() },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
