import type { AnyOrderDelivery } from "@/lib/delivery-options";
import { pickupPlaceLine } from "@/lib/delivery-options";
import { openingHoursLines } from "@/lib/delivery-email";
import { readyInText } from "@/lib/delivery-words";
import type { Messages } from "@/lib/i18n";

/**
 * How a paid order reaches the buyer when it is the store's own delivery (D237, `docs/wave-3-shipping-methods.md` 2.4), on the order page (a pay route:
 * a server component, no zod in the browser) and My account's order page. A pickup order: *Collect at {place}* with the address, the next seven days'
 * hours and the instructions as the order kept them (editing the place later changes nothing here), then where it stands (*Collected on*, *Ready for
 * pickup since*, or how soon it is usually ready) and what to bring. A local delivery: the area, its information and the buyer's note for the driver.
 * A method's transit time. Nothing for a carrier's service or the flat rate (the summary's row names them).
 */
export function DeliveryBlock({
  order,
  m,
  locale,
  timeZone,
  now = new Date(),
}: {
  order: {
    deliveryKept: AnyOrderDelivery | null;
    readyForPickupAt: string | null;
    deliveredAt: string | null;
    deliveryNote: string | null;
    status: string;
  };
  m: Pick<Messages, "deliveryOptions" | "deliveryChoice">;
  locale: string;
  timeZone: string;
  now?: Date;
}) {
  const kept = order.deliveryKept;
  if (!kept) return null;
  const d = m.deliveryOptions;
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long", timeZone });
  if (kept.kind === "method") {
    if (!kept.estimate) return null;
    const range = kept.estimate.min === kept.estimate.max ? String(kept.estimate.min) : `${kept.estimate.min}–${kept.estimate.max}`;
    return (
      <p className="text-sm text-muted" data-delivery-block="method">
        {m.deliveryChoice.workingDays(range)}
      </p>
    );
  }
  if (kept.kind === "local") {
    return (
      <section aria-labelledby="delivery-block-heading" className="flex flex-col gap-2 rounded-lg border border-border p-4" data-delivery-block="local">
        <h2 id="delivery-block-heading" className="font-medium">
          {d.localLine(kept.label)}
        </h2>
        {kept.info.trim() && <p className="text-sm whitespace-pre-line">{kept.info.trim()}</p>}
        {order.deliveryNote && (
          <div className="text-sm">
            <h3 className="font-medium">{d.yourNote}</h3>
            <p className="whitespace-pre-line">{order.deliveryNote}</p>
          </div>
        )}
      </section>
    );
  }
  if (kept.kind !== "pickup") return null;
  const hours = openingHoursLines(kept.hours, { locale, timeZone, now, closed: d.closed });
  const paid = order.status === "paid" || order.status === "fulfilled" || order.status === "closed";
  const where = order.deliveredAt
    ? d.collectedOn(day(order.deliveredAt))
    : order.readyForPickupAt
      ? d.readySince(day(order.readyForPickupAt))
      : paid
        ? readyInText(kept.readyInHours, m)
        : null;
  return (
    <section aria-labelledby="delivery-block-heading" className="flex flex-col gap-2 rounded-lg border border-border p-4" data-delivery-block="pickup">
      <h2 id="delivery-block-heading" className="font-medium">
        {d.collectAt(kept.label)}
      </h2>
      <p className="text-sm">{pickupPlaceLine(kept)}</p>
      {where && (
        <p role="status" className="text-sm font-medium">
          {where}
        </p>
      )}
      {hours.length > 0 && !order.deliveredAt && (
        <div className="text-sm">
          <h3 className="font-medium">{d.openingHours}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4">
            {hours.map((row) => (
              <div key={row.label} className="contents">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {kept.instructions.trim() && !order.deliveredAt && (
        <div className="text-sm">
          <h3 className="font-medium">{d.instructions}</h3>
          <p className="whitespace-pre-line">{kept.instructions.trim()}</p>
        </div>
      )}
      {!order.deliveredAt && paid && <p className="text-sm text-muted">{d.bringNumber}</p>}
    </section>
  );
}
