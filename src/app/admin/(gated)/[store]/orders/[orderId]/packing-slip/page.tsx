import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PrintButton } from "@/components/admin/print-button";
import { t } from "@/lib/i18n";
import { requireMember } from "@/server/auth";
import { getOrderAdmin } from "@/server/order-admin";

export const metadata: Metadata = { title: "Packing slip" };

/** A packing slip to print and put in the parcel, in the customer's language, without prices (D27). */
export default async function PackingSlipPage({
  params,
}: PageProps<"/admin/[store]/orders/[orderId]/packing-slip">) {
  const { store: slug, orderId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(orderId).success) notFound();
  const order = await getOrderAdmin(store.id, orderId);
  if (!order) notFound();
  const m = t(order.locale.split("-")[0]);
  const a = order.shippingAddress;
  const d = store.details;
  const shipped = order.lines.filter((line) => line.delivery === "physical");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 bg-white p-8 text-black">
      {/* Only the slip itself is printed. */}
      <style>{"@media print { body > *:not(main), header, nav { display: none !important } main { padding: 0 !important } }"}</style>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xl font-semibold">{store.name}</p>
          <p className="text-sm whitespace-pre-line">
            {[d.legalName, d.postalAddress, d.contactEmail].filter(Boolean).join("\n")}
          </p>
        </div>
        <PrintButton label="Print" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-medium">{m.deliverTo}</p>
          <address className="not-italic">
            {[a.name, a.line1, a.line2, `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(), a.country]
              .filter((part) => part && part.trim())
              .map((part) => (
                <span key={part} className="block">
                  {part}
                </span>
              ))}
          </address>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{m.orderNumber}</p>
          <p className="text-2xl font-semibold">{order.number}</p>
          <p className="text-sm">{new Date(order.placedAt).toLocaleDateString(order.locale, { dateStyle: "long" })}</p>
        </div>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black">
            <th scope="col" className="py-2">{m.quantity}</th>
            <th scope="col" className="py-2">{m.products}</th>
            <th scope="col" className="py-2 text-right">SKU</th>
          </tr>
        </thead>
        <tbody>
          {shipped.map((line) => (
            <tr key={line.id} className="border-b border-neutral-300">
              <td className="py-2 pr-4 text-lg font-semibold">{line.quantity}</td>
              <td className="py-2">{line.title}</td>
              <td className="py-2 text-right font-mono text-sm">{line.sku}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-center text-lg">{m.thanks}</p>
    </div>
  );
}
