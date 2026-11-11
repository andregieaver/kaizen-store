import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { SmsConnectForm, SmsSettingsForm, StopNumberButton } from "@/components/admin/sms-views";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { SmsCampaignStatus } from "@/lib/sms";
import { memberCan, requirePermission } from "@/server/permissions";
import { getSmsSettings, listSmsCampaigns, listSmsSubscribers, smsSubscriberCounts } from "@/server/sms";

import { connectSmsAction, disconnectSmsAction, saveSmsSettingsAction, stopNumberAction } from "./actions";

export const metadata: Metadata = { title: "Text messages" };

const SIGNAL: Record<SmsCampaignStatus, "neutral" | "insight" | "warning" | "positive"> = { draft: "neutral", sending: "warning", sent: "positive", stopped: "neutral" };

/**
 * SMS marketing (D565, `docs/sms-marketing.md`): before an account is connected, what it is and the three fields that connect it (the owner's);
 * after, the store's text messages newest first with New text message, who gets them, and the account's rules (the owner's).
 */
export default async function TextMessagesPage({ params }: PageProps<"/admin/[store]/text-messages">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").sms;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const owner = memberCan(member, "owner");
  const mayWrite = memberCan(member, "marketing:write");
  const settings = await getSmsSettings(store.id);
  const base = `/admin/${store.slug}/text-messages`;

  if (!settings.connected) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <Card title={w.connectTitle}>{owner ? <SmsConnectForm connect={connectSmsAction.bind(null, store.slug)} /> : <p className="text-body text-muted">{w.ownerOnly}</p>}</Card>
      </div>
    );
  }

  const [campaigns, counts, people] = await Promise.all([listSmsCampaigns(store.id), smsSubscriberCounts(store.id), listSmsSubscribers(store.id)]);
  const date = (iso: string) => new Date(iso).toLocaleString(numbers, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const money = (v: number) => v.toLocaleString(numbers, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n = (v: number) => ({ n: v.toLocaleString(numbers) });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind="main">{w.newText}</ButtonLink> : undefined}
      />
      <p className="text-body text-muted" data-sms-spent>
        {fillWords(w.spent, { spent: money(settings.spentThisMonth), cap: money(settings.monthlyCap), currency: settings.currency ?? "" })}
      </p>
      {campaigns.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>{w.none}</p>
      ) : (
        <Card compact>
          <List label={w.title}>
            {campaigns.map((c) => (
              <ListRow key={c.id}>
                <RowLead title={c.title} href={`${base}/${c.id}`} sub={c.text.slice(0, 80)} />
                <RowFact sub={c.status === "draft" ? undefined : fillWords(w.cost, { cost: money(c.cost), currency: settings.currency ?? "" })}>
                  {date(c.startedAt ?? c.createdAt)}
                </RowFact>
                <Chip signal={SIGNAL[c.status]} dot>
                  {w.statuses[c.status]}
                </Chip>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      <Card title={w.list} description={[countWords(counts.subscribed, w.subscribed, n(counts.subscribed)), counts.pending ? countWords(counts.pending, w.waiting, n(counts.pending)) : null, counts.unsubscribed ? countWords(counts.unsubscribed, w.stoppedCount, n(counts.unsubscribed)) : null].filter(Boolean).join(" · ")}>
        {people.length === 0 ? (
          <p className="text-body text-muted">{w.noNumbers}</p>
        ) : (
          <List label={w.list}>
            {people.map((p) => (
              <ListRow key={p.id}>
                <RowLead title={<span className="tabular-nums">{p.phone}</span>} sub={p.email ?? undefined} />
                <RowFact sub={w.from[p.source as keyof typeof w.from] ?? p.source}>{date(p.consentedAt)}</RowFact>
                <Chip signal={p.status === "subscribed" ? "positive" : "neutral"}>{w.states[p.status]}</Chip>
                {mayWrite && p.status !== "unsubscribed" && <StopNumberButton stop={stopNumberAction.bind(null, store.slug, p.id)} />}
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      <Card title={w.settingsTitle}>
        {owner ? (
          <SmsSettingsForm
            initial={{ sender: settings.sender, replyNumber: settings.replyNumber ?? "", quietFrom: settings.quietFrom, quietUntil: settings.quietUntil, monthlyCap: settings.monthlyCap, currency: settings.currency ?? "" }}
            save={saveSmsSettingsAction.bind(null, store.slug)}
            disconnect={disconnectSmsAction.bind(null, store.slug)}
          />
        ) : (
          <p className="text-body text-muted">{w.ownerOnly}</p>
        )}
      </Card>
    </div>
  );
}
