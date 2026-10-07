import type { Messages } from "@/lib/i18n";
import type { ShopperFulfilment } from "@/server/fulfilment";

/** A tracking address staff typed (or a carrier gave) is linked only when it is a web address; anything else is shown as text. */
const webAddress = (url: string | null): string | null => (url && /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null);

/**
 * The parcels of an order and what is still to come (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4), on the shopper's order page (a pay route: this is a server component that imports
 * no zod and no server code, only a type) and on My account's order page. Under a heading that names the order's state (*Partly sent*, *Sent*), each parcel in the order it was sent: its
 * number, the day, the carrier and tracking (linked when the address is a web address), and the lines and quantities in it. A parcel recorded before parcels named their lines (`legacy`)
 * shows as before, carrier and tracking only. Then *Still to come*: the units not yet sent, with the backorder words of D172 for units on backorder. For a private buyer whose goods come in
 * more than one parcel, one sentence says the right of withdrawal counts from the last parcel (CRD Art. 9(2)(b), `m.fulfilment.receipt`, hand-written, needs legal review). Draws nothing
 * before the first parcel.
 */
export function OrderShipments({
  fulfilment,
  m,
  locale,
  timeZone,
  business = false,
}: {
  fulfilment: ShopperFulfilment | null;
  m: Pick<Messages, "fulfilment" | "backorder">;
  locale: string;
  timeZone?: string;
  /** Bought for a business: no statutory right of withdrawal, so no sentence about when it counts from. */
  business?: boolean;
}) {
  if (!fulfilment || fulfilment.parcels.length === 0) return null;
  const f = m.fulfilment;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long", ...(timeZone ? { timeZone } : {}) });
  const inParts = fulfilment.stillToCome.length > 0 || fulfilment.parcels.length > 1;
  return (
    <section aria-labelledby="order-shipments" className="flex flex-col gap-4 rounded-lg border border-border p-4" data-order-shipments={fulfilment.state}>
      <h2 id="order-shipments" className="font-medium">
        {f.states[fulfilment.state]}
      </h2>
      <ol className="flex flex-col gap-4">
        {fulfilment.parcels.map((parcel, index) => {
          const href = webAddress(parcel.trackingUrl);
          return (
            <li key={parcel.id} className="flex flex-col gap-1" data-parcel>
              <h3 className="font-medium">
                {f.parcel(index + 1)} · {f.sentOn(date(parcel.createdAt))}
              </h3>
              {(parcel.carrier || parcel.trackingNumber) && (
                <p className="text-sm">
                  {parcel.carrier}
                  {parcel.carrier && parcel.trackingNumber && " "}
                  {parcel.trackingNumber && <span className="font-mono">{parcel.trackingNumber}</span>}
                </p>
              )}
              {href && (
                <p className="text-sm">
                  <a href={href} target="_blank" rel="noreferrer" className="underline">
                    {f.track}
                    <span className="sr-only"> ({f.parcel(index + 1)})</span>
                  </a>
                </p>
              )}
              {parcel.lines.length > 0 && (
                <ul aria-label={`${f.parcel(index + 1)}: ${f.contents}`} className="text-sm">
                  {parcel.lines.map((line) => (
                    <li key={line.lineId}>{`${line.quantity} × ${line.title}`}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {fulfilment.stillToCome.length > 0 && (
        <div className="flex flex-col gap-1" data-still-to-come>
          <h3 className="font-medium">{f.stillToCome}</h3>
          <ul className="text-sm">
            {fulfilment.stillToCome.map((line) => (
              <li key={line.lineId}>
                {`${line.quantity} × ${line.title}`}
                {line.backordered > 0 && line.backorderDays !== null && (
                  <span className="block text-muted" data-backorder>
                    {m.backorder.line(line.backordered, line.backorderDays)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {inParts && !business && <p className="text-sm">{f.receipt}</p>}
    </section>
  );
}
