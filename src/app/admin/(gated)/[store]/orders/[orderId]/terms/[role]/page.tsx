import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { LEGAL_ROLE_COPY, isLegalRole } from "@/lib/legal-roles";
import { blockText } from "@/lib/page-content";
import { requirePermission } from "@/server/permissions";
import { snapshotForOrder } from "@/server/checkout-terms";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Terms as shown" };

/**
 * One of the texts an order was placed under, as the shopper was shown it (wave 1, 1e, docs/wave-1-trust.md 2.4): the plain text of the kept
 * snapshot, row by row, with its version and when it was accepted. For staff who can read orders; another order's or another store's is not
 * found. The shopper's own copy is on their order page. Nothing here changes anything.
 */
export default async function OrderTermsAsShownPage({ params }: PageProps<"/admin/[store]/orders/[orderId]/terms/[role]">) {
  const { store: slug, orderId, role } = await params;
  const gated = await requirePermission(slug, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(gated);
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "order").views;
  if (!z.uuid().safeParse(orderId).success || !isLegalRole(role)) notFound();
  const snapshot = await snapshotForOrder(store.id, orderId, role, null);
  if (!snapshot) notFound();
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" }).format(snapshot.acceptedAt);
  const paragraphs = snapshot.content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => blockText(block).trim()).filter(Boolean)));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href={`/admin/${slug}/orders/${orderId}`} className="underline">
          {w.backToOrder}
        </Link>
      </p>
      <PageHeader
        title={<>{snapshot.title}</>}
        description={<>{fillWords(w.shownDescription, { name: LEGAL_ROLE_COPY[role].name, when, version: snapshot.hash.slice(0, 8), locale: snapshot.locale, mode: snapshot.mode === "checkbox" ? w.tickBox : w.link })}</>}
      />
      <div className={`flex flex-col gap-3 p-5 text-sm ${CARD_CLASS}`}>
        {paragraphs.length === 0 ? <p className="text-muted">{w.noText}</p> : paragraphs.map((text, index) => <p key={index} className="break-words whitespace-pre-line">{text}</p>)}
      </div>
    </div>
  );
}
