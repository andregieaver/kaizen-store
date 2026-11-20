import type { ReactNode } from "react";

import { OrderCustomsNote, OrderCustomsRows } from "./order-customs";
import { OrderVatNotes, OrderVatRelief, OrderVatRows } from "./order-vat";
import { StaffDiscountRow } from "./staff-discount-row";
import { discountNote } from "@/lib/customer-tiers";
import { pickupPointLine } from "@/lib/delivery-options";
import { deliveryRowLabel } from "@/lib/delivery-words";
import type { Messages } from "@/lib/i18n";
import { formatWindow } from "@/lib/porterbuddy";
import { vatText } from "@/lib/vat-text";
import type { OrderView } from "@/server/orders";

/**
 * An order's totals as a shopper sees them (bloat review step 3.16, D833): the order confirmation and My account's order page draw them
 * from here, and checkout takes its delivery rows. It moves the pages' rows as they were; every amount goes through the page's `money`.
 */

type Money = (minor: number) => string;

/** What the delivery rows read of an order. */
export type DeliveryOrder = Pick<OrderView, "ships" | "delivery" | "deliveryKept" | "locale">;

/** What the totals read of an order: the shopper's order (`getShopperOrder()`) and My account's (`getOrderAdmin()`) both are one. */
export type TotalsOrder = DeliveryOrder &
  Parameters<typeof OrderVatRows>[0]["order"] &
  Parameters<typeof OrderCustomsRows>[0]["order"] &
  Parameters<typeof StaffDiscountRow>[0]["order"] &
  Parameters<typeof discountNote>[0] &
  Pick<OrderView, "shippingMinor" | "discountMinor" | "referralDiscountMinor" | "bonus" | "totalMinor" | "taxMinor" | "balanceMinor" | "company"> & {
    refundedMinor?: number;
  };

/** The delivery row with its amount, then the pickup point and the delivery window, each only for an order that ships. */
export function OrderDeliveryRows({ order, m, timeZone, amount }: { order: DeliveryOrder; m: Messages; timeZone: string; amount: ReactNode }) {
  return (
    <>
      {order.ships && (
        <div className="flex justify-between">
          <dt>{deliveryRowLabel(order.deliveryKept ?? order.delivery, m)}</dt>
          <dd>{amount}</dd>
        </div>
      )}
      {order.ships && order.delivery?.pickupPoint && (
        <p className="text-sm text-muted">{m.deliveryChoice.pickupAt(pickupPointLine(order.delivery.pickupPoint))}</p>
      )}
      {order.ships && order.delivery?.window && (
        <p className="text-sm text-muted">{m.deliveryChoice.windowLine(formatWindow(order.delivery.window, order.locale, timeZone))}</p>
      )}
    </>
  );
}

/**
 * The totals list and the VAT and customs notes under it. `balanceAtVenue` shows what is still to pay at an appointment (the confirmation
 * leaves it out for an order on payment terms); `refundedLabel` adds the refunded row (My account's page).
 */
export function OrderTotals({
  order,
  m,
  lang,
  timeZone,
  money,
  className,
  balanceAtVenue,
  refundedLabel,
}: {
  order: TotalsOrder;
  m: Messages;
  lang: string;
  timeZone: string;
  money: Money;
  className?: string;
  balanceAtVenue?: boolean;
  refundedLabel?: string;
}) {
  const vatWords = vatText(lang);
  const note = discountNote(order);
  return (
    <>
      <dl className={className ?? "flex flex-col gap-1"}>
        <OrderDeliveryRows order={order} m={m} timeZone={timeZone} amount={order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)} />
        {order.discountMinor > 0 && (
          <div className="flex justify-between">
            <dt>
              {m.discount}
              {note && <span className="text-sm text-muted"> ({note})</span>}
            </dt>
            <dd>−{money(order.discountMinor)}</dd>
          </div>
        )}
        {/* The discount staff gave on a draft order (D173), under the name they gave it. */}
        <StaffDiscountRow order={order} fallback={m.discount} money={money} />
        {order.referralDiscountMinor > 0 && (
          // The friend's welcome discount (D131).
          <div className="flex justify-between">
            <dt>{m.affiliate.discountRow}</dt>
            <dd>−{money(order.referralDiscountMinor)}</dd>
          </div>
        )}
        {order.bonus && order.bonus.usedMinor > 0 && (
          // Bonus credits used (D130).
          <div className="flex justify-between">
            <dt>{m.bonus.usedRow}</dt>
            <dd>−{money(order.bonus.usedMinor)}</dd>
          </div>
        )}
        <OrderVatRelief order={order} text={vatWords} money={money} />
        <div className="flex justify-between font-semibold">
          <dt>{m.total}</dt>
          <dd>{money(order.totalMinor)}</dd>
        </div>
        <OrderVatRows order={order} text={vatWords} money={money} label={m.vatAmount} />
        <OrderCustomsRows order={order} lang={lang} money={money} paidLabel={m.toPay} />
        {balanceAtVenue && order.balanceMinor > 0 && (
          // Paid at the appointment (D66): what is still to pay there.
          <div className="flex justify-between">
            <dt>{m.booking.atVenue}</dt>
            <dd>{money(order.balanceMinor)}</dd>
          </div>
        )}
        {order.company && (
          // Bought for a business (B2B): the total without VAT, and whom for.
          <>
            <div className="flex justify-between text-sm text-muted">
              <dt>{m.totalExclVat}</dt>
              <dd>{money(order.totalMinor - order.taxMinor)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm">
              <dt>{order.company.name}</dt>
              <dd>
                {m.company.number}: {order.company.number}
              </dd>
            </div>
          </>
        )}
        {refundedLabel && (order.refundedMinor ?? 0) > 0 && (
          <div className="flex justify-between text-sm">
            <dt>{refundedLabel}</dt>
            <dd>−{money(order.refundedMinor ?? 0)}</dd>
          </div>
        )}
      </dl>
      <OrderVatNotes order={order} text={vatWords} />
      <OrderCustomsNote order={order} lang={lang} money={money} />
    </>
  );
}
