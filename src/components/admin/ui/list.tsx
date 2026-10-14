import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A list in a card (docs/admin-style.md 5.8): 64 px rows divided by hairlines, no header, no zebra and no hover colour unless the
 * row is a link. A row's parts are `RowId` (the id or name), `RowText` (a description), `RowDate`, a chip and `RowAmount` (right,
 * tabular). A highlighted row (the primary contact) is sunken and rounded, with a chip that says why.
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
