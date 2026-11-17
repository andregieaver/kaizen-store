import { z } from "zod";

import { contractPdf } from "@/server/contracts";
import { requirePermission } from "@/server/permissions";

/**
 * A sent contract's PDF for staff (D695): the file kept when it was sent, the one its signers sign, read from the private `documents` bucket.
 * Nothing is drawn here (no Chromium): a draft, another store's contract, or a file that cannot be read is a 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/deals/[dealId]/contracts/[contractId]/pdf">) {
  const { store: slug, contractId } = await params;
  const member = await requirePermission(slug, "customers:read");
  if (!z.uuid().safeParse(contractId).success) return new Response("Not found", { status: 404 });
  const bytes = await contractPdf(member, contractId);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Blob([bytes as BlobPart], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="contract-${contractId.slice(0, 8)}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
