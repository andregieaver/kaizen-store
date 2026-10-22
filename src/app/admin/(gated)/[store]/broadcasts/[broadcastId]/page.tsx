import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { BroadcastSend } from "@/components/admin/broadcast-send";
import { Button, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { marketingProblem } from "@/lib/marketing-words";
import { audienceCount, broadcastReport, getBroadcast } from "@/server/broadcasts";
import { uploadsEnabled } from "@/server/media";
import { memberCan, requirePermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

import {
  audienceCountAction,
  deleteBroadcastAction,
  saveBroadcastAction,
  scheduleBroadcastAction,
  sendTestAction,
  startBroadcastAction,
  stopBroadcastAction,
  suggestBroadcastAction,
  unscheduleBroadcastAction,
  uploadBroadcastPictureAction,
} from "../actions";
import { broadcastChoices } from "../editor-props";

export const metadata: Metadata = { title: "Broadcast" };

/**
 * One broadcast (D297, docs/wave-5-marketing.md 5): while it is a draft or scheduled, its words and how to test and send it; once it is sent,
 * what happened (5.6), counted from its recipients and their emails, and the presses on its links.
 */
export default async function BroadcastPage({ params }: PageProps<"/admin/[store]/broadcasts/[broadcastId]">) {
  const { store: slug, broadcastId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const broadcast = await getBroadcast(store.id, broadcastId);
  if (!broadcast) notFound();
  const base = `/admin/${store.slug}/broadcasts`;
  const mayWrite = memberCan(member, "marketing:write");
  const editable = broadcast.status === "draft" || broadcast.status === "scheduled";
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const wb = w.broadcasts;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleString(numbers, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  if (editable) {
    const [choices, emailStore] = await Promise.all([mayWrite ? broadcastChoices(store, lang) : Promise.resolve(null), storeById(store.id)]);
    const count = emailStore ? await audienceCount(emailStore, broadcast.audience, broadcast.segmentId) : null;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: wb.title }}
          title={broadcast.title}
          status={
            <Chip signal={broadcast.status === "scheduled" ? "insight" : "neutral"} dot>
              {wb.statuses[broadcast.status]}
            </Chip>
          }
          meta={broadcast.scheduledFor ? [fillWords(wb.goesOut, { date: date(broadcast.scheduledFor) })] : undefined}
          actions={
            mayWrite ? (
              broadcast.status === "scheduled" ? (
                <form action={unscheduleBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit">{wb.dontSend}</Button>
                </form>
              ) : (
                <form action={deleteBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit" kind="danger">
                    {w.common.delete}
                  </Button>
                </form>
              )
            ) : undefined
          }
        />
        {broadcast.scheduleProblem && (
          <p role="alert" className="rounded-panel border border-warning-line bg-warning-soft p-3 text-body text-warning-text">
            {fillWords(wb.notSentAtTime, { problem: marketingProblem(broadcast.scheduleProblem, w.problems) })}
          </p>
        )}
        {choices ? (
          <>
            <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
            <Card title={wb.send} description={wb.sendDescription} compact>
              <BroadcastSend
                storeSlug={store.slug}
                broadcastId={broadcast.id}
                locales={choices.locales.filter((l) => broadcast.content[l.code]?.subject)}
                people={count?.ok ? count.people : null}
                test={sendTestAction}
                start={startBroadcastAction}
                schedule={scheduleBroadcastAction}
              />
            </Card>
            <Card title={w.common.whatItSays} compact>
              <BroadcastEditor
                storeSlug={store.slug}
                broadcastId={broadcast.id}
                initial={{ title: broadcast.title, audience: broadcast.audience, segmentId: broadcast.segmentId, content: broadcast.content }}
                {...choices}
                save={saveBroadcastAction}
                count={audienceCountAction}
                suggest={suggestBroadcastAction}
                upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
              />
            </Card>
            </AdminTextScope>
          </>
        ) : (
          <p className="text-body text-muted">{wb.mayNotSend}</p>
        )}
      </div>
    );
  }

  const report = await broadcastReport(store.id, broadcast);
  const c = report.counts;
  const n = (v: number) => v.toLocaleString(numbers);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: wb.title }}
        title={broadcast.title}
        status={
          <Chip signal={broadcast.status === "sent" ? "positive" : broadcast.status === "sending" ? "warning" : "neutral"} dot>
            {wb.statuses[broadcast.status]}
          </Chip>
        }
        meta={[
          broadcast.startedAt ? fillWords(wb.started, { date: date(broadcast.startedAt) }) : null,
          broadcast.finishedAt ? fillWords(wb.ended, { date: date(broadcast.finishedAt) }) : null,
        ].filter((x): x is string => Boolean(x))}
        description={broadcast.audienceWords ?? undefined}
        actions={
          mayWrite && broadcast.status === "sending" ? (
            <form action={stopBroadcastAction.bind(null, store.slug, broadcast.id)}>
              <Button type="submit" kind="danger">
                {wb.stopSending}
              </Button>
            </form>
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={wb.wentTo} value={n(c.recipients)} context={c.queued > 0 ? fillWords(wb.stillToSend, { n: n(c.queued) }) : undefined} />
        <KpiTile label={wb.sent} value={n(c.sent)} context={c.logged > 0 ? fillWords(wb.keptOnly, { n: n(c.logged) }) : undefined} />
        <KpiTile label={wb.delivered} value={n(c.delivered)} context={wb.deliveredContext} />
        <KpiTile label={wb.unsubscribedSince} value={n(c.unsubscribed)} />
      </div>
      <Card title={wb.whatElse} compact>
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            [wb.bounced, c.bounced],
            [wb.spam, c.complained],
            [wb.failed, c.failed],
            [wb.skipped, c.skipped],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-4 border-b border-line py-1">
              <dt className="text-body text-ink-2">{label}</dt>
              <dd className="text-body-strong tabular-nums text-ink">{n(Number(value))}</dd>
            </div>
          ))}
        </dl>
        {report.frozen && <p className="mt-3 text-caption text-muted">{wb.frozen}</p>}
      </Card>
      <Card title={wb.presses} description={wb.pressesDescription} compact>
        {report.links.length === 0 ? (
          <p className="text-body text-muted">{wb.noLinks}</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">{wb.link}</th>
                <th className="py-1 font-normal">{w.common.language}</th>
                <th className="py-1 text-right font-normal">{wb.pressesColumn}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.links.map((l) => (
                <tr key={l.key}>
                  <td className="py-2">
                    <span className="block text-ink">{l.label}</span>
                    <span className="block max-w-96 truncate text-caption text-muted">{l.url}</span>
                  </td>
                  <td className="py-2 text-ink-2">{l.locale}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{n(l.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
