import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A list in a card (docs/admin-style.md 5.8): 64 px rows divided by hairlines, no header, no zebra and no hover colour unless the
 * row is a link. A row's parts are `RowId` (the id or name), `RowText` (a description), `RowDate`, a chip and `RowAmount` (right,
 * tabular). A highlighted row (the primary contact) is sunken and rounded, with a chip that says why.
 *
 * A row that has buttons of its own is not a link: its `RowLead` is (its title links to the thing), and `RowActions` holds the
 * buttons on the right. `RowFact` is a short fact that names itself ("4 orders", "Used 3 of 10"), since a list has no header row.
 */

export function List({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul role="list" aria-label={label} className="divide-y divide-line">
      {children}
    </ul>
  );
}

const ROW = "flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 py-3";

export function ListRow({ href, highlight = false, children }: { href?: string; highlight?: boolean; children: ReactNode }) {
  const shape = highlight ? "rounded-panel bg-sunken px-4" : "";
  if (href) {
    return (
      <li>
        <Link href={href} className={`${ROW} -mx-3 rounded-panel px-3 hover:bg-sunken ${shape}`}>
          {children}
        </Link>
      </li>
    );
  }
  return <li className={`${ROW} ${shape}`}>{children}</li>;
}

export const RowId = ({ children }: { children: ReactNode }) => <span className="shrink-0 text-body-strong text-ink">{children}</span>;
export const RowText = ({ children }: { children: ReactNode }) => <span className="min-w-0 flex-1 truncate text-body text-muted">{children}</span>;
export const RowDate = ({ children }: { children: ReactNode }) => <span className="shrink-0 text-body text-ink-2 tabular-nums">{children}</span>;
export const RowAmount = ({ children }: { children: ReactNode }) => (
  <span className="ml-auto shrink-0 text-right text-body-strong text-ink tabular-nums">{children}</span>
);

/** The row's main part: its title (a link to the thing when `href` is given), a sub line or two under it, and an avatar before. */
export function RowLead({ title, href, sub, avatar }: { title: ReactNode; href?: string; sub?: ReactNode; avatar?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 basis-56 items-center gap-3">
      {avatar}
      <span className="min-w-0">
        {href ? (
          <Link href={href} className="text-body-strong text-ink underline-offset-2 hover:underline">
            {title}
          </Link>
        ) : (
          <span className="text-body-strong text-ink">{title}</span>
        )}
        {sub && <span className="block text-caption text-muted">{sub}</span>}
      </span>
    </span>
  );
}

/** A short fact that names itself, with an optional muted line under it; `className` hides it on small screens where it can wait. */
export function RowFact({ sub, className, children }: { sub?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={["shrink-0 text-body text-ink-2 tabular-nums", className].filter(Boolean).join(" ")}>
      {children}
      {sub && <span className="block text-caption text-muted">{sub}</span>}
    </span>
  );
}

/** The row's own buttons, on the right. */
export function RowActions({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex shrink-0 items-center gap-1">{children}</span>;
}
