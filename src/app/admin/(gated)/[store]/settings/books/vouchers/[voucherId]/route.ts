import { z } from "zod";

import { requirePermission } from "@/server/permissions";
import { readVoucher } from "@/server/purchases";

/**
 * A voucher of the store's books (B3, D490), such as a purchase's receipt, for a member who may read the store's settings (as the Books
 * screen): shown in the browser, never cached, with its own type; another store's, or one whose file cannot be read, is a 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/settings/books/vouchers/[voucherId]">) {
  const { store: slug, voucherId } = await params;
  const { store } = await requirePermission(slug, "books:read");
  if (!z.uuid().safeParse(voucherId).success) return new Response("Not found", { status: 404 });
  const voucher = await readVoucher(store.id, voucherId);
  if (!voucher) return new Response("Not found", { status: 404 });
  const name = voucher.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(Buffer.from(voucher.bytes), {
    headers: {
      "content-type": voucher.contentType,
      "content-disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(voucher.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
