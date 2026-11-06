import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { workBase } from "@/lib/work-paths";
import { workDocumentUblOf } from "@/server/einvoice-sending";
import { einvoiceResponse } from "@/server/einvoices";
import { requirePermission } from "@/server/permissions";

/** A Work credit note as EN 16931 UBL, the EHF it is sent as (D463); another store's is a 404. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/account/work/s/[store]/credit-notes/[creditNoteId]/xml">) {
  const { store: slug, creditNoteId } = await params;
  const { store, account } = await requirePermission(slug, "settings:read");
  if (!store.workOn || !z.uuid().safeParse(creditNoteId).success) return new Response("Not found", { status: 404 });
  return einvoiceResponse(await workDocumentUblOf(store.id, "credit_note", creditNoteId), { lang: adminLangOf(account.adminLocale), back: `${workBase(slug)}/invoices` });
}
