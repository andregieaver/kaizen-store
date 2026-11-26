import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { Inbox } from "@/components/admin/support/inbox";
import type { SupportDeskContext } from "@/components/admin/support/desk-context";
import { memberCan, requirePermission } from "@/server/permissions";
import { presence } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { openingInbox } from "@/server/support-inbox";
import { storeBase, storeHref } from "@/lib/paths";
import { areaTexts } from "@/lib/admin-area";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";

import {
  supportActAction,
  supportHeartbeatAction,
  supportPartnerAction,
  supportPresenceAction,
} from "./actions";
import { carryOutRequestAction, decideRequestAction } from "./requests/actions";
import { requireExtension } from "@/components/admin/extension-off";
import { projectsAction } from "@/app/admin/(gated)/[store]/projects/actions";
import { PROJECT_SOURCES_WORDS } from "@/lib/admin-words/project-sources";
import { projectsOn } from "@/lib/extensions";

export const metadata: Metadata = { title: "Support inbox" };

/**
 * A store's support inbox (D216, `docs/support.md` 2.4, step 3): every conversation with the store's customers as it happens, for
 * members who may read support; those who may write take conversations over, answer, hand them on or back and end them (step 4).
 */
export default async function SupportInboxPage({
  params,
  searchParams,
}: PageProps<"/admin/[store]/support">) {
  const { store: slug } = await params;
  const c = (await searchParams).c;
  const initialOpen =
    typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  const member = await requirePermission(slug, "support:read");
  const notInAccount = requireExtension(member, "support_desk");
  if (notInAccount) return notInAccount;
  const staff = memberDesk(member);
  const [{ feed: initial, tab: initialTab }, mine] = await Promise.all([
    openingInbox([staff]),
    presence(staff.desk, staff.account.id),
  ]);
  const context: SupportDeskContext = {
    level: "store",
    feedUrl: `/admin/${slug}/support/feed`,
    conversationUrl: `/admin/${slug}/support/c`,
    stores: [],
    canWrite: staff.canWrite,
    presence: staff.canWrite ? mine.status : null,
    partnerOn: staff.canWrite ? mine.partner : null,
    shopUrl: storeHref(slug, storeBase(slug)),
    // A pair of the octopus (D904 P8.3a): a conversation becomes a task while the store has Projects too.
    tasks:
      staff.canWrite && projectsOn(member.store) && memberCan(member, "projects:write")
        ? { base: `/admin/${slug}`, act: projectsAction.bind(null, slug), words: PROJECT_SOURCES_WORDS[adminLangOf(member.account.adminLocale)] }
        : null,
    actions: {
      heartbeat: supportHeartbeatAction.bind(null, slug),
      presence: staff.canWrite ? supportPresenceAction.bind(null, slug) : null,
      partner: staff.canWrite ? supportPartnerAction.bind(null, slug) : null,
      act: staff.canWrite
        ? { byStore: false, run: supportActAction.bind(null, slug) }
        : null,
      // Requests carried out or decided above the reply box (ecosystem plan E2.7); carrying out asks `orders:write` too.
      requests: staff.canWrite
        ? {
            carryOut: carryOutRequestAction.bind(null, slug),
            decide: decideRequestAction.bind(null, slug),
          }
        : null,
    },
  };
  return (
    <AdminTextScope
      texts={areaTexts(adminLangOf(member.account.adminLocale), { support: SUPPORT_WORDS })}
    >
      <Inbox
        context={context}
        initial={initial}
        initialTab={initialTab}
        initialOpen={initialOpen}
      />
    </AdminTextScope>
  );
}
