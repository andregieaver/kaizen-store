import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { BULK_PRINT_MAX } from "@/lib/order-bulk";
import { labelsToPrint } from "@/server/bulk-labels";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Labels" };

/** The ids of the address: comma separated, at most one more than the limit is read (so "too many" can be said). */
function idsOf(value: string | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(",") : (value ?? "");
  return text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, BULK_PRINT_MAX + 1);
}

/**
 * The labels *Book labels* booked on the Orders list (wave 10 unit K, D374), one after another to print: each is the order's own label route
 * (`/orders/{order}/label/{shipment}`, `carrierLabel()`), fetched from the carrier's own host with the store's agreement when it is shown and never kept,
 * drawn in the browser's PDF viewer, where it is printed. At most 100, as the action books; parcels undone since, without a label or of another store are
 * left out and counted. `orders:read`; it changes nothing.
 */
export default async function LabelsPage({ params, searchParams }: PageProps<"/admin/[store]/orders/labels">) {
  const { store: slug } = await params;
  const gated = await requirePermission(slug, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = adminText(adminLangOf(gated.account.adminLocale), "orders");
  const w = words.labels;
  const back = { href: `/admin/${store.slug}/orders`, label: words.pick.back };
  const ids = idsOf((await searchParams).ids);
  if (ids.length > BULK_PRINT_MAX) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader back={back} title={w.title} />
        <p role="alert" className="rounded-panel bg-sunken p-4 text-sm">
          {fillWords(w.tooMany, { max: BULK_PRINT_MAX })}
        </p>
      </div>
    );
  }
  const { labels, missing } = await labelsToPrint(store.id, ids);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={back} title={w.title} description={labels.length > 0 ? countWords(labels.length, w.ready) : undefined} />
      {labels.length === 0 && (
        <p role="status" className="rounded-panel bg-sunken p-4 text-sm">
          {w.none}
        </p>
      )}
      {missing > 0 && labels.length > 0 && (
        <p role="status" className="rounded-panel bg-sunken p-4 text-sm">
          {countWords(missing, w.gone)}
        </p>
      )}
      {labels.map((label) => {
        const href = `/admin/${store.slug}/orders/${label.orderId}/label/${label.shipmentId}`;
        const title = fillWords(w.order, { number: label.number });
        return (
          <Card
            key={label.shipmentId}
            title={title}
            aside={[label.carrier, label.trackingNumber].filter(Boolean).join(" · ")}
          >
            <div className="flex flex-col gap-3">
              <iframe src={href} title={fillWords(w.frame, { number: label.number })} loading="lazy" className="h-[70vh] w-full rounded-panel border border-line bg-sunken" />
              <div>
                <ButtonLink href={href} target="_blank">
                  {w.open}
                </ButtonLink>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
