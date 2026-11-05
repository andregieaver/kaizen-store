"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parcelLinesInput } from "@/lib/parcel-input";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { carrierInfo } from "@/lib/shipping-carriers";

import { checkPermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { bookCarrierDelivery, isDeliveryBookingCarrier } from "@/server/carrier-delivery-booking";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { sendShipped } from "@/server/shopper-emails";

/** Refused before a member is known: the session's language (D312). */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;
const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;

const bookInput = z.object({
  notify: z.boolean(),
  parcel: z.unknown(),
  /** The service staff chose (UPS and DHL), for an order whose customer chose none of the carrier's. */
  serviceId: z.string().max(40).nullish(),
  /** What goes in this parcel (D174); none = everything still to send. */
  lines: parcelLinesInput,
  /** The order's fulfilment as the page showed it (D372): a press made before it showed the last parcel is refused. */
  seen: z.string().max(100).nullish(),
  /** Ask the carrier to collect the parcel (D459), in the hours on its page. */
  collect: z.boolean().optional(),
});

/**
 * Books an order's parcel with Instabox, UPS or DHL Express (D458): the delivery the customer chose at checkout, or a service staff chose (UPS and
 * DHL). A real booking marks the order as sent (and tells the customer when asked), a test one only says it worked.
 */
export async function carrierDeliveryBookAction(storeSlug: string, carrier: string, orderId: string, raw: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  if (!isDeliveryBookingCarrier(carrier) || !z.uuid().safeParse(orderId).success) return { ok: false, message: w.gone };
  const order = await getOrder(member.store.id, orderId);
  if (!order) return { ok: false, message: w.gone };
  if (order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: input.error.issues.some((i) => i.path[0] === "lines") ? w.lineNotWhole : w.enterWeight };
  const name = carrierInfo(carrier)?.name ?? carrier;
  const booked = await bookCarrierDelivery(member.account.id, member.store.id, orderId, carrier, {
    ...input.data,
    collect: input.data.collect ? { timeZone: member.store.timeZone || "Europe/Oslo" } : null,
  });
  if (!booked.ok) return { ok: false, message: booked.problem };
  // What the carrier said to the collection asked for (D459): booked with its day, or why not, so staff arrange it themselves.
  const lang = adminLangOf(member.account.adminLocale);
  const collected = !booked.collection
    ? ""
    : booked.collection.booked
      ? fillWords(booked.collection.confirmation ? w.collectedOn : w.collectedOnNoNumber, {
          carrier: name,
          date: new Date(`${booked.collection.date}T12:00:00Z`).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
          confirmation: booked.collection.confirmation ?? "",
        })
      : fillWords(w.collectionFailed, { carrier: name, problem: booked.collection.problem ?? "" });
  if (booked.test) return { ok: true, message: `${fillWords(w.carrierTest, { carrier: name, tracking: booked.trackingNumber })}${collected}` };
  if (input.data.notify) await sendShipped(member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: `${fillWords(w.booked, { carrier: name, tracking: booked.shipment.trackingNumber ?? "", told: input.data.notify ? w.andTold : "" })}${collected}` };
}
