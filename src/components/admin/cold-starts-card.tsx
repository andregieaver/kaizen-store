import { Card, List, ListRow, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import { COLD_START_LINES_MS, type ColdStartRow } from "@/lib/instance-start";

/** The line a kind's figure is held to, in words, and whether the figure is over it; the beacons only say their distance from the health check. */
function target(row: ColdStartRow, words: CapacityMessages["coldStarts"], number: Intl.NumberFormat): { text: string | null; over: boolean } {
  const distance = row.kind === "proxy" || row.kind === "beacon" ? (row.overHealth ?? null) : null;
  const measured = distance === null ? null : fillWords(words.overHealth, { ms: number.format(distance) });
  if (row.kind === "proxy") {
    const line = fillWords(words.withinHealth, { ms: COLD_START_LINES_MS.proxy });
    return { text: measured === null ? line : `${line} (${measured})`, over: distance !== null && distance > COLD_START_LINES_MS.proxy };
  }
  if (row.kind === "beacon") return { text: measured, over: false };
  if (row.kind === "store") return { text: `${COLD_START_LINES_MS.store} ms`, over: row.p50 > COLD_START_LINES_MS.store };
  if (row.kind === "admin" || row.kind === "platform_admin") return { text: `${COLD_START_LINES_MS.admin} ms`, over: row.p50 > COLD_START_LINES_MS.admin };
  return { text: null, over: false };
}

/**
 * Cold starts of the last days by what the instance was started for (bloat review step 1.16): a day, the median and the 95th percentile
 * of the time to the first answer, against the three lines (the proxy within 150 ms of the health check, a store page within 400 ms, an
 * admin page within 600 ms). A median over its line is drawn as a late job is on this screen.
 */
export function ColdStartsCard({ rows, words, locale }: { rows: ColdStartRow[]; words: CapacityMessages["coldStarts"]; locale: string }) {
  const number = new Intl.NumberFormat(locale);
  return (
    <Card title={words.title} description={words.description} compact>
      {rows.length === 0 ? (
        <p className="text-body text-muted">{words.none}</p>
      ) : (
        <List label={words.title}>
          {rows.map((row) => {
            const line = target(row, words, number);
            return (
              <ListRow key={row.kind}>
                <RowLead title={words.kinds[row.kind]} sub={line.text === null ? undefined : `${words.line}: ${line.text}`} />
                <RowFact sub={words.perDay}>{number.format(row.perDay)}</RowFact>
                <RowFact sub={words.median} className={line.over ? "text-danger-text" : undefined}>{number.format(row.p50)} ms</RowFact>
                <RowFact sub={words.p95}>{number.format(row.p95)} ms</RowFact>
              </ListRow>
            );
          })}
        </List>
      )}
      <p className="mt-3 text-caption text-muted">{words.manifestNote}</p>
    </Card>
  );
}
