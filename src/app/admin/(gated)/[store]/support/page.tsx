import type { Metadata } from "next";

import { Inbox } from "@/components/admin/support/inbox";
import type { SupportDeskContext } from "@/components/admin/support/desk-context";
import { requirePermission } from "@/server/permissions";
import { presence } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { inboxFeed } from "@/server/support-inbox";

import { supportActAction, supportHeartbeatAction, supportPartnerAction, supportPresenceAction } from "./actions";

export const metadata: Metadata = { title: "Support inbox" };

/**
 * A store's support inbox (D216, `docs/support.md` 2.4, step 3): every conversation with the store's customers as it happens, for
 * members who may read support; those who may write take conversations over, answer, hand them on or back and end them (step 4).
 */
export default async function SupportInboxPage({ params }: PageProps<"/admin/[store]/support">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const [initial, mine] = await Promise.all([inboxFeed([staff], { tab: "waiting" }), presence(staff.desk, staff.account.id)]);
  const context: SupportDeskContext = {
    level: "store",
    feedUrl: `/admin/${slug}/support/feed`,
    conversationUrl: `/admin/${slug}/support/c`,
    stores: [],
    canWrite: staff.canWrite,
    presence: staff.canWrite ? mine.status : null,
    partnerOn: staff.canWrite ? mine.partner : null,
    actions: {
      heartbeat: supportHeartbeatAction.bind(null, slug),
      presence: staff.canWrite ? supportPresenceAction.bind(null, slug) : null,
      partner: staff.canWrite ? supportPartnerAction.bind(null, slug) : null,
      act: staff.canWrite ? { byStore: false, run: supportActAction.bind(null, slug) } : null,
    },
  };
  return <Inbox context={context} initial={initial} initialTab="waiting" />;
}
