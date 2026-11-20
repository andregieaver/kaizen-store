import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";

import { SupportEmailCard } from "@/components/admin/support/email-card";
import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { can } from "@/lib/permissions";
import { areaTexts } from "@/lib/admin-area";
import { SETTINGS_HOURS_WORDS } from "@/lib/admin-words/settings-hours";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { SUPPORT_SETTINGS_WORDS } from "@/lib/admin-words/support-settings";
import { holderOf } from "@/server/auth";
import { requirePermission } from "@/server/permissions";
import { openConversationCount } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { deskEmailAddress, deskEmailsKeyRefused } from "@/server/support-inbound";
import { settingsForEdit } from "@/server/support-settings";
import { PageHeader } from "@/components/admin/ui";

import { saveSupportSettingsAction } from "./actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Support settings" };

/** The store's support settings (D216, `docs/support.md` 2.10): who answers its customers and how. */
export default async function SupportSettingsPage({
  params,
}: PageProps<"/admin/[store]/support/settings">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const notInAccount = requireExtension(member, "support_desk");
  if (notInAccount) return notInAccount;
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const t = SUPPORT_WORDS[lang];
  const [settings, open] = await Promise.all([
    settingsForEdit(staff),
    openConversationCount(staff.desk),
  ]);
  // Made after the desk's row (settingsForEdit() makes it on a desk's first look).
  const [emailAddress, keyRefused] = await Promise.all([deskEmailAddress(staff.desk), deskEmailsKeyRefused(staff.desk)]);
  return (
    <AdminTextScope texts={areaTexts(lang, { settingsHours: SETTINGS_HOURS_WORDS, supportSettings: SUPPORT_SETTINGS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.storeSettings.title}
          description={t.pages.storeSettings.description}
        />
        <SupportSettingsForm
          settings={settings}
          save={
            staff.canWrite ? saveSupportSettingsAction.bind(null, slug) : null
          }
          canWrite={staff.canWrite}
          owner={can(holderOf(member), "owner")}
          deskName={member.store.name}
          aiSettingsHref={`/admin/${slug}/settings/ai`}
          chatHref={`/admin/${slug}/chat`}
          openCount={open}
          formChoice
          takesEmail={emailAddress !== null}
        />
        <SupportEmailCard address={emailAddress} mode={settings.mode} keyRefused={keyRefused} words={t.email} />
      </div>
    </AdminTextScope>
  );
}
