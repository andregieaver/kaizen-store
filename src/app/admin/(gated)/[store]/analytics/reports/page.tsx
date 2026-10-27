import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ButtonLink, Card, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import { READY_KEYS } from "@/lib/report-catalogue";
import { analyticsContext } from "@/server/analytics-context";
import { listSavedReports } from "@/server/saved-reports";

export const metadata: Metadata = { title: "Reports" };

/**
 * Analytics → Reports (wave 8 unit A, D345): the ready reports, one press each, and the store's saved ones. Homer opens a ready report;
 * Lisa builds her own from *New report*. A report itself is drawn at `reports/view`.
 */
export default async function ReportsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/reports">) {
  const ctx = await analyticsContext((await params).store, await searchParams);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const w = adminText(ctx.lang, "customReports");
  const saved = await listSavedReports(ctx.store.id);
  const view = `${ctx.base}/analytics/reports/view`;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.page.title}
        description={w.page.description}
        actions={
          <ButtonLink kind="main" href={`${view}?new=1`}>
            {w.page.newReport}
          </ButtonLink>
        }
      />
      <Card title={w.page.readyTitle} description={w.page.readyDescription}>
        <List label={w.page.readyTitle}>
          {READY_KEYS.map((key) => (
            <ListRow key={key} href={`${view}?ready=${key}`}>
              <RowLead title={w.page.ready[key]} />
            </ListRow>
          ))}
        </List>
      </Card>
      <Card title={w.page.savedTitle}>
        {saved.length === 0 ? (
          <p className="text-sm text-muted">{w.page.savedEmpty}</p>
        ) : (
          <List label={w.page.savedTitle}>
            {saved.map((report) => (
              <ListRow key={report.id} href={`${view}?id=${report.id}`}>
                <RowLead title={report.title} />
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
