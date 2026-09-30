import { useId, type ReactNode } from "react";

import { KIND_LABELS, type TemplateItem } from "@/lib/templates";

import { forLabel } from "./templates-helpers";

/** Small pieces the Templates tab and its modal both draw (D125). */

/** Marks a template Kaizen published. */
export function KaizenBadge() {
  return (
    <span className="shrink-0 rounded-full border border-border bg-surface px-1.5 py-px text-[11px] font-medium leading-4 text-foreground">
      Kaizen
    </span>
  );
}

/** Who published a template, with Kaizen's marked. */
export function Publisher({ item }: { item: Pick<TemplateItem, "publisher" | "fromKaizen"> }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span className="truncate">By {item.publisher}</span>
      {item.fromKaizen && <KaizenBadge />}
    </span>
  );
}

/** What went wrong, next to the thing it went wrong with. */
export function Problems({ problems }: { problems: readonly string[] | undefined }) {
  if (!problems || problems.length === 0) return null;
  return (
    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
      {problems.join(" ")}
    </p>
  );
}

/** A list that has nothing to show, and what to do about it. */
export function EmptyState({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted">{hint}</p>
      {children}
    </div>
  );
}

/** A group's heading, as the Saved tab's. */
export const groupHeading = "text-xs font-medium tracking-wide text-muted uppercase";

/** "For articles": what kind of page a page layout is made for (D127). Nothing for the other kinds. `warn` when it does not fit this page. */
export function PageTypeBadge({ item, warn = false }: { item: Pick<TemplateItem, "kind" | "pageType">; warn?: boolean }) {
  const label = forLabel(item);
  if (!label) return null;
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-px text-[11px] leading-4 ${
        warn ? "border-amber-700 text-amber-800 dark:border-amber-400 dark:text-amber-300" : "border-border text-muted"
      }`}
    >
      {label}
    </span>
  );
}

const cardButton = "min-h-9 shrink-0 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface disabled:opacity-50";

/**
 * A template card's buttons: Preview (D127) and Use, with the reason Use is off in words under them, joined to the
 * button for a screen reader. Anything else the list adds (Activate) comes as `children`.
 */
export function CardButtons({
  item,
  reason,
  using,
  disabled = false,
  onPreview,
  onUse,
  children,
}: {
  item: Pick<TemplateItem, "id" | "kind" | "name">;
  /** Why it cannot be used, or null. */
  reason: string | null;
  /** This template is being fetched to use. */
  using: boolean;
  /** Something else is being fetched. */
  disabled?: boolean;
  onPreview: (opener: HTMLElement) => void;
  onUse: () => void;
  children?: ReactNode;
}) {
  const reasonId = useId();
  return (
    <>
      <div className="flex shrink-0 flex-wrap gap-1">
        <button
          type="button"
          onClick={(event) => onPreview(event.currentTarget)}
          aria-label={`Preview ${item.name}`}
          className={cardButton}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onUse}
          disabled={disabled || reason !== null}
          aria-label={`Use ${KIND_LABELS[item.kind].one.toLowerCase()} ${item.name}`}
          aria-describedby={reason ? reasonId : undefined}
          title={reason ?? undefined}
          className={cardButton}
        >
          {using ? "Adding …" : "Use"}
        </button>
        {children}
      </div>
      {reason && (
        <p id={reasonId} className="w-full text-xs text-muted">
          {reason}
        </p>
      )}
    </>
  );
}
