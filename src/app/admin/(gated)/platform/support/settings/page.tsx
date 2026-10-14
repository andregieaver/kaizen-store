import type { Metadata } from "next";

import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { openConversationCount } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";
import { settingsForEdit } from "@/server/support-settings";

import { saveKaizenSupportSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Support settings" };

/** Kaizen's own support settings (D216, `docs/support.md` 2.10): who answers Kaizen's visitors and how. */
export default async function KaizenSupportSettingsPage() {
  const staff = await kaizenDesk();
  const [settings, open] = await Promise.all([settingsForEdit(staff), openConversationCount(staff.desk)]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-display text-ink">Support settings</h1>
        <p className="text-muted">Who answers visitors of Kaizen&apos;s site in the chat, and what happens when nobody is there.</p>
      </div>
      <SupportSettingsForm
        settings={settings}
        save={saveKaizenSupportSettingsAction}
        canWrite
        owner
        deskName="Kaizen"
        aiSettingsHref="/admin/platform/ai"
        chatHref="/admin/platform/chat"
        openCount={open}
      />
    </div>
  );
}
