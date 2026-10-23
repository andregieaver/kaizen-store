import { Card, Chip } from "@/components/admin/ui";
import { THEME_CHECKS, type ThemeCheckResult } from "@/lib/theme-check";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

/**
 * The theme checks on what Publish would publish (D246, `themeCheck()`): passed, or each finding grouped by check, blocking first. Server-drawn,
 * on a theme's Details tab.
 */
export function ThemeChecks({ result, words: w = platformSiteEn.checks, names = platformSiteEn.tables.checks }: { result: ThemeCheckResult | null; words?: PlatformSiteMessages["checks"]; names?: PlatformSiteMessages["tables"]["checks"] }) {
  if (!result) return null;
  const warnings = result.findings.length - result.blocking;
  const groups = (Object.keys(THEME_CHECKS) as (keyof typeof THEME_CHECKS)[])
    .map((check) => ({ check, findings: result.findings.filter((finding) => finding.check === check).sort((a, b) => Number(b.blocking) - Number(a.blocking)) }))
    .filter((group) => group.findings.length > 0);
  return (
    <Card
      title={w.title}
      description={w.description}
      aside={
        result.blocking > 0 ? (
          <Chip signal="danger">{fillWords(w.toFix, { n: result.blocking })}</Chip>
        ) : warnings > 0 ? (
          <Chip signal="warning">{fillWords(w.toLook, { n: warnings })}</Chip>
        ) : (
          <Chip signal="positive" dot>
            {w.passes}
          </Chip>
        )
      }
      compact
    >
      {groups.length === 0 ? (
        <p className="text-body text-ink-2">{w.nothing}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.check} aria-label={names[group.check]} className="flex flex-col gap-1">
              <h3 className="text-body-strong text-ink">{names[group.check]}</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
                {group.findings.map((finding, index) => (
                  <li key={index}>
                    {finding.blocking ? <strong className="text-danger-text">{w.blocks}</strong> : <span className="text-warning-text">{w.look}</span>}
                    {finding.where}: {finding.message}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
