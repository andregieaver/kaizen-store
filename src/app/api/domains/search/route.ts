import { DOMAIN_SEARCH_TLDS_MAX_PLAIN, SUGGESTED_TLDS } from "@/lib/domain-search";
import { domainPricingRows } from "@/server/domain-prices";
import { searchDomains, visitorKey } from "@/server/domain-search";

/**
 * The domain search component on Kaizena Flow's own pages (D315, `docs/domains.md` 16): `?q=` the name, `tlds=` the endings to suggest first
 * (comma separated), `currency=` the prices' currency. Keyword only, the same search and prices the admin uses; limited per visitor (a hash
 * of their address and the day, never the address) and in all. Sets no cookie and keeps nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const tlds = (url.searchParams.get("tlds") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^\./, ""))
    .filter((t) => /^[a-z][a-z0-9-]{1,62}(\.[a-z][a-z0-9-]{1,62})?$/.test(t))
    .slice(0, DOMAIN_SEARCH_TLDS_MAX_PLAIN);
  const wanted = (url.searchParams.get("currency") ?? "").toUpperCase();
  const priced = (await domainPricingRows()).map((p) => p.currency);
  const currency = priced.includes(wanted) ? wanted : priced.includes("EUR") ? "EUR" : (priced[0] ?? null);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const answer = await searchDomains(q, { asker: { visitor: visitorKey(address) }, currency, tlds: tlds.length > 0 ? tlds : SUGGESTED_TLDS });
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
