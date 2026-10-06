import { t } from "@/lib/i18n";
import type { PackingSlip } from "@/server/packing-slips";

type SellerDetails = { legalName?: string | null; postalAddress?: string | null; contactEmail?: string | null };

/**
 * One packing slip (wave 3, D173, `docs/wave-3-orders.md` 2.5), drawn only from `packingSlipData()`: it has NO prices, no VAT, no totals and no payment, discount or invoice words,
 * because the data it is drawn from holds none (D27). In the ORDER's language. For a gift order it gains a block above the lines, *A gift for {To}* with the buyer's own words as
 * text (`white-space: pre-line`, escaped by React, never HTML) and *From {From}*; nothing else about the slip changes. `breakAfter` puts each slip of a bulk print on its own page.
 */
export function PackingSlipView({ slip, storeName, seller, breakAfter = false }: { slip: PackingSlip; storeName: string; seller: SellerDetails; breakAfter?: boolean }) {
  const m = t(slip.lang);
  const a = slip.shipTo;
  const address = [a.name, a.line1, a.line2, `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(), a.country].filter((part): part is string => Boolean(part && part.trim()));
  const gift = slip.gift;
  return (
    <article aria-label={`Packing slip ${slip.number}`} className="mx-auto flex max-w-2xl flex-col gap-6 bg-white p-8 text-black" style={breakAfter ? { breakAfter: "page" } : undefined}>
      <div>
        <p className="text-xl font-semibold">{storeName}</p>
        <p className="text-sm whitespace-pre-line">{[seller.legalName, seller.postalAddress, seller.contactEmail].filter(Boolean).join("\n")}</p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-medium">{m.deliverTo}</p>
          <address className="not-italic">
            {address.map((part, i) => (
              <span key={`${i}-${part}`} className="block">
                {part}
              </span>
            ))}
          </address>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{m.orderNumber}</p>
          <p className="text-2xl font-semibold">{slip.number}</p>
          <p className="text-sm">{new Date(slip.placedAt).toLocaleDateString(slip.locale, { dateStyle: "long" })}</p>
        </div>
      </div>
      {gift && (
        <section aria-label={m.gift.title} className="flex flex-col gap-2 border-2 border-black p-4">
          <p className="text-lg font-semibold">{gift.to ? m.gift.slip.heading(gift.to) : m.gift.slip.anonymous}</p>
          {gift.message && <p className="whitespace-pre-line">{gift.message}</p>}
          {gift.from && <p className="text-sm">{m.gift.slip.from(gift.from)}</p>}
        </section>
      )}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black">
            <th scope="col" className="py-2">
              {m.quantity}
            </th>
            <th scope="col" className="py-2">
              {m.products}
            </th>
            <th scope="col" className="py-2 text-right">
              SKU
            </th>
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((line, i) => (
            <tr key={`${i}-${line.sku}`} className="border-b border-neutral-300">
              <td className="py-2 pr-4 text-lg font-semibold">{line.quantity}</td>
              <td className="py-2">{line.title}</td>
              <td className="py-2 text-right font-mono text-sm">{line.sku}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-center text-lg">{m.thanks}</p>
    </article>
  );
}
