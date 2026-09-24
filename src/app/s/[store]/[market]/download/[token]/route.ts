import { marketPath } from "@/lib/paths";
import { signedDownloadUrl } from "@/server/media";
import { returnDownload, takeDownload } from "@/server/orders";
import { resolveShop } from "@/server/shop";

const TOKEN = /^[0-9a-f]{64}$/;

/**
 * A download from a paid order (D24). The link on the order page counts one
 * download and sends the shopper to the file through a signed link that
 * works for a minute; the file itself stays private. A link past its limit
 * or date goes to a page that says so.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/download/[token]">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || !TOKEN.test(token)) return new Response("Not found", { status: 404 });
  const notice = (problem: "gone" | "failed") =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `${marketPath(shop.store.slug, shop.market.slug, "/download")}?problem=${problem}`,
        "Cache-Control": "no-store",
      },
    });

  const file = await takeDownload(shop.store.id, token);
  if (!file) return notice("gone");
  const url = await signedDownloadUrl(file.path, file.name);
  if (!url) {
    await returnDownload(shop.store.id, token);
    return notice("failed");
  }
  return new Response(null, {
    status: 303,
    headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
