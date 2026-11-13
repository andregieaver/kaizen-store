import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { WidgetsList } from "@/components/admin/support/widgets/widgets-list";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { chatWidgetFor } from "@/server/chat-agent";
import { kaizenDesk } from "@/server/support-desk";
import { listWidgets } from "@/server/support-widgets";

import { createKaizenWidgetAction } from "./actions";

export const metadata: Metadata = { title: "Website chat" };

/** Kaizena Flow's own chat widgets on its other websites (D581): each with its look and websites, and a new one. */
export default async function KaizenWidgetsPage() {
  const staff = await kaizenDesk();
  const lang = adminLangOf(staff.account.adminLocale);
  const w = adminText(lang, "support").widgets;
  const [widgets, chat] = await Promise.all([listWidgets(staff.desk), chatWidgetFor(null)]);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <WidgetsList
          widgets={widgets}
          base="/admin/platform/support/widgets"
          create={staff.canWrite ? createKaizenWidgetAction : null}
          chatOn={chat !== null}
          knowledgeHref="/admin/platform/chat"
        />
      </div>
    </AdminTextScope>
  );
}
