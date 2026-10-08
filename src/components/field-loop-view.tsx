import Link from "next/link";
import type { ReactNode } from "react";

import { RichText } from "@/components/rich-text";
import type { ShownLink } from "@/lib/custom-fields";
import { isInternalAddress, isSafeAddress } from "@/lib/field-parts";
import type { LoopRow } from "@/lib/field-loop";
import type { LoopColumns, LoopLayout } from "@/lib/page-content";

/**
 * A repeater's rows as the site draws them (D120), one small layout per row
 * from the slots the owner filled (`loopRows()`): cards (the theme's cards),
 * a list with a small picture beside each line, a grid of pictures, or
 * plain columns. Everything is drawn as elements from values already checked
 * (`src/lib/field-loop.ts`): a picture is one of ours, a link's address is
 * safe, rich text is never HTML. A row's link is the title, or with
 * `linkWholeCard` the whole card, through one anchor stretched over it: a
 * link is never inside a link. Nothing to draw draws nothing.
 */

const COLUMNS: Record<LoopColumns, string> = {
  2: "kzb-md-cols-2",
  3: "kzb-md-cols-2 kzb-lg-cols-3",
  4: "kzb-md-cols-2 kzb-lg-cols-4",
};

/** A link to a safe address: a page of the site goes through the router, anything else is a plain link. */
function Anchor({ link, className, children }: { link: ShownLink; className: string; children?: ReactNode }) {
  const href = link.href.trim();
  if (!isSafeAddress(href)) return <>{children ?? link.label}</>;
  const target = link.newTab ? ({ target: "_blank", rel: "noopener noreferrer" } as const) : {};
  const content = children ?? link.label;
  return isInternalAddress(href) ? (
    <Link href={href} className={className} {...target}>
      {content}
    </Link>
  ) : (
    <a href={href} className={`${className} break-words`} {...target} rel="noopener noreferrer">
      {content}
    </a>
  );
}

const STRETCH = "after:absolute after:inset-0 after:content-['']";
const LINK = "underline-offset-2 hover:underline focus-visible:outline-2";

function Picture({ row, className, small = false }: { row: LoopRow; className: string; small?: boolean }) {
  if (!row.image) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a library picture whose size is not known here, shown as it is
    <img
      src={small ? (row.image.thumbnailUrl ?? row.image.url) : row.image.url}
      alt={row.image.alt}
      loading="lazy"
      className={`bg-surface ${className}`}
    />
  );
}

/** A row's words: its badge, title (the link, or plain), text, and the link's own words when there is no title to be the link. */
function Words({ row, whole, Title }: { row: LoopRow; whole: boolean; Title: "h2" | "h3" }) {
  const { link } = row;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {row.badge && (
        <span className="w-fit rounded-button bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground" data-kz-text="badge">
          {row.badge}
        </span>
      )}
      {row.title && (
        <Title className="leading-snug font-heading font-medium text-balance" data-kz-text="title">
          {link ? (
            <Anchor link={link} className={`${LINK} ${whole ? STRETCH : ""}`}>
              {row.title}
            </Anchor>
          ) : (
            row.title
          )}
        </Title>
      )}
      {row.text &&
        (row.text.kind === "rich" ? (
          // Rich text may hold links of its own, so it stays above the stretched link to be usable.
          <div className="relative z-[2] text-sm text-muted" data-kz-text="excerpt">
            <RichText doc={row.text.doc} />
          </div>
        ) : (
          <p className="text-sm whitespace-pre-line text-muted" data-kz-text="excerpt">
            {row.text.text}
          </p>
        ))}
      {link && !row.title && (
        <p className="text-sm" data-kz-text="button">
          <Anchor link={link} className={`${LINK} underline ${whole ? STRETCH : ""}`} />
        </p>
      )}
    </div>
  );
}

function Item({ row, layout, whole, Title }: { row: LoopRow; layout: LoopLayout; whole: boolean; Title: "h2" | "h3" }) {
  const linked = row.link && whole ? "relative focus-within:outline-2" : "relative";
  const words = <Words row={row} whole={whole} Title={Title} />;
  switch (layout) {
    case "list":
      return (
        <li className={`${linked} flex items-start gap-4 py-3`}>
          <Picture row={row} small className="size-16 shrink-0 rounded-lg object-cover kzb-md-size-20" />
          {words}
        </li>
      );
    case "grid":
      return (
        <li className={`${linked} product-card flex min-w-0 flex-col gap-3`}>
          <Picture row={row} className="product-card-image w-full rounded-lg object-cover" />
          {words}
        </li>
      );
    case "columns":
      return (
        <li className={`${linked} flex min-w-0 flex-col gap-3`}>
          <Picture row={row} className="aspect-video w-full rounded-lg object-cover" />
          {words}
        </li>
      );
    default:
      return (
        <li className={`${linked} product-card flex min-w-0 flex-col gap-3`}>
          <Picture row={row} className="aspect-[4/3] w-full rounded-lg object-cover" />
          {words}
        </li>
      );
  }
}

export function FieldLoopView({
  rows,
  layout = "cards",
  columns = 3,
  linkWholeCard = false,
  heading,
  id,
}: {
  rows: LoopRow[];
  layout?: LoopLayout;
  columns?: LoopColumns;
  linkWholeCard?: boolean;
  /** The words over the loop, when the owner wrote some. */
  heading?: string | null;
  /** The heading's id, for `aria-labelledby`. */
  id: string;
}) {
  if (rows.length === 0) return null;
  const Title = heading ? "h3" : "h2";
  const list =
    layout === "list"
      ? "flex flex-col divide-y divide-border"
      : `grid grid-cols-1 gap-4 ${COLUMNS[columns] ?? COLUMNS[3]}`;
  return (
    <section aria-labelledby={heading ? id : undefined} className="flex flex-col gap-3" data-field-loop={layout}>
      {heading && (
        <h2 id={id} className="font-medium">
          {heading}
        </h2>
      )}
      <ul className={list}>
        {rows.map((row, index) => (
          <Item key={index} row={row} layout={layout} whole={linkWholeCard} Title={Title} />
        ))}
      </ul>
    </section>
  );
}
