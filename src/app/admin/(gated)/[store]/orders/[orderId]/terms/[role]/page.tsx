import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { LEGAL_ROLE_COPY, isLegalRole } from "@/lib/legal-roles";
import { blockText } from "@/lib/page-content";
import { requirePermission } from "@/server/permissions";
import { snapshotForOrder } from "@/server/checkout-terms";

export const metadata: Metadata = { title: "Terms as shown" };

/**
 * One of the texts an order was placed under, as the shopper was shown it (wave 1, 1e, docs/wave-1-trust.md 2.4): the plain text of the kept
 * snapshot, row by row, with its version and when it was accepted. For staff who can read orders; another order's or another store's is not
 * found. The shopper's own copy is on their order page. Nothing here changes anything.
 */
export default async function OrderTermsAsShownPage({ params }: PageProps<"/admin/[store]/orders/[orderId]/terms/[role]">) {
  const { store: slug, orderId, role } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(orderId).success || !isLegalRole(role)) notFound();
  const snapshot = await snapshotForOrder(store.id, orderId, role, null);
  if (!snapshot) notFound();
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" }).format(snapshot.acceptedAt);
  const paragraphs = snapshot.content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => blockText(block).trim()).filter(Boolean)));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href={`/admin/${slug}/orders/${orderId}`} className="underline">
          Back to the order
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold">{snapshot.title}</h1>
        <p className="text-sm text-muted">
          {LEGAL_ROLE_COPY[role].name} as the shopper saw it when they ordered, {when}. Version {snapshot.hash.slice(0, 8)}, language {snapshot.locale}. The
          mode was {snapshot.mode === "checkbox" ? "a tick box" : "a link"}. This is the plain text of the kept copy, not today&apos;s page.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5 text-sm">
        {paragraphs.length === 0 ? <p className="text-muted">The kept copy has no text.</p> : paragraphs.map((text, index) => <p key={index} className="break-words whitespace-pre-line">{text}</p>)}
      </div>
    </div>
  );
}
