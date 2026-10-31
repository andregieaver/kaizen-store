import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { SupportEmailCard } from "@/components/admin/support/email-card";
import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { openConversationCount } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";
import { deskEmailAddress, deskEmailsKeyRefused } from "@/server/support-inbound";
import { settingsForEdit } from "@/server/support-settings";
import { PageHeader } from "@/components/admin/ui";

import { saveKaizenSupportSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Support settings" };

/** Kaizen's own support settings (D216, `docs/support.md` 2.10): who answers Kaizen's visitors and how. */
export default async function KaizenSupportSettingsPage() {
  const staff = await kaizenDesk();
  const lang = adminLangOf(staff.account.adminLocale);
  const t = adminText(lang, "support");
  const [settings, open] = await Promise.all([
    settingsForEdit(staff),
    openConversationCount(staff.desk),
  ]);
  // Made after the desk's row (settingsForEdit() makes it on a desk's first look).
  const [emailAddress, keyRefused] = await Promise.all([deskEmailAddress(staff.desk), deskEmailsKeyRefused(staff.desk)]);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support", "settings"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.platformSettings.title}
          description={t.pages.platformSettings.description}
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
        <SupportEmailCard address={emailAddress} mode={settings.mode} keyRefused={keyRefused} words={t.email} />
      </div>
    </AdminTextScope>
  );
}
