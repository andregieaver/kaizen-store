import Link from "next/link";

import type { Alert, AlertSeverity } from "@/lib/analytics-alerts";

import { StatusPill, type PillTone } from "./data-table";
import { AnalyticsSection } from "./section";

/**
 * What needs the owner, drawn from the alert engine's list (D152, `alertsFor()`): the Overview's "Needs you today" and the store's
 * home page both use it. It draws what it is given and nothing else (no data access); an empty list draws nothing at all, so the slot
 * costs the page no room. An alert's `href` is a path after the store's admin base; `base` is that base (`/admin/{store}`).
 */

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

const SEVERITY: Record<AlertSeverity, { tone: PillTone; word: string }> = {
  urgent: { tone: "bad", word: "Urgent" },
  warning: { tone: "warning", word: "Needs a look" },
  info: { tone: "info", word: "Good to know" },
  good: { tone: "good", word: "Good news" },
};

/** The address an alert links to: the store's admin base and the alert's own path. */
export function alertHref(base: string, alert: Pick<Alert, "href">): string {
  return `${base}${alert.href.startsWith("/") ? "" : "/"}${alert.href}`;
}

/** The alerts as a list: the severity in words, the text, the evidence behind it (folded away) and a link to where to look. */
export function AlertList({ alerts, base }: { alerts: readonly Alert[]; base: string }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-background">
      {alerts.map((a) => (
        <li key={a.id} data-alert={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <StatusPill tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].word}</StatusPill>
          {/* On a phone the words keep a line of their own width and the link drops under them, instead of the words being squeezed into a sliver. */}
          <span className="min-w-[14rem] flex-1 basis-56">{a.text}</span>
          <Link href={alertHref(base, a)} className={linkClass}>
            {a.action || "Open"}
          </Link>
          {a.evidence.length > 0 ? (
            <details className="basis-full text-xs text-muted">
              <summary className="cursor-pointer select-none">The figures behind it</summary>
              <ul className="mt-1 space-y-0.5">
                {a.evidence.map((e, i) => (
                  <li key={i}>
                    {e.label}: <span className="tabular-nums text-foreground">{e.value}</span>
                    {e.baseline ? <span>, against {e.baseline}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The Overview's "Needs you today": draws nothing for an empty list. */
export function AlertsSection({ alerts, base }: { alerts: readonly Alert[]; base: string }) {
  if (alerts.length === 0) return null;
  return (
    <AnalyticsSection id="overview-today" title="Needs you today" description="What is worth a look right now, most urgent first.">
      <AlertList alerts={alerts} base={base} />
    </AnalyticsSection>
  );
}
