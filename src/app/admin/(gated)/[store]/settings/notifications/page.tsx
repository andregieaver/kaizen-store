import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { NotificationList } from "@/components/admin/notifications/notification-list";
import { Card, PageHeader } from "@/components/admin/ui";
import { listLocalAreas } from "@/server/local-delivery";
import { listNotifications } from "@/server/notifications";
import { memberCan, requirePermission } from "@/server/permissions";
import { listPickupPlaces } from "@/server/pickup";

import { switchNotificationAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The store's customer notifications (wave 3, D238, `docs/wave-3-notifications.md` 2.1): every order and return email, its switch and which languages
 * have the store's own words. `settings:read` sees it; `settings:write` switches (the action asks again). Part of the online shop: hidden while it is off.
 */
export default async function NotificationsPage({ params }: PageProps<"/admin/[store]/settings/notifications">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const [items, places, areas] = await Promise.all([listNotifications(store.id), listPickupPlaces(store.id), listLocalAreas(store.id)]);
  const handovers = places.some((p) => p.option?.active) || areas.some((a) => a.active);
  const canWrite = memberCan(member, "settings:write");
  const base = `/admin/${store.slug}/settings/notifications`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={
          <>
            The emails your customers get about their orders and returns. The order confirmation and the acknowledgement of a withdrawal are required by law,
            and the other emails marked <em>Always on</em> carry what customers need: they cannot be switched off. Switching an email off also unticks{" "}
            <em>Notify the customer</em> where staff send, refund or cancel an order. Text you write yourself is your responsibility.
          </>
        }
        actions={
          memberCan(member, "owner") ? (
            <Link href={`${base}/staff`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
              Staff alerts
            </Link>
          ) : undefined
        }
      />
      <NotificationList items={items} base={base} handovers={handovers} switchAction={canWrite ? (id) => switchNotificationAction.bind(null, store.slug, id) : null} />
      {!canWrite && <p className="text-sm text-muted">You can see the store&apos;s emails but not change them.</p>}
      <Card title="What Kaizena Flow always adds" description="Your words replace the subject, the heading and the first text of an email. The rest stays Kaizena Flow's, so nothing the law or the money needs can be removed.">
        <p className="text-body text-ink-2">
          The order lines, totals, VAT statement, invoice link, tracking, pickup details and the right of withdrawal are always added by Kaizena Flow, in the
          order&apos;s own language and currency.
        </p>
      </Card>
    </div>
  );
}
