import Link from "next/link";

import { LEGAL_ROLE_COPY } from "@/lib/legal-roles";
import { staffTermsFor, termsForOrder } from "@/server/checkout-terms";
import type { Store } from "@/server/stores";

/**
 * What the shopper was shown about the terms when they ordered (wave 1, 1e, docs/wave-1-trust.md 2.4): "Terms accepted {date} as ticked/shown", or
 * that the link was shown and nothing was kept, or nothing at all (a copied order, or a store that has not had the feature on). Each text opens
 * as it was when the shopper pressed pay: the snapshot, never today's page. Draws nothing when there is nothing to say.
 */
export async function OrderTermsCard({ store, orderId, zone }: { store: Pick<Store, "id" | "slug">; orderId: string; zone: string }) {
  const format = (date: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(date);
  const [line, record] = await Promise.all([staffTermsFor(store, orderId, format), termsForOrder(store.id, orderId)]);
  if (line.kind === "none") return null;
  return (
    <section aria-labelledby="terms" className="rounded-lg border border-border bg-background p-5 text-sm">
      <h2 id="terms" className="mb-2 font-medium">
        Terms
      </h2>
      <p>{line.text}.</p>
      {record && record.snapshots.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {record.snapshots.map((snapshot) => (
            <li key={snapshot.role}>
              <Link href={`/admin/${store.slug}/orders/${orderId}/terms/${snapshot.role}`} className="underline">
                {LEGAL_ROLE_COPY[snapshot.role].name}: {snapshot.title}
              </Link>{" "}
              <span className="text-muted">as it was, version {snapshot.hash.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      )}
      {line.kind === "not_recorded" && <p className="mt-1 text-muted">Checkout showed the link, but the record could not be kept for this order.</p>}
    </section>
  );
}
