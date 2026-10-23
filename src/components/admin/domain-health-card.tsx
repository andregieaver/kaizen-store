import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import type { Signal } from "@/lib/admin-schemes";
import { findingText, worstSeverity, type Finding, type Severity } from "@/lib/domain-health";

import { Card, Chip } from "./ui";

/** A domain's health as the page shows it (D315 5.3): what `storeDomainHealth()` found, in the admin's words. */
export type HealthRow = {
  hostname: string;
  registrar: string | null;
  withUs: boolean;
  expiresAt: string | null;
  dnsHost: "kaizena" | "elsewhere" | "unknown";
  findings: Finding[];
};

const SIGNAL: Record<Severity, Signal> = { error: "danger", warning: "warning", advice: "insight", info: "neutral" };

/** One card with each domain's findings, the worst first; a healthy domain is one line. */
export function DomainHealthCard({ rows, words, locale }: { rows: HealthRow[]; words: DomainsMessages; locale: string }) {
  if (rows.length === 0) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(iso));
  return (
    <Card title={words.healthTitle} description={words.healthChecking}>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => {
          const worst = worstSeverity(row.findings);
          return (
            <li key={row.hostname} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-strong text-ink">{row.hostname}</span>
                <Chip signal={worst === "info" ? "positive" : SIGNAL[worst]} dot>
                  {worst === "info" ? words.working : words.severity[worst]}
                </Chip>
                <span className="text-caption text-muted">
                  {[
                    row.withUs ? words.registeredWith.replace("{registrar}", "Kaizena Flow") : row.registrar ? words.registeredWith.replace("{registrar}", row.registrar) : null,
                    row.expiresAt ? words.expiresOn.replace("{date}", date(row.expiresAt)) : null,
                    row.dnsHost === "kaizena" ? words.dnsHere : row.dnsHost === "elsewhere" ? words.dnsElsewhere : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {row.findings
                  .filter((f) => f.code !== "healthy")
                  .map((f) => (
                    <li key={f.code} className="flex items-start gap-2 text-body">
                      <span className="mt-0.5">
                        <Chip signal={SIGNAL[f.severity]}>{words.severity[f.severity]}</Chip>
                      </span>
                      <span className={f.severity === "error" ? "text-ink" : "text-ink-2"}>{findingText(f, words.health)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
