import { z } from "zod";

import { requirePermission } from "@/server/permissions";
import { staffReturnLabel } from "@/server/return-labels";

const WORDS: Record<404 | 429 | 503, string> = {
  404: "This return has no booked label.",
  429: "The label was fetched too many times this hour. Try again in an hour.",
  503: "The label cannot be fetched from the carrier right now. Try again in a moment.",
};

/**
 * *Print label* on a return's page (wave 3, D239, `docs/wave-3-exchanges.md` 2.3): the return label booked with the carrier, fetched from the carrier's own host with the
 * store's agreement (`staffReturnLabel()`, the same fetch as the shopper's route) for its staff only, and never kept.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/returns/[returnId]/label">) {
  const { store: slug, returnId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(returnId).success) return new Response(WORDS[404], { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const label = await staffReturnLabel(store.id, returnId);
  if (!label.ok) return new Response(WORDS[label.status], { status: label.status, headers: { "Cache-Control": "private, no-store" } });
  return new Response(new Uint8Array(label.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
