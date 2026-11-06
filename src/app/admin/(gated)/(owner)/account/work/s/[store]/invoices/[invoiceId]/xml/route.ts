import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { workBase } from "@/lib/work-paths";
import { workDocumentUblOf } from "@/server/einvoice-sending";
import { einvoiceResponse } from "@/server/einvoices";
import { requirePermission } from "@/server/permissions";

/** A Work invoice as EN 16931 UBL, the EHF it is sent as (D463): from the issued document only; a draft or another store's is a 404. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/account/work/s/[store]/invoices/[invoiceId]/xml">) {
  const { store: slug, invoiceId } = await params;
  const { store, account } = await requirePermission(slug, "settings:read");
  if (!store.workOn || !z.uuid().safeParse(invoiceId).success) return new Response("Not found", { status: 404 });
  return einvoiceResponse(await workDocumentUblOf(store.id, "invoice", invoiceId), { lang: adminLangOf(account.adminLocale), back: `${workBase(slug)}/invoices/${invoiceId}` });
}
