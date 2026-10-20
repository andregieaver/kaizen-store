import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { STATUS_WORDS, type BroadcastStatus } from "@/lib/broadcasts";
import { listBroadcasts } from "@/server/broadcasts";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Broadcasts" };

const SIGNAL: Record<BroadcastStatus, "neutral" | "insight" | "warning" | "positive"> = {
  draft: "neutral",
  scheduled: "insight",
  sending: "warning",
  sent: "positive",
  cancelled: "neutral",
};

/** The store's broadcasts (wave 5 unit C, D297): emails written once and sent to the people who want them, newest first. */
export default async function BroadcastsPage({ params }: PageProps<"/admin/[store]/broadcasts">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const broadcasts = await listBroadcasts(store.id);
  const base = `/admin/${store.slug}/broadcasts`;
  const mayWrite = memberCan(member, "marketing:write");
  const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Broadcasts"
        description="Emails with news and offers to the people who asked for them: everyone on your list, or a segment. Each person gets it once, with a way to unsubscribe."
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind="main">New broadcast</ButtonLink> : undefined}
      />
      {broadcasts.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>No broadcasts yet. Write one and send a test to yourself first.</p>
      ) : (
        <Card compact>
          <List label="Broadcasts">
            {broadcasts.map((b) => (
              <ListRow key={b.id}>
                <RowLead
                  title={b.title}
                  href={`${base}/${b.id}`}
                  sub={b.audienceWords ?? (b.audience === "segment" ? (b.segmentName ? `Segment: ${b.segmentName}` : "Its segment was deleted") : "Everyone who wants your emails")}
                />
                <RowFact sub={b.recipientCount !== null ? `${b.recipientCount.toLocaleString("en-GB")} people` : undefined}>
                  {b.startedAt ? date(b.startedAt) : b.scheduledFor ? `For ${date(b.scheduledFor)}` : `Saved ${date(b.updatedAt)}`}
                </RowFact>
                <Chip signal={SIGNAL[b.status]} dot>
                  {STATUS_WORDS[b.status]}
                </Chip>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
