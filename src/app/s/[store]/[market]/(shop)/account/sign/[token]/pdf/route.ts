import { signerDocument, signerByToken } from "@/server/contract-signing";
import { resolveAfterSaleShop } from "@/server/shop";

/**
 * A contract's PDF from its signer's link (D695 step 3): the file they sign, or the signed and sealed one once everyone has signed. The token
 * is the whole access; another store's link, a malformed one or a draft's is a 404. Nothing is drawn here.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/account/sign/[token]/pdf">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  const view = shop ? await signerByToken(token) : null;
  if (!shop || !view || view.storeId !== shop.store.id) return new Response("Not found", { status: 404 });
  const doc = await signerDocument(token);
  if (!doc) return new Response("Not found", { status: 404 });
  const name = `${doc.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "contract"}${doc.signed ? " (signed)" : ""}.pdf`;
  return new Response(new Blob([doc.bytes as BlobPart], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
