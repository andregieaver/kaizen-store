import { Card, Chip } from "@/components/admin/ui";
import { THEME_CHECKS, type ThemeCheckResult } from "@/lib/theme-check";

/**
 * The theme checks on what Publish would publish (D246, `themeCheck()`): passed, or each finding grouped by check, blocking first. Server-drawn,
 * on a theme's Details tab.
 */
export function ThemeChecks({ result }: { result: ThemeCheckResult | null }) {
  if (!result) return null;
  const warnings = result.findings.length - result.blocking;
  const groups = (Object.keys(THEME_CHECKS) as (keyof typeof THEME_CHECKS)[])
    .map((check) => ({ check, findings: result.findings.filter((finding) => finding.check === check).sort((a, b) => Number(b.blocking) - Number(a.blocking)) }))
    .filter((group) => group.findings.length > 0);
  return (
    <Card
      title="Theme checks"
      description="Every version passes these before it is published: its files, accessibility, contrast in light and dark, the core section styles, the checkout's pages, and words and links. What blocks must be fixed; the rest is worth a look."
      aside={
        result.blocking > 0 ? (
          <Chip signal="danger">{result.blocking} to fix</Chip>
        ) : warnings > 0 ? (
          <Chip signal="warning">Passes, {warnings} to look at</Chip>
        ) : (
          <Chip signal="positive" dot>
            Passes
          </Chip>
        )
      }
      compact
    >
      {groups.length === 0 ? (
        <p className="text-body text-ink-2">Nothing found: the draft can be published.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.check} aria-label={THEME_CHECKS[group.check]} className="flex flex-col gap-1">
              <h3 className="text-body-strong text-ink">{THEME_CHECKS[group.check]}</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
                {group.findings.map((finding, index) => (
                  <li key={index}>
                    {finding.blocking ? <strong className="text-danger-text">Blocks: </strong> : <span className="text-warning-text">To look at: </span>}
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
