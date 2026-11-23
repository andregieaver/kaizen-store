import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { BroadcastSend } from "@/components/admin/broadcast-send";
import { Button, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { checkWords, contentChecks } from "@/lib/flow-checks";
import { marketingProblem } from "@/lib/marketing-words";
import { formatMoney } from "@/lib/money";
import { testedOf } from "@/lib/broadcast-test-sizes";
import { areaTexts } from "@/lib/admin-area";
import { FLOWS_WORDS } from "@/lib/admin-words/flows";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { audienceCount, broadcastReport, getBroadcast } from "@/server/broadcasts";
import { memberCan, requirePermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

import {
  deleteBroadcastAction,
  saveAsTemplateAction,
  scheduleBroadcastAction,
  sendTestAction,
  startBroadcastAction,
  stopBroadcastAction,
  unscheduleBroadcastAction,
} from "../actions";
import { broadcastChoices, editorActions } from "../editor-props";
import { requireExtension } from "@/components/admin/extension-off";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

export const metadata: Metadata = { title: "Broadcast" };

/**
 * One broadcast (D297, docs/wave-5-marketing.md 5): while it is a draft or scheduled, its words and how to test and send it; once it is sent,
 * what happened (5.6), counted from its recipients and their emails, and the presses on its links.
 */
export default async function BroadcastPage({ params }: PageProps<"/admin/[store]/broadcasts/[broadcastId]">) {
  const { store: slug, broadcastId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const broadcast = await getBroadcast(store.id, broadcastId);
  if (!broadcast) notFound();
  const base = `/admin/${store.slug}/broadcasts`;
  const mayWrite = memberCan(member, "marketing:write");
  const editable = broadcast.status === "draft" || broadcast.status === "scheduled";
  const lang = adminLangOf(member.account.adminLocale);
  const w = MARKETING_WORDS[lang];
  const wb = w.broadcasts;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleString(numbers, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  if (editable) {
    // Server-only words (`flows`): the warnings are drawn here, nothing more is handed to the browser.
    const wf = FLOWS_WORDS[lang];
    const warnings = contentChecks(broadcast.content, store.localization.locales[0] ?? "en-GB").filter((c) => !c.blocking);
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
                <QuietActionForm action={unscheduleBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit">{wb.dontSend}</Button>
                </QuietActionForm>
              ) : (
                <QuietActionForm action={deleteBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit" kind="danger">
                    {w.common.delete}
                  </Button>
                </QuietActionForm>
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
            <AdminTextScope texts={areaTexts(lang, { marketing: MARKETING_WORDS })}>
            {/* The checks before sending (email plan M3.6): the warnings, each a line with what to fix; what blocks a send is refused by it. */}
            {warnings.length > 0 && (
              <Card title={wf.checks.title} compact>
                <ul className="flex flex-col gap-1.5" data-broadcast-checks>
                  {warnings.map((c, i) => (
                    <li key={i} className="text-sm text-ink-2">
                      {checkWords(wf, { ...c, stepId: "", subject: broadcast.content[store.localization.locales[0] ?? ""]?.subject || broadcast.title })}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
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
            <Card title={wb.saveAsTemplate} compact>
              <QuietActionForm action={saveAsTemplateAction.bind(null, store.slug, broadcast.id)} className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-body">
                  {wb.templateName}
                  <input name="title" required maxLength={120} defaultValue={broadcast.title} className="min-h-10 rounded-md border border-line bg-card px-3" />
                </label>
                <Button type="submit">{wb.saveAsTemplate}</Button>
              </QuietActionForm>
            </Card>
            <Card title={w.common.whatItSays} compact>
              <BroadcastEditor
                storeSlug={store.slug}
                broadcastId={broadcast.id}
                initial={{ title: broadcast.title, audience: broadcast.audience, segmentId: broadcast.segmentId, content: broadcast.content, test: broadcast.test, bestTime: broadcast.bestTime, topicId: broadcast.topicId }}
                {...choices}
                {...editorActions()}
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
  // A split test (M2.5, D868): while it waits, when the rest get the winner; once called, the engine's call in one sentence.
  const splitLine = () => {
    const t = broadcast.test;
    if (!t) return "";
    const main = store.localization.locales[0] ?? Object.keys(broadcast.content)[0] ?? "";
    const a = broadcast.content[main]?.subject ?? "";
    const b = t.b[main]?.subject ?? "";
    const ws = wb.splitTest;
    const r = broadcast.testResult;
    if (!r) {
      const at = broadcast.startedAt ? new Date(new Date(broadcast.startedAt).getTime() + t.hours * 3_600_000).toISOString() : null;
      const tested = broadcast.recipientCount === null ? 0 : testedOf(broadcast.recipientCount, t.share);
      return fillWords(ws.waiting, { a, b, time: at ? date(at) : "", rest: n((broadcast.recipientCount ?? 0) - tested) });
    }
    const rest = n(Math.max(0, c.recipients - r.a.sent - r.b.sent));
    const [win, lose] = r.winner === "b" ? [r.b, r.a] : [r.a, r.b];
    const winner = r.winner === "b" ? b : a;
    if (r.call === "a" || r.call === "b") return fillWords(ws.won, { winner, wp: n(win.pressed), ws: n(win.sent), lp: n(lose.pressed), ls: n(lose.sent), rest });
    if (r.call === "guard") return fillWords(ws.guard, { winner, la: n(r.a.left), lb: n(r.b.left), rest });
    if (r.call === "even") return fillWords(ws.even, { a, pa: n(r.a.pressed), sa: n(r.a.sent), pb: n(r.b.pressed), sb: n(r.b.sent), rest });
    return fillWords(r.call === "few" ? ws.few : ws.broken, { a, rest });
  };
  const money = (minor: Record<string, number>) =>
    Object.entries(minor)
      .map(([currency, amount]) => formatMoney(amount, currency, numbers))
      .join(" + ");
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
            <QuietActionForm action={stopBroadcastAction.bind(null, store.slug, broadcast.id)}>
              <Button type="submit" kind="danger">
                {wb.stopSending}
              </Button>
            </QuietActionForm>
          ) : undefined
        }
      />
      {broadcast.test && <Card title={wb.splitTest.title} compact><p className="text-body text-ink" data-split-result>{splitLine()}</p></Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label={wb.wentTo} value={n(c.recipients)} context={c.queued > 0 ? fillWords(wb.stillToSend, { n: n(c.queued) }) : undefined} />
        <KpiTile label={wb.sent} value={n(c.sent)} context={c.logged > 0 ? fillWords(wb.keptOnly, { n: n(c.logged) }) : undefined} />
        <KpiTile label={wb.delivered} value={n(c.delivered)} context={wb.deliveredContext} />
        <KpiTile label={wb.unsubscribedSince} value={n(c.unsubscribed)} />
        {/* M1.4 (D761): each order credited once, to the latest email or text its buyer got before it. */}
        <KpiTile
          label={wb.ordersAfter}
          value={n(report.credit.orders)}
          context={report.credit.orders > 0 ? fillWords(wb.ordersAfterContext, { amount: money(report.credit.minor) }) : wb.ordersAfterNone}
        />
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
          <>
            {report.people > 0 && <p className="mb-3 text-body text-ink">{fillWords(wb.pressedBy, { n: n(report.people) })}</p>}
            <table className="w-full text-body">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">{wb.link}</th>
                <th className="py-1 font-normal">{w.common.language}</th>
                <th className="py-1 text-right font-normal">{wb.pressesColumn}</th>
                <th className="py-1 pl-4 text-right font-normal">{wb.peopleColumn}</th>
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
                  <td className="py-2 pl-4 text-right tabular-nums text-ink">{n(l.people)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </Card>
    </div>
  );
}
