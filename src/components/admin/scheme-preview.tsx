import { Bell, FileText } from "lucide-react";

import type { AdminScheme } from "@/lib/admin-schemes";
import { adminText, type AdminAreaMessages } from "@/lib/admin-text";

import { NavIcon } from "./nav-icons";
import { Button, Card, Chip, CountBadge, InsightPanel, KpiTile, List, ListRow, PageHeader, RowAmount, RowDate, RowId, RowText, ScoreBar, ShareBar, TrendChip } from "./ui";

/**
 * One scheme drawn in one mode (D222, docs/admin-style.md 7.1): every component of section 5 on a sample page, inside an element
 * marked `data-scheme-preview`, which the scheme's stylesheet colours whatever scheme the page itself is in. A picture, not a page:
 * it is `inert` (nothing in it can be pressed or focused) and its figure says in words what it shows. The figures in it are made up.
 */
export function SchemePreview({
  scheme,
  mode,
  words: w = adminText("en", "bookings").schemePreview,
}: {
  scheme: AdminScheme;
  mode: "light" | "dark";
  /** The words in the account's language (D312 A11); English unless given. */
  words?: AdminAreaMessages["bookings"]["schemePreview"];
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm text-muted">
        {scheme.name}, {mode === "light" ? w.light : w.dark}
      </figcaption>
      <div
        inert
        data-scheme-preview={scheme.id}
        data-preview-mode={mode}
        style={{ colorScheme: mode }}
        className="flex min-w-0 overflow-hidden rounded-card border border-line bg-canvas text-ink"
      >
        {/* The rail (5.3), drawn still: the logo, three sections with the second current, and the foot. */}
        <div className="hidden w-16 shrink-0 flex-col items-center gap-3 bg-rail py-4 sm:flex">
          <span className="flex size-9 items-center justify-center rounded-tile bg-brand text-body-strong text-brand-ink">K</span>
          <span className="mt-4 flex size-10 items-center justify-center rounded-tile text-rail-icon">
            <NavIcon name="home" className="size-5" />
          </span>
          <span className="flex size-10 items-center justify-center rounded-tile bg-brand text-brand-ink">
            <NavIcon name="users" className="size-5" />
          </span>
          <span className="flex size-10 items-center justify-center rounded-tile text-rail-icon">
            <NavIcon name="chat" className="size-5" />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
          <PageHeader
            as="p"
            eyebrow={w.customer}
            status={
              <Chip signal="positive" dot>
                {w.active}
              </Chip>
            }
            title={w.company}
            meta={["Oslo", w.since]}
            actions={
              <>
                <Button>{w.message}</Button>
                <Button kind="main">{w.newInvoice}</Button>
                <Button kind="icon" aria-label={w.notifications} icon={<Bell />} />
              </>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiTile label={w.outstanding} value="84 000 kr" context={w.across} />
            <KpiTile label={w.profit} value={null} context={w.noCosts} />
          </div>
          <Card title={w.behaviour} icon={<FileText />} level={3} aside={<Button kind="link">{w.allInvoices}</Button>}>
            <div className="flex flex-col gap-4">
              <ShareBar label={w.onTime} figure="58 %" share={0.58} signal="positive" />
              <ShareBar label={w.late} figure="30 %" share={0.3} signal="warning" />
              <ShareBar label={w.overdue} figure="12 %" share={0.12} signal="danger" />
              <ScoreBar label={w.history} points="+22" share={0.72} signal="insight" />
              <InsightPanel title={w.changed} at="2026-10-14T09:00:00Z" when={w.today}>
                {w.insight}
              </InsightPanel>
            </div>
          </Card>
          <Card title={w.open} count={2} level={3}>
            <List>
              <ListRow>
                <RowId>INV-1042</RowId>
                <RowText>{w.stoneware}</RowText>
                <RowDate>{w.date}</RowDate>
                <Chip signal="warning" dot>
                  {w.dueSoon}
                </Chip>
                <RowAmount>48 000 kr</RowAmount>
              </ListRow>
              <ListRow highlight>
                <RowId>Kari Nordmann</RowId>
                <RowText>kari@example.com</RowText>
                <Chip signal="positive">{w.contact}</Chip>
              </ListRow>
            </List>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TrendChip direction="up" signal="danger">
                {w.up}
              </TrendChip>
              <Chip signal="insight">{w.ai}</Chip>
              <Chip>{w.draft}</Chip>
              <CountBadge count={12} />
            </div>
            <label className="mt-4 flex flex-col gap-1 text-body text-ink-2">
              {w.field}
              <input readOnly value={w.example} className="h-9 rounded-md border border-edge bg-card px-3 text-ink" />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button kind="quiet">{w.quiet}</Button>
              <Button kind="danger">{w.delete}</Button>
              <Button kind="main" disabled>
                {w.disabled}
              </Button>
            </div>
            <div className="mt-3">
              <Button kind="strong" full>
                {w.remind}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </figure>
  );
}
