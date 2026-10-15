import type { Metadata } from "next";

import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { openConversationCount } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";
import { settingsForEdit } from "@/server/support-settings";
import { PageHeader } from "@/components/admin/ui";

import { saveKaizenSupportSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Support settings" };

/** Kaizen's own support settings (D216, `docs/support.md` 2.10): who answers Kaizen's visitors and how. */
export default async function KaizenSupportSettingsPage() {
  const staff = await kaizenDesk();
  const [settings, open] = await Promise.all([settingsForEdit(staff), openConversationCount(staff.desk)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Support settings"
        description={<>Who answers visitors of Kaizena Flow&apos;s site in the chat, and what happens when nobody is there.</>}
      />
      <SupportSettingsForm
        settings={settings}
        save={saveKaizenSupportSettingsAction}
        canWrite
        owner
        deskName="Kaizena Flow"
        aiSettingsHref="/admin/platform/ai"
        chatHref="/admin/platform/chat"
        openCount={open}
      />
    </div>
  );
}
