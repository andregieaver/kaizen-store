import { marketPath } from "@/lib/paths";
import { serialiseExport } from "@/lib/privacy-export";
import { sameSite } from "@/server/chat-route";
import { shopperExport } from "@/server/privacy-shopper";
import { resolveShop } from "@/server/shop";

/**
 * The shopper's own data as one JSON file (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.2 and 2.4). A POST from the "Your data" page only: the
 * account is the one signed in in this browser, and the session must be fresh (a code or the password within ten minutes), otherwise the
 * shopper is sent back to confirm it is them and nothing is made. The file is the answer: never emailed, never kept, never cached, never in
 * an address. Another site cannot make the browser ask for it (`sameSite()`).
 */
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } as const;

export async function POST(request: Request, { params }: RouteContext<"/s/[store]/[market]/account/privacy/export">) {
  const { store: storeSlug, market: marketSlug } = await params;
  if (!sameSite(request)) return new Response("Forbidden", { status: 403, headers: HEADERS });
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return new Response("Not found", { status: 404, headers: HEADERS });
  const base = marketPath(shop.store.slug, shop.market.slug);
  const back = (problem: string) => new Response(null, { status: 303, headers: { ...HEADERS, Location: `${base}/account/privacy?problem=${problem}` } });

  const result = await shopperExport(shop.store.id);
  if (!result.ok) {
    if (result.problem === "signed_out") return new Response(null, { status: 303, headers: { ...HEADERS, Location: `${base}/account` } });
    return back(result.problem === "stale" ? "stale" : result.problem === "too_large" ? "too_large" : result.problem === "busy" ? "busy" : "failed");
  }
  return new Response(serialiseExport(result.file), {
    headers: {
      ...HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
    },
  });
}
