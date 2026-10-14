import { Fragment, type ReactNode } from "react";

/**
 * A page's header (docs/admin-style.md 5.5): an eyebrow and a state chip, the title, and a meta line of facts joined by " · ";
 * the actions on the right, aligned with the meta line (secondary, main, more), wrapping under it on a phone.
 */
export function PageHeader({
  eyebrow,
  status,
  title,
  meta = [],
  actions,
}: {
  eyebrow?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  meta?: readonly ReactNode[];
  actions?: ReactNode;
}) {
  const facts = meta.filter((fact) => fact !== null && fact !== undefined && fact !== false && fact !== "");
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {(eyebrow || status) && (
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {eyebrow && <span className="text-eyebrow text-muted uppercase">{eyebrow}</span>}
            {status}
          </div>
        )}
        <h1 className="text-display text-ink [overflow-wrap:anywhere]">{title}</h1>
        {facts.length > 0 && (
          <p className="mt-2 text-body-lg text-ink-2">
            {facts.map((fact, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                {i > 0 && <span className="sr-only">, </span>}
                {fact}
              </Fragment>
            ))}
          </p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}
