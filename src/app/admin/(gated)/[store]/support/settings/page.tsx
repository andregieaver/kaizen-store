import type { Metadata } from "next";

import { SupportSettingsForm } from "@/components/admin/support/settings-form";
import { can } from "@/lib/permissions";
import { holderOf } from "@/server/auth";
import { requirePermission } from "@/server/permissions";
import { openConversationCount } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { settingsForEdit } from "@/server/support-settings";

import { saveSupportSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Support settings" };

/** The store's support settings (D216, `docs/support.md` 2.10): who answers its customers and how. */
export default async function SupportSettingsPage({ params }: PageProps<"/admin/[store]/support/settings">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const [settings, open] = await Promise.all([settingsForEdit(staff), openConversationCount(staff.desk)]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Support settings</h1>
        <p className="text-muted">Who answers the store&apos;s customers in the chat, and what happens when nobody is there.</p>
      </div>
      <SupportSettingsForm
        settings={settings}
        save={staff.canWrite ? saveSupportSettingsAction.bind(null, slug) : null}
        canWrite={staff.canWrite}
        owner={can(holderOf(member), "owner")}
        deskName={member.store.name}
        aiSettingsHref={`/admin/${slug}/settings/ai`}
        chatHref={`/admin/${slug}/chat`}
        openCount={open}
      />
    </div>
  );
}
