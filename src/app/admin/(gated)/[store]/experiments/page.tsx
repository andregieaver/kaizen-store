import type { Metadata } from "next";
import Link from "next/link";

import { targetLabel } from "@/lib/ab-site";
import { GOAL_WORDS, STATUS_SIGNAL, STATUS_WORDS } from "@/lib/experiments";
import { requirePermission } from "@/server/permissions";
import { listExperiments } from "@/server/experiment-admin";
import { Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B tests" };

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

/** The store's A/B tests (D148): what is running, what waits to be started and what has been decided. */
export default async function ExperimentsPage({ params }: PageProps<"/admin/[store]/experiments">) {
  const { store } = await requirePermission((await params).store, "marketing:read");
  const tests = await listExperiments(store.id);
  const base = `/admin/${store.slug}/experiments`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="A/B tests"
          description={<>Try two versions of a page, a row or component of it, your header or footer, or a product layout on real visitors and keep the one that works better. Half of the visitors see it as it is, the other half a version you change; Kaizen counts who adds to the cart and who buys, and tells you in plain words when there is a winner. Only visitors who have accepted statistics cookies take part; everyone else sees the page as it is.</>}
        />
        <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          New test
        </Link>
      </div>
      {tests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          No tests yet. Pick a page, say what you want more of, and change one thing: a heading, a picture, a button.
        </p>
      ) : (
        <Card compact>
          <List label="A/B tests">
            {tests.map((t) => (
              <ListRow key={t.id} href={`${base}/${t.id}`}>
                <RowLead
                  title={t.name}
                  sub={
                    <>
                      {targetLabel(t.page.kind, t.page.slug, t.page.title, t.page.role)} · {t.part ? `${t.part.label} · ` : ""}
                      {t.variants.length} versions · {GOAL_WORDS[t.goal].label}
                    </>
                  }
                />
                <RowFact className="hidden md:block">
                  {t.startedAt ? `Started ${date.format(new Date(t.startedAt))}` : t.scheduledStart ? `Starts ${date.format(new Date(t.scheduledStart))}` : "Not started"}
                </RowFact>
                <RowFact className="hidden sm:block">
                  {t.exposed === 1 ? "1 visitor" : `${t.exposed.toLocaleString("en-GB")} visitors`}
                </RowFact>
                <Chip signal={STATUS_SIGNAL[t.status]} dot>
                  {STATUS_WORDS[t.status]}
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
