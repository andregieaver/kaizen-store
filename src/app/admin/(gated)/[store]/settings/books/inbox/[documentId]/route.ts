import { requirePermission } from "@/server/permissions";
import { readInboxDocument } from "@/server/books-inbox";

/**
 * A document of the books' inbox (D504), as a receipt that came by email, for a member who may read the store's settings (as the Books
 * screen): shown in the browser, never cached, with its own type; another store's, one used or set aside, or one whose file cannot be read,
 * is a 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/settings/books/inbox/[documentId]">) {
  const { store: slug, documentId } = await params;
  const { store } = await requirePermission(slug, "settings:read");
  const doc = await readInboxDocument(store.id, documentId);
  if (!doc || doc.status !== "waiting") return new Response("Not found", { status: 404 });
  const name = doc.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(doc.bytes), {
    headers: {
      "content-type": doc.contentType,
      "content-disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
