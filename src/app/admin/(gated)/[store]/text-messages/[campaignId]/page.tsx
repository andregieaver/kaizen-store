import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { notFound } from "next/navigation";

import { SmsCampaignEditor, SmsStopButton } from "@/components/admin/sms-views";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { SMS_MESSAGE_STATUSES } from "@/lib/sms";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments } from "@/server/segments";
import { getSmsCampaign, getSmsSettings } from "@/server/sms";

import { deleteSmsCampaignAction, previewSmsCampaignAction, saveSmsCampaignAction, startSmsCampaignAction, stopSmsCampaignAction } from "../actions";

export const metadata: Metadata = { title: "Text message" };

/**
 * One text message (D565): a draft is written, priced (46elks's own estimate, against the month's cap) and sent; once started, how many texts
 * wait for their readers' hours, went, arrived, failed or were not sent, what they cost, and Stop while it is sending.
 */
export default async function TextMessagePage({ params }: PageProps<"/admin/[store]/text-messages/[campaignId]">) {
  const { store: slug, campaignId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const campaign = await getSmsCampaign(store.id, campaignId);
  if (!campaign) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").sms;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const mayWrite = memberCan(member, "marketing:write");
  const back = { href: `/admin/${store.slug}/text-messages`, label: w.title };

  if (campaign.status === "draft") {
    const [segments, settings] = await Promise.all([listSegments(store.id), getSmsSettings(store.id)]);
    return (
      <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={campaign.title} back={back} actions={<Chip>{w.statuses.draft}</Chip>} />
        <Card>
          <SmsCampaignEditor
            id={campaign.id}
            initial={{ title: campaign.title, text: campaign.text, segmentId: campaign.segmentId ?? "" }}
            segments={segments.map((s) => ({ id: s.id, name: s.name }))}
            storeName={store.name}
            lang={(store.localization.locales[0] ?? "en").split("-")[0]}
            numbers={numbers}
            save={saveSmsCampaignAction.bind(null, store.slug, campaign.id)}
            preview={mayWrite && settings.connected ? previewSmsCampaignAction.bind(null, store.slug, campaign.id) : null}
            send={mayWrite && settings.connected ? startSmsCampaignAction.bind(null, store.slug, campaign.id) : null}
            remove={mayWrite ? deleteSmsCampaignAction.bind(null, store.slug, campaign.id) : null}
          />
        </Card>
      </div>
      </AdminTextScope>
    );
  }

  const settings = await getSmsSettings(store.id);
  const money = (v: number) => v.toLocaleString(numbers, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={campaign.title} back={back} actions={<Chip signal={campaign.status === "sent" ? "positive" : campaign.status === "sending" ? "warning" : "neutral"}>{w.statuses[campaign.status]}</Chip>} />
      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5" data-sms-counts>
          {SMS_MESSAGE_STATUSES.map((s) => (
            <div key={s} className="flex flex-col">
              <dt className="text-sm text-muted">{w.counts[s]}</dt>
              <dd className="text-2xl tabular-nums">{campaign.counts[s].toLocaleString(numbers)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-body">{fillWords(w.cost, { cost: money(campaign.cost), currency: settings.currency ?? "" })}</p>
        {campaign.stopReason && <p className="text-body text-muted">{w.stoppedBy[campaign.stopReason as "staff" | "cap"]}</p>}
        <p className="mt-4 max-w-sm whitespace-pre-line rounded-2xl rounded-bl-sm bg-card px-4 py-3 text-sm shadow-sm">{campaign.text}</p>
        {mayWrite && campaign.status === "sending" && (
          <div className="mt-4">
            <SmsStopButton stop={stopSmsCampaignAction.bind(null, store.slug, campaign.id)} />
          </div>
        )}
      </Card>
    </div>
    </AdminTextScope>
  );
}
