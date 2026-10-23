import type { Metadata } from "next";

import { DomainMoveIn } from "@/components/admin/domain-move-in";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { apexOf } from "@/lib/domain-health";
import { storeZones } from "@/server/domain-dns";
import { arrivingZones, checkArrivals, VERCEL_NAMESERVERS } from "@/server/domain-move-in";
import { buyingOpen } from "@/server/domain-purchases";
import { suggestedRegistrant } from "@/server/domain-registrant";
import { storeRegistrations } from "@/server/domain-registrations";
import { listStoreDomains } from "@/server/domains";
import { requireOwnerRole } from "@/server/permissions";

import { lookDnsMoveAction, quoteTransferAction, startDnsMoveAction, startTransferAction, stopDnsMoveAction } from "./actions";

export const metadata: Metadata = { title: "Bring a domain here" };

/**
 * Bringing a domain the store has elsewhere to Kaizena Flow (D315 phase 6, `docs/domains.md` 5.4 and 8.5): its DNS, its registration, or
 * both. Owners only. Zones on their way here are checked as the page is opened.
 */
export default async function MoveInPage({ params }: PageProps<"/admin/[store]/settings/domains/move-in">) {
  const { store: slug } = await params;
  const member = await requireOwnerRole(slug);
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "domains");
  const words = all.moveIn;
  await checkArrivals({ storeId: member.store.id }).catch(() => []);
  const [domains, zones, registrations, arriving, open] = await Promise.all([
    listStoreDomains(member.store.id),
    storeZones(member.store.id),
    storeRegistrations(member.store.id),
    arrivingZones(member.store.id),
    buyingOpen(member.store.id),
  ]);
  const kept = new Set(zones.map((z) => z.apex));
  const movable = [
    ...new Set([
      ...domains.filter((d) => d.status === "active").map((d) => apexOf(d.hostname)),
      ...registrations.filter((r) => r.status !== "transferred_out").map((r) => r.apex),
    ]),
  ]
    .filter((apex) => !kept.has(apex))
    .sort();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${slug}/settings/domains`, label: words.back }} title={words.title} description={words.intro} />
      <DomainMoveIn
        domains={movable}
        arriving={arriving.map((z) => ({ apex: z.apex, nameservers: VERCEL_NAMESERVERS }))}
        canBuy={open}
        closedWhy={open ? null : all.get.notOpen}
        registrant={suggestedRegistrant(member)}
        words={words}
        getWords={all.get}
        locale={ADMIN_LANG_FACTS[lang].locale}
        actions={{
          quote: quoteTransferAction.bind(null, slug),
          transfer: startTransferAction.bind(null, slug),
          look: lookDnsMoveAction.bind(null, slug),
          start: startDnsMoveAction.bind(null, slug),
          stop: stopDnsMoveAction.bind(null, slug),
        }}
      />
    </div>
  );
}
