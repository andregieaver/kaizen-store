import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import { fillWords } from "@/lib/admin-fill";
import { formatLimit, formatUsage } from "@/lib/usage-format";
import { hardLimitReached, type PanelAction, type RowAction, type UsageLine } from "@/lib/usage-view";

import { ButtonLink, ShareBar } from "./ui";

/** A line's figure: what is used of what the plan includes, unlimited, or not measured yet. */
export function usageFigure(line: UsageLine, w: CapacityMessages, locale: string): string {
  if (!line.measured) return w.usage.notMeasured;
  const used = formatUsage(line.metric, line.used, locale);
  const figure = line.limit === null ? `${used} · ${w.usage.noLimit}` : fillWords(w.usage.ofLimit, { used, limit: formatLimit(line.key, line.limit, locale) });
  return line.estimated ? `${figure} (${w.usage.estimated})` : figure;
}

/**
 * What a store used this month against its limits (D314, `docs/capacity.md` 4, step 2.5): a bar per limit, and one plain sentence and
 * button when something is used up. A soft limit over its share says the shop stays open.
 */
export function UsageLines({ lines, words: w, locale, plansHref }: { lines: readonly UsageLine[]; words: CapacityMessages; locale: string; plansHref?: string }) {
  const softOver = lines.some((l) => l.enforce === "soft" && (l.state === "reached" || l.state === "over"));
  const hardFull = hardLimitReached(lines);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {lines.map((line) => (
          <div key={line.metric} className="grid gap-1">
            <ShareBar label={w.metrics[line.metric]} figure={usageFigure(line, w, locale)} share={line.share} signal={line.measured ? line.signal : "neutral"} />
            {line.measured && line.state !== "ok" && <span className={`text-caption ${line.signal === "danger" ? "text-danger-text" : "text-warning-text"}`}>{w.states[line.state]}</span>}
          </div>
        ))}
      </div>
      {(hardFull || softOver) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-sunken p-4 text-body text-ink-2">
          <span>{hardFull ? w.usage.hardReached : w.usage.softOver}</span>
          {plansHref && <ButtonLink href={plansHref}>{w.usage.seePlans}</ButtonLink>}
        </div>
      )}
    </div>
  );
}

/** The metrics a day's row shows in the details, in the order of the lines. */
const DAY_METRICS = ["storage_bytes", "products", "requests", "server_errors", "emails", "marketing_emails", "ai_cost_micros"] as const;

/** Lisa's details: each measured day's figures, newest first, in a table (figures compared down a column). */
export function UsageDays({ days, words: w, locale }: { days: readonly { day: string; values: Partial<Record<(typeof DAY_METRICS)[number], number>> }[]; words: CapacityMessages; locale: string }) {
  if (days.length === 0) return null;
  return (
    <details className="text-body">
      <summary className="cursor-pointer text-ink-2">{w.usage.details}</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-caption">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-4">{w.usage.day}</th>
              {DAY_METRICS.map((m) => (
                <th key={m} scope="col" className="py-1 pr-4 text-right">{w.metrics[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {days.map((row) => (
              <tr key={row.day}>
                <th scope="row" className="py-1 pr-4 text-ink-2">{row.day}</th>
                {DAY_METRICS.map((m) => (
                  <td key={m} className="py-1 pr-4 text-right tabular-nums">{row.values[m] === undefined ? "" : formatUsage(m, row.values[m] ?? 0, locale)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** *Planning a big sale?* (D314, step 4.1): the store's busy times coming up, and a small form to add one. */
export function PeaksForm({
  peaks,
  words: w,
  add,
  remove,
}: {
  peaks: readonly { id: string; startsAt: string; endsAt: string; expected: "busy" | "very_busy"; note: string }[];
  words: CapacityMessages;
  add: PanelAction;
  remove: RowAction;
}) {
  const field = "rounded-lg border border-edge bg-card px-2 py-1";
  return (
    <div className="grid gap-3">
      {peaks.length > 0 && (
        <ul className="grid gap-2 text-body">
          {peaks.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-sunken px-3 py-2">
              <span>
                {p.startsAt.slice(0, 10)} – {p.endsAt.slice(0, 10)} · {p.expected === "very_busy" ? w.peaks.veryBusy : w.peaks.busy}
                {p.note ? ` · ${p.note}` : ""}
              </span>
              <ActionForm action={remove(p.id)}>
                <SubmitButton variant="secondary">{w.peaks.remove}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={add} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-body">
          {w.peaks.starts}
          <input type="date" name="starts" required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-body">
          {w.peaks.ends}
          <input type="date" name="ends" required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-body">
          {w.peaks.expected}
          <select name="expected" className={field} defaultValue="busy">
            <option value="busy">{w.peaks.busy}</option>
            <option value="very_busy">{w.peaks.veryBusy}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-body">
          {w.peaks.note}
          <input name="note" maxLength={300} className={`${field} w-56`} />
        </label>
        <SubmitButton>{w.peaks.add}</SubmitButton>
      </ActionForm>
    </div>
  );
}
