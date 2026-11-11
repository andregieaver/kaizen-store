import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { redirect } from "next/navigation";

import { SmsCampaignEditor } from "@/components/admin/sms-views";
import { Card, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments } from "@/server/segments";
import { smsOffered } from "@/server/sms";

import { saveSmsCampaignAction } from "../actions";

export const metadata: Metadata = { title: "New text message" };

/** A new text message (D565): its name, who gets it and its words; saved as a draft, then priced and sent from its own page. */
export default async function NewTextMessagePage({ params }: PageProps<"/admin/[store]/text-messages/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  if (!memberCan(member, "marketing:write") || !(await smsOffered(store.id))) redirect(`/admin/${store.slug}/text-messages`);
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").sms;
  const segments = await listSegments(store.id);
  return (
    <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.newText} back={{ href: `/admin/${store.slug}/text-messages`, label: w.title }} />
      <Card>
        <SmsCampaignEditor
          id={null}
          initial={{ title: "", text: "", segmentId: "" }}
          segments={segments.map((s) => ({ id: s.id, name: s.name }))}
          storeName={store.name}
          lang={(store.localization.locales[0] ?? "en").split("-")[0]}
          numbers={ADMIN_LANG_FACTS[lang].locale}
          save={saveSmsCampaignAction.bind(null, store.slug, null)}
          preview={null}
          send={null}
          remove={null}
        />
      </Card>
    </div>
    </AdminTextScope>
  );
}
