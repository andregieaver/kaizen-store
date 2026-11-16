import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { BroadcastStatus } from "@/lib/broadcasts";
import type { BroadcastTemplateKey } from "@/lib/broadcast-templates";
import { listBroadcasts } from "@/server/broadcasts";
import { subscriberCounts } from "@/server/marketing-subscribers";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Broadcasts" };

/** The emails Homer starts from (round 10, D633): templates of D368, the first with the store's newest products in it. */
const STARTS = ["new_products", "offer", "thanks"] as const satisfies readonly BroadcastTemplateKey[];

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
  const [broadcasts, counts] = await Promise.all([listBroadcasts(store.id), subscriberCounts(store.id)]);
  const people = counts.subscribed;
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
        meta={[
          <span key="lead">
            <span className="text-ink">{people === 0 ? wb.leadNone : countWords(people, wb.leadSome, { n: people.toLocaleString(numbers) })}</span>
            {people === 0 ? wb.leadNoneRest : wb.leadRest}
          </span>,
        ]}
        actions={
          <>
            <ButtonLink href={`/admin/${store.slug}/subscribers`} kind="secondary">
              {wb.whoIsOn}
            </ButtonLink>
            {mayWrite && (
              <ButtonLink href={`${base}/new`} kind="secondary">
                {wb.writeOwn}
              </ButtonLink>
            )}
          </>
        }
      />
      {broadcasts.length > 0 && (
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
      {mayWrite && (
        <section aria-labelledby="starts" className="flex flex-col gap-3">
          <h2 id="starts" className="text-title text-ink">
            {wb.startsTitle}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-3">
            {STARTS.map((key, i) => (
              <li key={key} className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                <span className="text-body text-ink">{wb.starts[key].title}</span>
                <span className="text-caption text-ink-2">{wb.starts[key].sub}</span>
                <ButtonLink
                  href={`${base}/new?from=${key}`}
                  kind={i === 0 && broadcasts.length === 0 ? "main" : "secondary"}
                  size="dense"
                  className="mt-auto self-start"
                >
                  {wb.startFromThis}
                  <span className="sr-only"> {wb.starts[key].title}</span>
                </ButtonLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
