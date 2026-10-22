import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
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
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "nb-NO") : numbers;
  const ctx = {
    money: (minor: number) => formatMoney(minor, mainCurrency(store), locale),
    groupName: (id: string) => tiers.find((t) => t.id === id)?.name,
    words: w.describe,
  };
  const base = `/admin/${store.slug}/segments`;
  const mayWrite = memberCan(member, "marketing:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.segments.title}
        description={w.segments.description}
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind="main">{w.segments.newSegment}</ButtonLink> : undefined}
      />
      {segments.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          {w.segments.empty}
        </p>
      ) : (
        <Card compact>
          <List label={w.segments.title}>
            {segments.map((s) => {
              const count = s.rules ? countSegment(s.rules, people.people, now) : null;
              return (
                <ListRow key={s.id}>
                  <RowLead title={s.name} href={`${base}/${s.id}`} sub={s.rules ? describeRules(s.rules, ctx) : w.segments.unreadable} />
                  <RowFact sub={count ? fillWords(w.segments.wantEmails, { n: count.subscribed.toLocaleString(numbers) }) : undefined}>
                    {count ? countWords(count.people, w.common.people, { n: count.people.toLocaleString(numbers) }) : "–"}
                  </RowFact>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}
      {people.capped && <p className="text-caption text-muted">{w.segments.capped}</p>}
    </div>
  );
}
