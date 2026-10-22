import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { NotificationList } from "@/components/admin/notifications/notification-list";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
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
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const w = words.emails;
  const [items, places, areas] = await Promise.all([listNotifications(store.id), listPickupPlaces(store.id), listLocalAreas(store.id)]);
  const handovers = places.some((p) => p.option?.active) || areas.some((a) => a.active);
  const canWrite = memberCan(member, "settings:write");
  const base = `/admin/${store.slug}/settings/notifications`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{withItalics(w.description, { alwaysOn: w.alwaysOnWord, notify: w.notifyWord })}</>}
        actions={
          memberCan(member, "owner") ? (
            <Link href={`${base}/staff`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
              {w.staffAlerts}
            </Link>
          ) : undefined
        }
      />
      <NotificationList items={items} base={base} handovers={handovers} words={words} display={ADMIN_LANG_FACTS[lang].tag} switchAction={canWrite ? (id) => switchNotificationAction.bind(null, store.slug, id) : null} />
      {!canWrite && <p className="text-sm text-muted">{w.readOnly}</p>}
      <Card title={w.addsTitle} description={w.addsDescription}>
        <p className="text-body text-ink-2">{w.addsText}</p>
      </Card>
    </div>
  );
}

/** A sentence with `{name}` slots drawn as italic words (the names of a state and a box the page refers to). */
function withItalics(text: string, values: Record<string, string>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return key && key in values ? <em key={i}>{values[key]}</em> : part;
  });
}
