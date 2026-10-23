import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { can } from "@/lib/permissions";
import { holderOf } from "@/server/auth";
import { requirePermission } from "@/server/permissions";
import { openConversationCount } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { settingsForEdit } from "@/server/support-settings";
import { PageHeader } from "@/components/admin/ui";

import { saveSupportSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Support settings" };

/** The store's support settings (D216, `docs/support.md` 2.10): who answers its customers and how. */
export default async function SupportSettingsPage({
  params,
}: PageProps<"/admin/[store]/support/settings">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "support");
  const [settings, open] = await Promise.all([
    settingsForEdit(staff),
    openConversationCount(staff.desk),
  ]);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
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
        />
      </div>
    </AdminTextScope>
  );
}
