import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { SegmentEditor } from "@/components/admin/segment-editor";
import { SegmentPeople } from "@/components/admin/segment-people";
import { Button, Card, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { describeRules } from "@/lib/segments";
import { listTiers } from "@/server/customer-tiers";
import { memberCan, requirePermission } from "@/server/permissions";
import { evaluateSegment, getSegment, segmentUses } from "@/server/segments";

import { deleteSegmentAction, previewSegmentAction, saveSegmentAction } from "../actions";
import { editorChoices } from "../editor-props";

export const metadata: Metadata = { title: "Segment" };

/**
 * One segment (D296): how many people are in it now and how many want the store's emails, the first of them by last order (for staff who may read
 * customers), and its rules to change.
 */
export default async function SegmentPage({ params, searchParams }: PageProps<"/admin/[store]/segments/[segmentId]">) {
  const { store: slug, segmentId } = await params;
  const query = await searchParams;
  const page = Math.max(0, Math.floor(Number(typeof query.page === "string" ? query.page : 0)) || 0);
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const segment = await getSegment(store.id, segmentId);
  if (!segment) notFound();
  const mayWrite = memberCan(member, "marketing:write");
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const seesPeople = memberCan(member, "customers:read");
  const [result, tiers, choices, uses] = await Promise.all([
    segment.rules ? evaluateSegment(store, segment.rules, new Date(), page) : Promise.resolve(null),
    listTiers(store.id),
    mayWrite ? editorChoices(store, lang) : Promise.resolve(null),
    segmentUses(store.id, segment.id),
  ]);
  const used = uses.codes.length > 0 || uses.campaigns.length > 0;
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "nb-NO") : numbers;
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { dateStyle: "medium", timeZone: store.timeZone });
  const n = (v: number) => v.toLocaleString(numbers);
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/segments`, label: w.segments.title }}
        title={segment.name}
        description={
          segment.rules ? describeRules(segment.rules, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name, words: w.describe }) : w.segments.unreadableHere
        }
        actions={
          mayWrite ? (
            <form action={deleteSegmentAction.bind(null, store.slug, segment.id)}>
              <Button type="submit" kind="danger">
                {w.common.delete}
              </Button>
            </form>
          ) : undefined
        }
      />

      {result && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile label={w.segments.peopleIn} value={n(result.people)} context={result.capped ? w.segments.peopleInCapped : undefined} />
          <KpiTile
            label={w.segments.wantYourEmails}
            value={n(result.subscribed)}
            context={result.moneyUnknown > 0 ? fillWords(w.segments.moneyUnknown, { n: n(result.moneyUnknown) }) : undefined}
          />
        </div>
      )}

      {query.inUse === "1" && used && (
        <p role="alert" className="rounded-panel border border-warning-line bg-warning-soft p-3 text-body text-warning-text">
          {w.segments.inUse}
        </p>
      )}

      {used && (
        <Card title={w.segments.usedBy} compact>
          <ul className="flex flex-col gap-1 text-body">
            {uses.codes.length > 0 && <li>{fillWords(w.segments.usedCodes, { list: uses.codes.join(", ") })}</li>}
            {uses.campaigns.length > 0 && <li>{fillWords(w.segments.usedCampaigns, { list: uses.campaigns.join(", ") })}</li>}
          </ul>
        </Card>
      )}

      {result && seesPeople && (
        <SegmentPeople
          people={result.sample}
          total={result.people}
          page={result.page}
          pages={result.pages}
          pageHref={(p) => `${base}/segments/${segment.id}${p > 0 ? `?page=${p}` : ""}`}
          csv={memberCan(member, "owner") ? { action: `${base}/segments/csv`, field: "segment", value: segment.id } : null}
          date={date}
          count={n}
          money={money}
          words={w.segments}
        />
      )}

      {choices && (
        <Card title={w.segments.rules} compact>
          <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
          <SegmentEditor
            storeSlug={store.slug}
            segmentId={segment.id}
            initial={{ name: segment.name, rules: segment.rules ?? { match: "all", conditions: [] } }}
            preview={previewSegmentAction}
            save={saveSegmentAction}
            {...choices}
          />
          </AdminTextScope>
        </Card>
      )}
    </div>
  );
}
