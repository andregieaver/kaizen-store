import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { WidgetsList } from "@/components/admin/support/widgets/widgets-list";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { chatWidgetFor } from "@/server/chat-agent";
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { listWidgets } from "@/server/support-widgets";

import { createWidgetAction } from "./actions";

export const metadata: Metadata = { title: "Website chat" };

/** The store's chat widgets on the owner's own websites (D581, `docs/support-embed.md`): each with its look and websites, and a new one. */
export default async function SupportWidgetsPage({ params }: PageProps<"/admin/[store]/support/widgets">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "support").widgets;
  const [widgets, chat] = await Promise.all([listWidgets(staff.desk), chatWidgetFor(member.store.id)]);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <WidgetsList
          widgets={widgets}
          base={`/admin/${slug}/support/widgets`}
          create={staff.canWrite ? createWidgetAction.bind(null, slug) : null}
          chatOn={chat !== null}
          knowledgeHref={`/admin/${slug}/chat`}
        />
      </div>
    </AdminTextScope>
  );
}
