import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { NotificationList } from "@/components/admin/notifications/notification-list";
import { SendingDomainCard } from "@/components/admin/sending-domain-card";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { fillWords } from "@/lib/admin-fill";
import { apexOf } from "@/lib/domain-health";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { PageHeader } from "@/components/admin/ui";
import { listLocalAreas } from "@/server/local-delivery";
import { listNotifications } from "@/server/notifications";
import { memberCan, requirePermission } from "@/server/permissions";
import { listStoreDomains } from "@/server/domains";
import { listPickupPlaces } from "@/server/pickup";
import { getSendingDomain, sendingDomainView } from "@/server/sending-domains";

import { sendingDomainAction, switchNotificationAction } from "./actions";

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
  const words = NOTIFICATIONS_WORDS[lang];
  const w = words.emails;
  const [items, places, areas, sending, domains] = await Promise.all([
    listNotifications(store.id),
    listPickupPlaces(store.id),
    listLocalAreas(store.id),
    getSendingDomain(store.id),
    listStoreDomains(store.id),
  ]);
  // The store's own domain is filled in for a new sending domain (D727): the primary one, else the first active.
  const ownDomain = (domains.find((d) => d.isPrimary && d.status === "active") ?? domains.find((d) => d.status === "active"))?.hostname ?? null;
  const handovers = places.some((p) => p.option?.active) || areas.some((a) => a.active);
  const canWrite = memberCan(member, "settings:write");
  const base = `/admin/${store.slug}/settings/notifications`;
  const view = sending && sendingDomainView(sending);
  const sd = words.sendingDomain;
  // The phone's line for the sending address (round 41, D737): where emails go from now.
  const sendingLine = !view
    ? w.phone.shared
    : view.status === "verified"
      ? fillWords(sd.verified, { from: view.from })
      : fillWords(view.status === "failed" ? sd.failed : sd.pending, { domain: view.domain });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.lead}
        actions={
          memberCan(member, "owner") ? (
            <Link href={`${base}/staff`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
              {w.staffAlerts}
            </Link>
          ) : undefined
        }
      />
      {/* On a phone (round 41, D737) the sending address is a row after the emails, saying where they go from now. */}
      <PhoneRows className="max-sm:order-1">
        <PhoneRow flat last title={sd.title} sub={sendingLine} change={view ? w.phone.change : w.phone.setUp} done={w.phone.close}>
          <SendingDomainCard
            domain={view}
            suggested={ownDomain ? apexOf(ownDomain) : null}
            words={words.sendingDomain}
            action={canWrite ? sendingDomainAction.bind(null, store.slug) : null}
            display={ADMIN_LANG_FACTS[lang].tag}
            timeZone={store.timeZone}
          />
        </PhoneRow>
      </PhoneRows>
      <NotificationList items={items} base={base} handovers={handovers} words={words} display={ADMIN_LANG_FACTS[lang].tag} switchAction={canWrite ? (id) => switchNotificationAction.bind(null, store.slug, id) : null} />
      {!canWrite && <p className="text-sm text-muted">{w.readOnly}</p>}
      {/* Round 22 (D687): the long words on how the emails work, and what Kaizena Flow always adds, one press away. */}
      <details className="rounded-lg border border-line bg-card px-5 max-sm:order-2 max-sm:px-4">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 text-body text-ink [&::-webkit-details-marker]:hidden">
          {w.howTitle}
          <span className="text-sm font-medium underline underline-offset-2">{w.read}</span>
        </summary>
        <div className="flex flex-col gap-3 pb-5 text-body text-ink-2">
          <p>{withItalics(w.description, { alwaysOn: w.alwaysOnWord, notify: w.notifyWord })}</p>
          <h2 className="text-body-strong text-ink">{w.addsTitle}</h2>
          <p>{w.addsDescription}</p>
          <p>{w.addsText}</p>
        </div>
      </details>
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
