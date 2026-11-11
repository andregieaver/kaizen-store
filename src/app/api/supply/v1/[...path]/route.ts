import { connection } from "next/server";

import { takeBudget } from "@/server/request-budget";
import { openOrdersForSupplier, postParcelByKey, setSupplierStock, supplierByKey, supplierOrdersCsv } from "@/server/supplier-orders";

/**
 * The supplier API (drop shipping, D553, `docs/drop-shipping.md` 3 and 4): a supplier's own system, with the key the store's owner made for it
 * (`Authorization: Bearer kzsp_…`), reads the orders it is asked to send and posts their parcels and its stock. A key sees only its supplier's
 * orders, lines and variants in one store. 60 calls a minute a supplier.
 *
 * - `GET  /api/supply/v1/orders`: the open orders as JSON (`{ orders: [{ id, number, state, sentAt, shipTo, note, lines }] }`).
 * - `GET  /api/supply/v1/orders.csv`: the same as a CSV, a row per line (for a supplier that takes a daily file).
 * - `POST /api/supply/v1/orders/{id}/parcel`: `{ carrier, trackingNumber, trackingUrl? }`; the customer gets the shop's shipped email.
 * - `POST /api/supply/v1/stock`: `{ items: [{ sku, quantity }] }`, what it has of the variants it sends.
 */

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

const PROBLEMS: Record<string, [number, string]> = {
  gone: [404, "No such order for this supplier."],
  done: [409, "This order is already marked as sent."],
  cancelled: [409, "This order was cancelled: do not send it."],
  carrier: [422, "carrier must be one of posten, bring, postnord, dhl, dhl_paket, ups, instabox, other."],
  tracking: [422, "trackingNumber must be 3 to 60 letters, digits, spaces or dashes."],
  link: [422, "trackingUrl must start with https://."],
  refused: [409, "The parcel could not be recorded; the store has been told nothing. Ask the store."],
  reason: [422, "Give a reason."],
};

async function caller(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const supplier = await supplierByKey(key);
  if (!supplier) return { error: json({ error: "A valid supplier key is needed: Authorization: Bearer kzsp_…" }, 401) };
  if (!(await takeBudget(supplier.storeId, "supply", supplier.supplierId))) return { error: json({ error: "Too many requests." }, 429) };
  return { supplier };
}

export async function GET(request: Request, { params }: RouteContext<"/api/supply/v1/[...path]">) {
  await connection();
  const { path } = await params;
  const found = await caller(request);
  if ("error" in found) return found.error;
  const { storeId, supplierId } = found.supplier;
  const route = path.join("/");
  if (route === "orders") return json({ orders: await openOrdersForSupplier(storeId, supplierId) });
  if (route === "orders.csv") {
    return new Response(supplierOrdersCsv(await openOrdersForSupplier(storeId, supplierId)), {
      headers: { ...HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"' },
    });
  }
  return json({ error: "Not found." }, 404);
}

export async function POST(request: Request, { params }: RouteContext<"/api/supply/v1/[...path]">) {
  await connection();
  const { path } = await params;
  const found = await caller(request);
  if ("error" in found) return found.error;
  const { storeId, supplierId } = found.supplier;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: "The body must be JSON." }, 400);
  }
  if (path.length === 3 && path[0] === "orders" && path[2] === "parcel") {
    const result = await postParcelByKey(storeId, supplierId, path[1], body);
    if (result.ok) return json({ ok: true });
    const [status, error] = PROBLEMS[result.problem] ?? [400, "Not recorded."];
    return json({ error, code: result.problem }, status);
  }
  if (path.length === 1 && path[0] === "stock") {
    const result = await setSupplierStock(storeId, supplierId, Array.isArray(body.items) ? (body.items as { sku?: unknown; quantity?: unknown }[]) : []);
    return result.ok ? json({ ok: true, set: result.set, unknown: result.unknown }) : json({ error: result.problem }, 422);
  }
  return json({ error: "Not found." }, 404);
}
