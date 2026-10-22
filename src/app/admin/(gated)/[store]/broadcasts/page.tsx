import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { BroadcastStatus } from "@/lib/broadcasts";
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
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const wb = w.broadcasts;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleString(numbers, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={wb.title}
        description={wb.description}
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind="main">{wb.newBroadcast}</ButtonLink> : undefined}
      />
      {broadcasts.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>{wb.empty}</p>
      ) : (
        <Card compact>
          <List label={wb.list}>
            {broadcasts.map((b) => (
              <ListRow key={b.id}>
                <RowLead
                  title={b.title}
                  href={`${base}/${b.id}`}
                  sub={b.audienceWords ?? (b.audience === "segment" ? (b.segmentName ? fillWords(wb.segment, { name: b.segmentName }) : wb.segmentGone) : wb.everyone)}
                />
                <RowFact sub={b.recipientCount !== null ? countWords(b.recipientCount, w.common.people, { n: b.recipientCount.toLocaleString(numbers) }) : undefined}>
                  {b.startedAt ? date(b.startedAt) : b.scheduledFor ? fillWords(wb.forDate, { date: date(b.scheduledFor) }) : fillWords(wb.savedDate, { date: date(b.updatedAt) })}
                </RowFact>
                <Chip signal={SIGNAL[b.status]} dot>
                  {wb.statuses[b.status]}
                </Chip>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
