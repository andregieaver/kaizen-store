import Link from "next/link";

import { LEGAL_ROLE_COPY } from "@/lib/legal-roles";
import { staffTermsFor, termsForOrder } from "@/server/checkout-terms";
import type { Store } from "@/server/stores";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";

/**
 * What the shopper was shown about the terms when they ordered (wave 1, 1e, docs/wave-1-trust.md 2.4): "Terms accepted {date} as ticked/shown", or
 * that the link was shown and nothing was kept, or nothing at all (a copied order, or a store that has not had the feature on). Each text opens
 * as it was when the shopper pressed pay: the snapshot, never today's page. Draws nothing when there is nothing to say.
 */
export async function OrderTermsCard({
  store,
  orderId,
  zone,
  locale = "en-GB",
  words: w = orderEn.terms,
}: {
  store: Pick<Store, "id" | "slug">;
  orderId: string;
  zone: string;
  /** The admin's locale for the date (D312). */
  locale?: string;
  words?: OrderMessages["terms"];
}) {
  const format = (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(date);
  const [line, record] = await Promise.all([staffTermsFor(store, orderId, format), termsForOrder(store.id, orderId)]);
  if (line.kind === "none") return null;
  return (
    <Card title={w.title} className="text-sm" compact>
      <p>{line.text}.</p>
      {record && record.snapshots.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {record.snapshots.map((snapshot) => (
            <li key={snapshot.role}>
              <Link href={`/admin/${store.slug}/orders/${orderId}/terms/${snapshot.role}`} className="underline">
                {LEGAL_ROLE_COPY[snapshot.role].name}: {snapshot.title}
              </Link>{" "}
              <span className="text-muted">{fillWords(w.asItWas, { version: snapshot.hash.slice(0, 8) })}</span>
            </li>
          ))}
        </ul>
      )}
      {line.kind === "not_recorded" && <p className="mt-1 text-muted">{w.notRecorded}</p>}
    </Card>
  );
}
