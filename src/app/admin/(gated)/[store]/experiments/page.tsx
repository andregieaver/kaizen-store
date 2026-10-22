import type { Metadata } from "next";
import Link from "next/link";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { partLabelText, targetLabelText } from "@/lib/experiment-words";
import { STATUS_SIGNAL } from "@/lib/experiments";
import { requirePermission } from "@/server/permissions";
import { listExperiments } from "@/server/experiment-admin";
import { Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B tests" };

/** The store's A/B tests (D148): what is running, what waits to be started and what has been decided. */
export default async function ExperimentsPage({ params }: PageProps<"/admin/[store]/experiments">) {
  const { store, account } = await requirePermission((await params).store, "marketing:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const tests = await listExperiments(store.id);
  const base = `/admin/${store.slug}/experiments`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={w.list.title}
          description={<>{w.list.description}</>}
        />
        <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {w.list.newTest}
        </Link>
      </div>
      {tests.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {w.list.empty}
        </p>
      ) : (
        <Card compact>
          <List label={w.list.title}>
            {tests.map((t) => (
              <ListRow key={t.id} href={`${base}/${t.id}`}>
                <RowLead
                  title={t.name}
                  sub={
                    <>
                      {targetLabelText(t.page.kind, t.page.slug, t.page.title, t.page.role, w)} · {t.part ? `${partLabelText(t.part.label, w)} · ` : ""}
                      {fillWords(w.list.versions, { n: t.variants.length })} · {w.goals[t.goal].label}
                    </>
                  }
                />
                <RowFact className="hidden md:block">
                  {t.startedAt
                    ? fillWords(w.list.started, { date: date.format(new Date(t.startedAt)) })
                    : t.scheduledStart
                      ? fillWords(w.list.starts, { date: date.format(new Date(t.scheduledStart)) })
                      : w.list.notStarted}
                </RowFact>
                <RowFact className="hidden sm:block">
                  {countWords(t.exposed, w.list.visitors, { n: t.exposed.toLocaleString(locale) })}
                </RowFact>
                <Chip signal={STATUS_SIGNAL[t.status]} dot>
                  {w.status[t.status]}
                  {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                </Chip>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
