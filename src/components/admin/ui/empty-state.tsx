import type { ReactNode } from "react";

/**
 * A list or a screen with nothing to show yet (code review step 1.12, D818; FS8): what is missing in a title, a line on what it is for or
 * why it is empty, and one next step (`action`: a `ButtonLink` to make the first, or *Clear filters* on a filtered list that matched
 * nothing). Drawn in a dashed box so it reads as a place that fills, not as an error. `compact` is the small left-aligned box a panel or a
 * dialog uses. No state: server pages and client parts both draw it.
 */
export function EmptyState({
  title,
  children,
  action,
  icon,
  compact = false,
  className,
}: {
  title: ReactNode;
  /** The line under the title: what goes here, or why nothing matched. */
  children?: ReactNode;
  /** The one next step. */
  action?: ReactNode;
  /** An icon above the title, in the secondary ink. */
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const box = compact
    ? "flex flex-col items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm"
    : "flex flex-col items-center gap-2 rounded-panel border border-dashed border-line px-4 py-8 text-center";
  return (
    <div className={[box, className].filter(Boolean).join(" ")}>
      {icon && (
        <span aria-hidden className="text-ink-2 [&_svg]:size-6">
          {icon}
        </span>
      )}
      <p className={compact ? "font-medium" : "text-body-strong text-ink"}>{title}</p>
      {children && <div className={compact ? "text-xs text-muted" : "max-w-[60ch] text-body text-muted"}>{children}</div>}
      {action && <div className={compact ? "flex flex-wrap gap-2" : "mt-2 flex flex-wrap justify-center gap-2"}>{action}</div>}
    </div>
  );
}
