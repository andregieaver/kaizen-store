import { NextResponse, type NextRequest } from "next/server";

import { amountCell, writeCsv } from "@/lib/csv";
import { checkPermission } from "@/server/permissions";
import { getPurchaseOrder } from "@/server/purchase-orders";

/**
 * A purchase order's lines as a CSV file (wave 11 unit D2, D383): SKU, title, units ordered and received and the unit cost in the order's own
 * currency (`amountCell()` from minor units), written by `writeCsv()`, for members with `products:read`; another store's order or a person
 * without the key is a 404. A read, never cached.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/admin/[store]/inventory/purchase-orders/[id]/csv">) {
  const { store: slug, id } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const order = await getPurchaseOrder(member.store.id, id);
  if (!order) return new NextResponse("Not found", { status: 404 });
  const file = writeCsv([
    ["SKU", "Title", "Quantity", "Received", "Unit cost", "Currency"],
    ...order.items.map((i) => [i.sku, i.title, i.quantity, i.received, amountCell(i.unitCostMinor, order.currency), order.currency]),
  ]);
  return new NextResponse(file, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="purchase-order-${id.slice(0, 8)}.csv"`, "cache-control": "no-store" },
  });
}
