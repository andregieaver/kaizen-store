import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SegmentPeople } from "@/components/admin/segment-people";
import { ButtonLink, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { RFM_MIN_CUSTOMERS, RFM_SEGMENTS, type RfmSegment } from "@/lib/analytics-customers";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import type { SegmentRules } from "@/lib/segments";
import { memberCan, requirePermission } from "@/server/permissions";
import { evaluateSegment } from "@/server/segments";

export const metadata: Metadata = { title: "Customers of a type" };

const groupOf = (raw: string): RfmSegment | null => {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return (RFM_SEGMENTS as readonly string[]).includes(text) ? (text as RfmSegment) : null;
};

/**
 * The customers of one type on the Customers analytics page (D380): the page's own groups (`rfmGroups()`), counted now, a page at a time, with the
 * owner's CSV, and *Save as a segment* for staff who may make one. For staff who may read segments and customers.
 */
export default async function RfmGroupPage({ params, searchParams }: PageProps<"/admin/[store]/segments/rfm/[group]">) {
  const { store: slug, group: raw } = await params;
  const member = await requirePermission(slug, "marketing:read");
  // It lists people: for staff who may read customers too, as a segment's own list is.
  const group = groupOf(raw);
  if (!group || !memberCan(member, "customers:read")) notFound();
  const query = await searchParams;
  const page = Math.max(0, Math.floor(Number(typeof query.page === "string" ? query.page : 0)) || 0);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const kinds = adminText(lang, "reports").customers.segments;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const n = (v: number) => v.toLocaleString(numbers);
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { dateStyle: "medium", timeZone: store.timeZone });
  const base = `/admin/${store.slug}`;
  const rules: SegmentRules = { match: "all", conditions: [{ kind: "rfm", groups: [group] }] };
  const result = await evaluateSegment(store, rules, new Date(), page);
  const here = `${base}/segments/rfm/${encodeURIComponent(group)}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/analytics/customers`, label: adminText(lang, "reports").pages.customers.title }}
        title={kinds[group].name}
        description={w.segments.rfmDescription}
        actions={
          memberCan(member, "marketing:write") ? (
            <ButtonLink kind="main" href={`${base}/segments/new?rfm=${encodeURIComponent(group)}`}>
              {w.segments.saveAsSegment}
            </ButtonLink>
          ) : undefined
        }
      />
      {result.rfmReady ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiTile label={w.segments.peopleIn} value={n(result.people)} context={result.capped ? w.segments.peopleInCapped : undefined} />
            <KpiTile label={w.segments.wantYourEmails} value={n(result.subscribed)} />
          </div>
          <SegmentPeople
            people={result.sample}
            total={result.people}
            page={result.page}
            pages={result.pages}
            pageHref={(p) => `${here}${p > 0 ? `?page=${p}` : ""}`}
            csv={memberCan(member, "owner") ? { action: `${base}/segments/csv`, field: "rfm", value: group } : null}
            date={date}
            count={n}
            money={(minor) => formatMoney(minor, mainCurrency(store), lang === "en" ? (store.markets[0]?.locale ?? "nb-NO") : numbers)}
            words={w.segments}
          />
        </>
      ) : (
        <p className="text-body text-muted">{fillWords(w.segments.rfmTooFew, { n: n(RFM_MIN_CUSTOMERS) })}</p>
      )}
    </div>
  );
}
