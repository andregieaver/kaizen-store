import type { GiftFields } from "@/lib/gift";

/**
 * The buyer's gift on the order page (wave 3, D173, `docs/wave-3-orders.md` 2.3): *To*, *From* and the message in full, as TEXT (line breaks kept with `white-space: pre-wrap`, escaped by
 * React, never HTML). Staff cannot edit it: it is the buyer's own words, frozen once the order is placed. *Print gift slip* opens the packing slip, which is the price-free page the
 * message is printed on; the slip is only for an order with something to ship (`canPrint`).
 */
export function GiftCard({ gift, slipHref }: { gift: GiftFields; slipHref: string | null }) {
  return (
    <section aria-labelledby="gift" className="rounded-lg border border-border bg-background p-5 text-sm">
      <h2 id="gift" className="mb-2 font-medium">
        Gift
      </h2>
      <dl className="flex flex-col gap-1">
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-muted">To</dt>
          <dd className="min-w-0 break-words">{gift.to ?? "–"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-muted">From</dt>
          <dd className="min-w-0 break-words">{gift.from ?? "–"}</dd>
        </div>
      </dl>
      {gift.message ? (
        <blockquote className="mt-3 border-l-2 border-border pl-3 whitespace-pre-wrap break-words">{gift.message}</blockquote>
      ) : (
        <p className="mt-3 text-muted">No message.</p>
      )}
      <p className="mt-3 text-xs text-muted">The buyer wrote this at checkout. It is printed on the packing slip, which has no prices. It is not sent to the recipient.</p>
      {slipHref && (
        <a href={slipHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center rounded-md border border-border px-4">
          Print gift slip
        </a>
      )}
    </section>
  );
}
