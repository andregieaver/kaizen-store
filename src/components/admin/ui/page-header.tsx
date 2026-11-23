import { ChevronLeft } from "lucide-react";
import { AdminLink } from "./link";
import { Fragment, type ReactNode } from "react";

import { SectionEyebrow } from "./section-eyebrow";

/**
 * A page's header (docs/admin-style.md 5.5): an eyebrow and a state chip, the title, and a meta line of facts joined by " · ";
 * the actions on the right, aligned with the meta line (secondary, main, more), wrapping under it on a phone. Above it, a way back
 * to the page it belongs under; under the title, a description for a page that needs a sentence to say what it is for.
 *
 * The eyebrow says where the page is (code review step 2.2, D873): a page that passes none shows its section's word, the section the
 * rail marks for its address (`SectionEyebrow`), and none on Home's pages or where the title or the way back is that word. A page's
 * own `eyebrow` wins, `eyebrow={false}` asks for none, and a sample header (`as="p"`) shows none.
 */
export function PageHeader({
  back,
  eyebrow,
  status,
  title,
  meta = [],
  description,
  actions,
  as: Title = "h1",
}: {
  /** The page this one belongs under, as a quiet link with a chevron back. */
  back?: { href: string; label: ReactNode };
  /** Left out, the section's word from the address (D873); `false` for none. */
  eyebrow?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  meta?: readonly ReactNode[];
  /** What the page is for, in a sentence or two (ink-2, at reading width). */
  description?: ReactNode;
  actions?: ReactNode;
  /** The title's element: the page's `h1`, or a `p` where the header is a sample (the Appearance page's previews). */
  as?: "h1" | "p";
}) {
  const facts = meta.filter((fact) => fact !== null && fact !== undefined && fact !== false && fact !== "");
  // The section's word where the page names no eyebrow, drawn where the address is known, unless the title or the way back already says
  // it (their plain words, lower-cased, a line each); a line left empty folds away (`empty:hidden`).
  const said = [title, back?.label].filter((words) => typeof words === "string").join("\n").toLowerCase();
  const word = eyebrow ? (
    <span className="text-eyebrow text-muted uppercase">{eyebrow}</span>
  ) : eyebrow === undefined && Title === "h1" ? (
    <SectionEyebrow said={said} />
  ) : null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {back && (
          <AdminLink href={back.href} className="mb-3 inline-flex items-center gap-1 text-body text-ink-2 hover:text-ink">
            <ChevronLeft aria-hidden className="size-4" />
            {back.label}
          </AdminLink>
        )}
        {(word || status) && (
          <div className="mb-2 flex flex-wrap items-center gap-3 empty:hidden">
            {word}
            {status}
          </div>
        )}
        <Title className="text-display text-ink [overflow-wrap:anywhere]">{title}</Title>
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
        {description && <div className="mt-2 max-w-[75ch] text-body text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}
