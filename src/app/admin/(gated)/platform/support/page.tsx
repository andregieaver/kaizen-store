import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { Inbox } from "@/components/admin/support/inbox";
import type { SupportDeskContext } from "@/components/admin/support/desk-context";
import { presence } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";
import { openingInbox } from "@/server/support-inbox";

import {
  kaizenSupportActAction,
  kaizenSupportHeartbeatAction,
  kaizenSupportPartnerAction,
  kaizenSupportPresenceAction,
} from "./actions";

export const metadata: Metadata = { title: "Support inbox" };

/**
 * Kaizen's own support inbox (D216, 2.8, step 3): conversations with visitors of Kaizen's site (and, later, owners asking Kaizen), for
 * platform admins. Never a store's conversations: those are their desks' alone. `?c=` opens one of its conversations, as a store's inbox
 * does (the questions the assistant could not answer link there, ecosystem plan E4.3).
 */
export default async function PlatformSupportPage({ searchParams }: PageProps<"/admin/platform/support">) {
  const c = (await searchParams).c;
  const initialOpen = typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  const desk = await kaizenDesk();
  const [{ feed: initial, tab: initialTab }, mine] = await Promise.all([
    openingInbox([desk]),
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
    shopUrl: "/",
    actions: {
      heartbeat: kaizenSupportHeartbeatAction,
      presence: kaizenSupportPresenceAction,
      partner: kaizenSupportPartnerAction,
      act: { byStore: false, run: kaizenSupportActAction },
    },
  };
  return (
    <AdminTextScope
      texts={areaTexts(adminLangOf(desk.account.adminLocale), { support: SUPPORT_WORDS })}
    >
      <Inbox context={context} initial={initial} initialTab={initialTab} initialOpen={initialOpen} />
    </AdminTextScope>
  );
}
