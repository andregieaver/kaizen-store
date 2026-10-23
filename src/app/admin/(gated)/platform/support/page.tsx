import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { Inbox } from "@/components/admin/support/inbox";
import type { SupportDeskContext } from "@/components/admin/support/desk-context";
import { presence } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";
import { inboxFeed } from "@/server/support-inbox";

import {
  kaizenSupportActAction,
  kaizenSupportHeartbeatAction,
  kaizenSupportPartnerAction,
  kaizenSupportPresenceAction,
} from "./actions";

export const metadata: Metadata = { title: "Support inbox" };

/**
 * Kaizen's own support inbox (D216, 2.8, step 3): conversations with visitors of Kaizen's site (and, later, owners asking Kaizen), for
 * platform admins. Never a store's conversations: those are their desks' alone.
 */
export default async function PlatformSupportPage() {
  const desk = await kaizenDesk();
  const [initial, mine] = await Promise.all([
    inboxFeed([desk], { tab: "waiting" }),
    presence(desk.desk, desk.account.id),
  ]);
  const context: SupportDeskContext = {
    level: "platform",
    feedUrl: "/admin/platform/support/feed",
    conversationUrl: "/admin/platform/support/c",
    stores: [],
    canWrite: true,
    presence: mine.status,
    partnerOn: mine.partner,
    actions: {
      heartbeat: kaizenSupportHeartbeatAction,
      presence: kaizenSupportPresenceAction,
      partner: kaizenSupportPartnerAction,
      act: { byStore: false, run: kaizenSupportActAction },
    },
  };
  return (
    <AdminTextScope
      texts={adminTexts(adminLangOf(desk.account.adminLocale), ["support"])}
    >
      <Inbox context={context} initial={initial} initialTab="waiting" />
    </AdminTextScope>
  );
}
