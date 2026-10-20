import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { BroadcastSend } from "@/components/admin/broadcast-send";
import { Button, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { STATUS_WORDS } from "@/lib/broadcasts";
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
  const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  if (editable) {
    const [choices, emailStore] = await Promise.all([mayWrite ? broadcastChoices(store) : Promise.resolve(null), storeById(store.id)]);
    const count = emailStore ? await audienceCount(emailStore, broadcast.audience, broadcast.segmentId) : null;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: "Broadcasts" }}
          title={broadcast.title}
          status={
            <Chip signal={broadcast.status === "scheduled" ? "insight" : "neutral"} dot>
              {STATUS_WORDS[broadcast.status]}
            </Chip>
          }
          meta={broadcast.scheduledFor ? [`Goes out ${date(broadcast.scheduledFor)}`] : undefined}
          actions={
            mayWrite ? (
              broadcast.status === "scheduled" ? (
                <form action={unscheduleBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit">Don&apos;t send it then</Button>
                </form>
              ) : (
                <form action={deleteBroadcastAction.bind(null, store.slug, broadcast.id)}>
                  <Button type="submit" kind="danger">
                    Delete
                  </Button>
                </form>
              )
            ) : undefined
          }
        />
        {broadcast.scheduleProblem && (
          <p role="alert" className="rounded-panel border border-warning-line bg-warning-soft p-3 text-body text-warning-text">
            It was not sent at its time: {broadcast.scheduleProblem}
          </p>
        )}
        {choices ? (
          <>
            <Card title="Send" description="Send a test to yourself first. Each person gets it once, in their own language where you wrote it." compact>
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
            <Card title="What it says" compact>
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
          </>
        ) : (
          <p className="text-body text-muted">Your role may read broadcasts but not write or send them.</p>
        )}
      </div>
    );
  }

  const report = await broadcastReport(store.id, broadcast);
  const c = report.counts;
  const n = (v: number) => v.toLocaleString("en-GB");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Broadcasts" }}
        title={broadcast.title}
        status={
          <Chip signal={broadcast.status === "sent" ? "positive" : broadcast.status === "sending" ? "warning" : "neutral"} dot>
            {STATUS_WORDS[broadcast.status]}
          </Chip>
        }
        meta={[broadcast.startedAt ? `Started ${date(broadcast.startedAt)}` : null, broadcast.finishedAt ? `Ended ${date(broadcast.finishedAt)}` : null].filter((x): x is string => Boolean(x))}
        description={broadcast.audienceWords ?? undefined}
        actions={
          mayWrite && broadcast.status === "sending" ? (
            <form action={stopBroadcastAction.bind(null, store.slug, broadcast.id)}>
              <Button type="submit" kind="danger">
                Stop sending
              </Button>
            </form>
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Went to" value={n(c.recipients)} context={c.queued > 0 ? `${n(c.queued)} still to send` : undefined} />
        <KpiTile label="Sent" value={n(c.sent)} context={c.logged > 0 ? `${n(c.logged)} kept only: email is not set up` : undefined} />
        <KpiTile label="Delivered" value={n(c.delivered)} context="As the email service reported it." />
        <KpiTile label="Unsubscribed since" value={n(c.unsubscribed)} />
      </div>
      <Card title="What else happened" compact>
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ["Bounced", c.bounced],
            ["Marked as spam", c.complained],
            ["Failed", c.failed],
            ["Skipped (left the list, or stopped)", c.skipped],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-4 border-b border-line py-1">
              <dt className="text-body text-ink-2">{label}</dt>
              <dd className="text-body-strong tabular-nums text-ink">{n(Number(value))}</dd>
            </div>
          ))}
        </dl>
        {report.frozen && <p className="mt-3 text-caption text-muted">The addresses were removed 90 days after it was sent; these are the figures kept.</p>}
      </Card>
      <Card title="Presses on its links" description="Counted presses, not people: some mail apps open links to check them, and those count too. Opens are not tracked." compact>
        {report.links.length === 0 ? (
          <p className="text-body text-muted">It had no links.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">Link</th>
                <th className="py-1 font-normal">Language</th>
                <th className="py-1 text-right font-normal">Presses</th>
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
