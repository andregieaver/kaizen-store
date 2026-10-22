import type { GiftFields } from "@/lib/gift";
import { Card } from "@/components/admin/ui";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";

/**
 * The buyer's gift on the order page (wave 3, D173, `docs/wave-3-orders.md` 2.3): *To*, *From* and the message in full, as TEXT (line breaks kept with `white-space: pre-wrap`, escaped by
 * React, never HTML). Staff cannot edit it: it is the buyer's own words, frozen once the order is placed. *Print gift slip* opens the packing slip, which is the price-free page the
 * message is printed on; the slip is only for an order with something to ship (`canPrint`).
 */
export function GiftCard({ gift, slipHref, words: w = orderEn.gift }: { gift: GiftFields; slipHref: string | null; words?: OrderMessages["gift"] }) {
  return (
    <Card title={w.title} className="text-sm" compact>
      <dl className="flex flex-col gap-1">
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-muted">{w.to}</dt>
          <dd className="min-w-0 break-words">{gift.to ?? "–"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-muted">{w.from}</dt>
          <dd className="min-w-0 break-words">{gift.from ?? "–"}</dd>
        </div>
      </dl>
      {gift.message ? (
        <blockquote className="mt-3 border-l-2 border-line pl-3 whitespace-pre-wrap break-words">{gift.message}</blockquote>
      ) : (
        <p className="mt-3 text-muted">{w.noMessage}</p>
      )}
      <p className="mt-3 text-xs text-muted">{w.note}</p>
      {slipHref && (
        <a href={slipHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center rounded-pill border border-edge px-4">
          {w.printSlip}
        </a>
      )}
    </Card>
  );
}
