import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { countSegment, describeRules } from "@/lib/segments";
import { listTiers } from "@/server/customer-tiers";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments, segmentPeople } from "@/server/segments";

export const metadata: Metadata = { title: "Segments" };

/**
 * The store's segments (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4.2): groups of people by rules, each counted now, with how many of them
 * want the store's emails.
 */
export default async function SegmentsPage({ params }: PageProps<"/admin/[store]/segments">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const [segments, people, tiers] = await Promise.all([listSegments(store.id), segmentPeople(store), listTiers(store.id)]);
  const now = new Date();
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const ctx = {
    money: (minor: number) => formatMoney(minor, mainCurrency(store), locale),
    groupName: (id: string) => tiers.find((t) => t.id === id)?.name,
  };
  const base = `/admin/${store.slug}/segments`;
  const mayWrite = memberCan(member, "marketing:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Segments"
        description="Groups of your customers and subscribers by what they did: how often and how lately they bought, how much, where, and whether they want your emails. A segment is counted every time you open it, so it is always up to date."
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind="main">New segment</ButtonLink> : undefined}
      />
      {segments.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          No segments yet. Make one to see, for example, your best customers or the ones who have not ordered for a while.
        </p>
      ) : (
        <Card compact>
          <List label="Segments">
            {segments.map((s) => {
              const count = s.rules ? countSegment(s.rules, people.people, now) : null;
              return (
                <ListRow key={s.id}>
                  <RowLead title={s.name} href={`${base}/${s.id}`} sub={s.rules ? describeRules(s.rules, ctx) : "These rules can no longer be read: open it and save it again."} />
                  <RowFact sub={count ? `${count.subscribed.toLocaleString("en-GB")} want your emails` : undefined}>
                    {count ? `${count.people.toLocaleString("en-GB")} ${count.people === 1 ? "person" : "people"}` : "–"}
                  </RowFact>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}
      {people.capped && <p className="text-caption text-muted">Only the 100,000 most recent people are counted.</p>}
    </div>
  );
}
