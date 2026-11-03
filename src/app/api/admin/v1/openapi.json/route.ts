import recorded from "@/data/api-contract.json";
import { adminOpenApi } from "@/lib/admin-openapi";
import { siteUrl } from "@/lib/site";

/**
 * The Admin API's contract (D438), public and versioned: an OpenAPI 3.1 document made from the operations themselves (`ADMIN_API`), with the
 * webhook topics. A static segment, so the API's own catch-all (`[...path]`) never answers it.
 */
export function GET() {
  return Response.json(adminOpenApi(`${siteUrl()}/api/admin/v1`, recorded.version), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" },
  });
}
