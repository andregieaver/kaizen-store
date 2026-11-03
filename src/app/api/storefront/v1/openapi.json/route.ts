import recorded from "@/data/api-contract.json";
import { storefrontOpenApi } from "@/lib/storefront-api";
import { siteUrl } from "@/lib/site";

/** The storefront API's contract (D398, D438), public and versioned: an OpenAPI document made from the routes themselves. */
export function GET() {
  return Response.json(storefrontOpenApi(`${siteUrl()}/api/storefront/v1`, recorded.version), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" },
  });
}
