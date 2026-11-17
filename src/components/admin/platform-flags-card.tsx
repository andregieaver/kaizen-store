import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import type { COSTLY_ALLOWED, DayDifference, PlatformFlag, WHOLE_READ_ALLOWED } from "@/lib/platform-flags";

/**
 * Usage and limits: the database flags raised from the two latest stored readings of production and, one step away, the day's difference
 * (bloat review step 1.13). The flags list is what Homer reads; the figures sit inside a closed `<details>`. Nothing here reads a statistics
 * view: `difference` and `flags` come from `currentFlags()`, which reads the stored rows.
 */
export function PlatformFlagsCard({
  flags,
  difference,
  allowed,
  words,
  locale,
}: {
  flags: PlatformFlag[];
  /** Null while fewer than two days of readings are stored. */
  difference: DayDifference | null;
  allowed: { wholeRead: typeof WHOLE_READ_ALLOWED; costly: typeof COSTLY_ALLOWED };
  words: CapacityMessages["flags"];
  locale: string;
}) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const megabytes = (bytes: number) => `${bytes < 0 ? "-" : bytes > 0 ? "+" : ""}${number.format(Math.abs(bytes) / (1024 * 1024))} MB`;
  const shorten = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);
  const hasAllowed = allowed.wholeRead.length + allowed.costly.length > 0;
  return (
    <div id="flags" className="flex flex-col gap-6">
      <Card title={words.title} compact>
        {difference === null ? (
          <p className="text-body text-muted">{words.waiting}</p>
        ) : flags.length === 0 ? (
          <p className="text-body text-ink-2">{words.none}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-body text-ink-2">
            {flags.map((flag, i) => (
              <li key={`${flag.id}-${i}`}>{fillWords(words.flags[flag.id], { subject: flag.subject, ...flag.values })}</li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <h3 className="text-caption font-medium text-ink">{words.allowedTitle}</h3>
          {hasAllowed ? (
            <ul className="mt-2 flex flex-col gap-1 text-caption text-ink-2">
              {allowed.wholeRead.map((e) => (
                <li key={`whole-${e.table}`}>
                  <code className="font-mono text-ink">{e.table}</code>: {e.reason}
                </li>
              ))}
              {allowed.costly.map((e) => (
                <li key={`costly-${e.key}`}>
                  <code className="font-mono text-ink">{e.key}</code> ({fillWords(words.ceiling, { ms: e.ceilingMs })}): {e.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-caption text-muted">{words.allowedNone}</p>
          )}
        </div>
      </Card>
      {difference !== null && (
        <Card title={words.changedTitle} compact>
          <details>
            <summary className="cursor-pointer text-body text-ink-2">{words.details}</summary>
            <div className="mt-3 flex flex-col gap-6">
              <section>
                <h4 className="text-caption text-muted">{words.schemasTitle}</h4>
                <table className="mt-1 w-full text-left text-caption">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-4">{words.schema}</th>
                      <th scope="col" className="py-1 pr-4">{words.change}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {difference.schemas.map((s) => (
                      <tr key={s.name}>
                        <th scope="row" className="py-1 pr-4 font-mono text-ink">{s.name}</th>
                        <td className="py-1 pr-4 tabular-nums text-ink-2">{megabytes(s.bytesChange)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h4 className="mt-4 text-caption text-muted">{words.statementsTitle}</h4>
                <div className="overflow-x-auto">
                  <table className="mt-1 w-full text-left text-caption">
                    <thead className="text-muted">
                      <tr>
                        <th scope="col" className="py-1 pr-4">{words.statement}</th>
                        <th scope="col" className="py-1 pr-4">{words.calls}</th>
                        <th scope="col" className="py-1 pr-4">{words.time}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {difference.statements.map((s) => (
                        <tr key={s.key}>
                          <td className="py-1 pr-4"><code className="font-mono text-ink">{shorten(s.text)}</code></td>
                          <td className="py-1 pr-4 tabular-nums text-ink-2">{number.format(s.calls)}</td>
                          <td className="py-1 pr-4 tabular-nums text-ink-2">{number.format(s.totalMs)} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4 className="mt-4 text-caption text-muted">{words.tablesTitle}</h4>
                <table className="mt-1 w-full text-left text-caption">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-4">{words.table}</th>
                      <th scope="col" className="py-1 pr-4">{words.scans}</th>
                      <th scope="col" className="py-1 pr-4">{words.rowsRead}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {difference.tables.map((t) => (
                      <tr key={t.name}>
                        <th scope="row" className="py-1 pr-4 font-mono text-ink">{t.name}</th>
                        <td className="py-1 pr-4 tabular-nums text-ink-2">{number.format(t.seqScans)}</td>
                        <td className="py-1 pr-4 tabular-nums text-ink-2">{number.format(t.seqRowsRead)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </details>
        </Card>
      )}
    </div>
  );
}
