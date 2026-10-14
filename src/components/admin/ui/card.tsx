import Link from "next/link";
import { useId, type ReactNode } from "react";

import { CountBadge } from "./chip";

/**
 * Cards and KPI tiles (docs/admin-style.md 5.8): a card is a white panel on the canvas, without a border or a shadow in light
 * (a `line` border in dark, where the two are too close to tell apart, and under forced colours), titled by its header: the
 * title, an optional icon before it and count after it, and a note or link on the right. A KPI tile is a small card holding one
 * figure: its label, the value and a line of context.
 */

export const CARD_CLASS = "rounded-card bg-card dark:border dark:border-line forced-colors:border";

export type CardProps = {
  title?: ReactNode;
  /** An 18 px icon before the title, in the secondary ink. */
  icon?: ReactNode;
  /** A count after the title ("Open invoices 4"), with `countLabel` read in its place. */
  count?: number;
  countLabel?: string;
  /** On the header's right: a muted note or a `link` button. */
  aside?: ReactNode;
  /** The title's level; a card's is a section's (`h2`) unless it sits under one. */
  level?: 2 | 3;
  /** Less room inside (20 px, as a KPI tile) for a card in a dense grid. */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Card({ title, icon, count, countLabel, aside, level = 2, compact = false, className, children }: CardProps) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={title ? id : undefined} className={[CARD_CLASS, compact ? "p-5" : "p-6", className].filter(Boolean).join(" ")}>
      {(title || aside) && (
        <header className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {title && (
            <div className="flex min-w-0 items-center gap-2">
              {icon && (
                <span aria-hidden className="text-ink-2 [&_svg]:size-[18px]">
                  {icon}
                </span>
              )}
              <Heading id={id} className="text-title text-ink">
                {title}
              </Heading>
              {count !== undefined && <CountBadge count={count} label={countLabel} />}
            </div>
          )}
          {aside && <div className="text-body text-muted">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export type KpiTileProps = {
  label: ReactNode;
  /** The figure as written ("842 000 kr"); a figure that cannot be known is never 0: pass what is missing as `context` and null here. */
  value: ReactNode | null;
  context?: ReactNode;
  /** Where the figure is explained: the whole tile is the link. */
  href?: string;
};

export function KpiTile({ label, value, context, href }: KpiTileProps) {
  const body = (
    <>
      <span className="block text-body text-muted">{label}</span>
      <span className="mt-2 block text-metric text-ink tabular-nums">{value ?? <span className="text-faint">–</span>}</span>
      {context && <span className="mt-1 block text-caption text-muted">{context}</span>}
    </>
  );
  const tile = `${CARD_CLASS} block p-5`;
  return href ? (
    <Link href={href} className={`${tile} hover:bg-sunken`}>
      {body}
    </Link>
  ) : (
    <div className={tile}>{body}</div>
  );
}
