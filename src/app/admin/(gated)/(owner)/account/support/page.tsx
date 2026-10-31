import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { Inbox } from "@/components/admin/support/inbox";
import type { SupportDeskContext } from "@/components/admin/support/desk-context";
import { requireAccount } from "@/server/auth";
import { presence } from "@/server/support";
import { ownerDesks } from "@/server/support-desk";
import { openingInbox } from "@/server/support-inbox";

import {
  ownerSupportActAction,
  ownerSupportHeartbeatAction,
  ownerSupportPartnerAction,
  ownerSupportPresenceAction,
} from "./actions";

export const metadata: Metadata = { title: "Support" };

/**
 * The owner's combined support inbox (D216, 2.8, step 3): the conversations of every store where the account may read support, in one
 * list that can be narrowed to a store. A conversation opens through its store's own route, with that store's permissions.
 */
export default async function OwnerSupportPage() {
  const account = await requireAccount();
  const desks = await ownerDesks(account);
  if (desks.length === 0) notFound();
  const writable = desks.filter((d) => d.canWrite);
  const [{ feed: initial, tab: initialTab }, mine] = await Promise.all([
    openingInbox(desks),
    writable.length > 0
      ? presence(writable[0].desk, account.id)
      : Promise.resolve(null),
  ]);
  const context: SupportDeskContext = {
    level: "owner",
    feedUrl: "/admin/account/support/feed",
    conversationUrl: "/admin/{store}/support/c",
    stores: desks.flatMap((d) =>
      d.store ? [{ slug: d.store.slug, name: d.store.name }] : [],
    ),
    canWrite: writable.length > 0,
    presence: mine ? mine.status : null,
    partnerOn: mine ? mine.partner : null,
    actions: {
      heartbeat: ownerSupportHeartbeatAction,
      presence: writable.length > 0 ? ownerSupportPresenceAction : null,
      partner: writable.length > 0 ? ownerSupportPartnerAction : null,
      act:
        writable.length > 0
          ? { byStore: true, run: ownerSupportActAction }
          : null,
    },
  };
  return (
    <AdminTextScope
      texts={adminTexts(adminLangOf(account.adminLocale), ["support"])}
    >
      <Inbox context={context} initial={initial} initialTab={initialTab} />
    </AdminTextScope>
  );
}
