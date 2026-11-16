import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import { LIST_GROUPS, listLead, STATE_SIGNAL, type ListLead, type TestIdea } from "@/lib/experiment-list";
import { partLabelText, targetLabelText } from "@/lib/experiment-words";
import { requirePermission } from "@/server/permissions";
import { experimentList, type ListedTest } from "@/server/experiment-list";
import { Card, CARD_CLASS, Chip, List, ListRow, MiniBar, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B tests" };

/** The list's one sentence on top: what waits for the owner first (`listLead()`). */
function leadText(lead: ListLead, w: ExperimentsMessages, day: (iso: string) => string): string | null {
  const l = w.list.lead;
  switch (lead.kind) {
    case "decide":
      return countWords(lead.n, l.decide, { n: lead.n });
    case "learning":
      return lead.readyAround ? countWords(lead.n, l.learningAround, { n: lead.n, date: day(lead.readyAround) }) : countWords(lead.n, l.learning, { n: lead.n });
    case "planned":
      return countWords(lead.n, l.planned, { n: lead.n });
    case "done":
      return l.done;
    case "none":
      return null;
  }
}

/** What a row says beside its chip: how far a learning test is, when a planned one starts, how many took part. */
function rowFact(t: ListedTest, w: ExperimentsMessages, day: (iso: string) => string, locale: string) {
  const p = t.card.progress;
  if (t.group === "learning") {
    return (
      <RowFact sub={p.readyAround ? fillWords(w.list.readyAround, { date: day(p.readyAround) }) : undefined}>
        <span className="flex items-center gap-2" aria-label={w.list.progress}>
          <MiniBar share={p.share} signal="warning" />
          {fillWords(w.list.dayOf, { days: p.days, min: p.minDays })}
        </span>
      </RowFact>
    );
  }
  if (t.group === "planned") {
    return <RowFact className="hidden md:block">{t.scheduledStart ? fillWords(w.list.starts, { date: day(t.scheduledStart) }) : w.list.notStarted}</RowFact>;
  }
  return <RowFact className="hidden sm:block">{countWords(t.exposed, w.list.visitors, { n: t.exposed.toLocaleString(locale) })}</RowFact>;
}

function ideaFacts(idea: TestIdea, w: ExperimentsMessages, locale: string): string {
  const i = w.list.ideas;
  if (idea.perDay === null) return i.notCounted;
  const perDay = countWords(Math.round(idea.perDay), i.perDay, { n: Math.round(idea.perDay).toLocaleString(locale) });
  const answer =
    idea.weeks !== null && idea.findable !== null
      ? countWords(idea.weeks, i.answer, { n: idea.weeks, change: `${Math.round(idea.findable * 100)} %` })
      : i.tooFew;
  return `${perDay} · ${answer}`;
}

/** The store's A/B tests (D148; grouped since phase 15): what waits for a decision, what is still learning, what is planned, and ideas. */
export default async function ExperimentsPage({ params }: PageProps<"/admin/[store]/experiments">) {
  const { store, account } = await requirePermission((await params).store, "marketing:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const day = (iso: string) => date.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
  const { tests, ideas } = await experimentList(store, { words: w, numberLocale: locale });
  const base = `/admin/${store.slug}/experiments`;
  const lead = leadText(listLead(tests), w, day);
  const taught = tests.filter((t) => t.learning);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={w.list.title} description={<>{w.list.description}</>} />
        <div className="flex flex-wrap items-center gap-2">
          {tests.length > 0 && (
            <form method="post" action={`${base}/export`}>
              <button type="submit" className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm text-ink hover:bg-sunken">
                {w.list.download}
              </button>
            </form>
          )}
          <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
            {w.list.newTest}
          </Link>
        </div>
      </div>
      {lead && (
        <p className="text-title text-ink" data-lead>
          {lead}
        </p>
      )}
      {tests.length === 0 && (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {w.list.empty}
        </p>
      )}
      {LIST_GROUPS.map((group) => {
        const rows = tests.filter((t) => t.group === group);
        if (rows.length === 0) return null;
        return (
          <Card key={group} title={w.list.groups[group]} compact>
            <List label={w.list.groups[group]}>
              {rows.map((t) => (
                <ListRow key={t.id} href={`${base}/${t.id}`} highlight={group === "decide"}>
                  <RowLead
                    title={t.name}
                    sub={
                      <>
                        {targetLabelText(t.page.kind, t.page.slug, t.page.title, t.page.role, w)} · {t.part ? `${partLabelText(t.part.label, w)} · ` : ""}
                        {w.goals[t.goal].label}
                      </>
                    }
                  />
                  {rowFact(t, w, day, locale)}
                  <Chip signal={STATE_SIGNAL[t.card.state]} dot>
                    {w.card.states[t.card.state]}
                    {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        );
      })}
      {ideas.length > 0 && (
        <Card title={w.list.ideas.title} compact>
          <p className="mb-2 max-w-[75ch] text-body text-ink-2">{w.list.ideas.intro}</p>
          <List label={w.list.ideas.title}>
            {ideas.map((idea) => (
              <ListRow key={idea.targetId} href={`${base}/new?page=${idea.targetId}`}>
                <RowLead
                  title={fillWords(w.list.ideas.change[idea.change], { button: idea.button ?? "" })}
                  sub={
                    <>
                      {targetLabelText(idea.kind, idea.slug, idea.title, idea.role, w)} · {w.goals[idea.goal].label}
                      <span className="block">{ideaFacts(idea, w, locale)}</span>
                    </>
                  }
                />
                <RowFact className="text-brand-text">{w.list.ideas.start}</RowFact>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      {taught.length > 0 && (
        <Card title={w.list.taught} compact>
          <List label={w.list.taught}>
            {taught.map((t) => (
              <ListRow key={t.id} href={`${base}/${t.id}`}>
                <RowLead
                  title={t.learning}
                  sub={
                    <>
                      {t.name} · {w.card.states[t.card.state]}
                      {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                    </>
                  }
                />
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
