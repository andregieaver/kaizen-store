import { NextResponse, type NextRequest } from "next/server";

import { writeCsv } from "@/lib/csv";
import { checkPermission } from "@/server/permissions";
import { getTransfer } from "@/server/stock-transfers";

/**
 * A transfer's lines as a CSV file (wave 11 unit D2, D383): SKU, title, units sent and received, written by `writeCsv()`, for members with
 * `products:read`; another store's transfer or a person without the key is a 404. A read, never cached.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/admin/[store]/inventory/transfers/[id]/csv">) {
  const { store: slug, id } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const transfer = await getTransfer(member.store.id, id);
  if (!transfer) return new NextResponse("Not found", { status: 404 });
  const file = writeCsv([["SKU", "Title", "Quantity", "Received"], ...transfer.items.map((i) => [i.sku, i.title, i.quantity, i.received])]);
  return new NextResponse(file, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="transfer-${id.slice(0, 8)}.csv"`, "cache-control": "no-store" },
  });
}
