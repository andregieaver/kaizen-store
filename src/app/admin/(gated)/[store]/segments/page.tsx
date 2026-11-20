import type { Metadata } from "next";

import { ButtonLink, Card, CARD_CLASS, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { countSegment, describeRules, SEGMENT_STARTERS, type SegmentRules } from "@/lib/segments";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { listTiers } from "@/server/customer-tiers";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments, segmentNames, segmentPeople } from "@/server/segments";

import { keepStarterAction } from "./actions";
import { requireExtension } from "@/components/admin/extension-off";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

export const metadata: Metadata = { title: "Segments" };

/**
 * The store's segments (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4.2): groups of people by rules, each counted now, with how many of them
 * want the store's emails.
 */
export default async function SegmentsPage({ params }: PageProps<"/admin/[store]/segments">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const [segments, tiers] = await Promise.all([listSegments(store.id), listTiers(store.id)]);
  // Read once for every segment and ready one: the facts their rules ask for (ecosystem plan E3.6, D718), the customer types always (the
  // ready ones are offered by them), and the products and categories they name.
  const sets = [...segments.map((s) => s.rules), ...SEGMENT_STARTERS.map((s) => s.rules)];
  const known = sets.filter((rules): rules is SegmentRules => rules !== null);
  const [people, names] = await Promise.all([segmentPeople(store, new Date(), { rules: known, rfm: true }), segmentNames(store, known)]);
  const now = new Date();
  const lang = adminLangOf(member.account.adminLocale);
  const w = MARKETING_WORDS[lang];
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "nb-NO") : numbers;
  const ctx = {
    money: (minor: number) => formatMoney(minor, mainCurrency(store), locale),
    groupName: (id: string) => tiers.find((t) => t.id === id)?.name,
    ...names,
    words: w.describe,
  };
  const base = `/admin/${store.slug}/segments`;
  const mayWrite = memberCan(member, "marketing:write");
  // The ready segments (D296's starters) the store has not kept yet, by name; RFM ones only once RFM means something.
  const kept = new Set(segments.map((s) => s.name.trim().toLowerCase()));
  const starters = SEGMENT_STARTERS.filter((s) => people.rfmReady || !s.rules.conditions.some((c) => c.kind === "rfm"))
    .map((s) => ({ ...s, ...(w.segments.starters[s.key] ?? {}) }))
    .filter((s) => !kept.has(s.name.trim().toLowerCase()))
    .map((s) => ({ ...s, count: countSegment(s.rules, people.people, now).people }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.segments.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{w.segments.lead}</span>
            {mayWrite && starters.length > 0 && w.segments.leadRest}
          </span>,
        ]}
        actions={mayWrite ? <ButtonLink href={`${base}/new`} kind={starters.length > 0 ? "secondary" : "main"}>{starters.length > 0 ? w.segments.makeOwn : w.segments.newSegment}</ButtonLink> : undefined}
      />
      {segments.length === 0 ? (
        starters.length === 0 && (
          <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
            {w.segments.empty}
          </p>
        )
      ) : (
        <Card compact title={starters.length > 0 ? w.segments.yours : undefined}>
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
      {/* Round 8 (D626): the ready segments not kept yet, each counted now, kept with one press. */}
      {mayWrite && starters.length > 0 && (
        <section aria-labelledby="ready-segments" className="flex flex-col gap-3">
          <h2 id="ready-segments" className="text-title text-ink">
            {w.segments.ready}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3">
            {starters.map((s, i) => (
              <li key={s.key} className={`flex flex-col gap-2 p-4.5 ${CARD_CLASS}`}>
                <h3 className="text-body text-ink">{s.name}</h3>
                <p className="text-caption text-ink-2">{s.line}</p>
                <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                  <span className="text-metric text-ink">
                    {s.count.toLocaleString(numbers)} <span className="text-caption text-muted">{countWords(s.count, w.segments.peopleNow)}</span>
                  </span>
                  <QuietActionForm action={keepStarterAction.bind(null, store.slug, s.key)}>
                    <button
                      type="submit"
                      className={
                        i === 0
                          ? "inline-flex h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover"
                          : "inline-flex h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm text-ink hover:bg-sunken"
                      }
                    >
                      {w.segments.keep}
                      <span className="sr-only"> {s.name}</span>
                    </button>
                  </QuietActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.capped && <p className="text-caption text-muted">{w.segments.capped}</p>}
    </div>
  );
}
