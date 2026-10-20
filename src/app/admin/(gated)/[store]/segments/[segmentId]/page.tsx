import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SegmentEditor } from "@/components/admin/segment-editor";
import { Button, Card, Chip, KpiTile, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { describeRules } from "@/lib/segments";
import { listTiers } from "@/server/customer-tiers";
import { memberCan, requirePermission } from "@/server/permissions";
import { evaluateSegment, getSegment } from "@/server/segments";

import { deleteSegmentAction, previewSegmentAction, saveSegmentAction } from "../actions";
import { editorChoices } from "../editor-props";

export const metadata: Metadata = { title: "Segment" };

/**
 * One segment (D296): how many people are in it now and how many want the store's emails, the first of them by last order (for staff who may read
 * customers), and its rules to change.
 */
export default async function SegmentPage({ params }: PageProps<"/admin/[store]/segments/[segmentId]">) {
  const { store: slug, segmentId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const segment = await getSegment(store.id, segmentId);
  if (!segment) notFound();
  const mayWrite = memberCan(member, "marketing:write");
  const seesPeople = memberCan(member, "customers:read");
  const [result, tiers, choices] = await Promise.all([
    segment.rules ? evaluateSegment(store, segment.rules) : Promise.resolve(null),
    listTiers(store.id),
    mayWrite ? editorChoices(store) : Promise.resolve(null),
  ]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: store.timeZone });
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/segments`, label: "Segments" }}
        title={segment.name}
        description={segment.rules ? describeRules(segment.rules, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name }) : "These rules can no longer be read. Change them below and save."}
        actions={
          mayWrite ? (
            <form action={deleteSegmentAction.bind(null, store.slug, segment.id)}>
              <Button type="submit" kind="danger">
                Delete
              </Button>
            </form>
          ) : undefined
        }
      />

      {result && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile label="People in it" value={result.people.toLocaleString("en-GB")} context={result.capped ? "Of the 100,000 most recent people." : undefined} />
          <KpiTile
            label="Want your emails"
            value={result.subscribed.toLocaleString("en-GB")}
            context={result.moneyUnknown > 0 ? `${result.moneyUnknown} could not be judged on money: their orders are in a currency with no rate.` : undefined}
          />
        </div>
      )}

      {result && seesPeople && (
        <Card title="Who is in it" description={result.people > result.sample.length ? `The first ${result.sample.length} by their last order.` : undefined} compact>
          {result.sample.length === 0 ? (
            <p className="text-body text-muted">Nobody matches these rules today.</p>
          ) : (
            <List label="People">
              {result.sample.map((p) => (
                <ListRow key={p.email}>
                  <RowLead title={<span className="block max-w-80 truncate">{p.name || p.email}</span>} sub={p.name ? p.email : undefined} />
                  <RowFact className="hidden sm:block" sub={p.lastOrderAt ? `Last order ${date(p.lastOrderAt)}` : "No order"}>
                    {p.orders === 1 ? "1 order" : `${p.orders} orders`}
                  </RowFact>
                  {p.consent === "subscribed" && (
                    <Chip signal="positive" dot>
                      Wants your emails
                    </Chip>
                  )}
                </ListRow>
              ))}
            </List>
          )}
        </Card>
      )}

      {choices && (
        <Card title="Rules" compact>
          <SegmentEditor
            storeSlug={store.slug}
            segmentId={segment.id}
            initial={{ name: segment.name, rules: segment.rules ?? { match: "all", conditions: [] } }}
            preview={previewSegmentAction}
            save={saveSegmentAction}
            {...choices}
          />
        </Card>
      )}
    </div>
  );
}
