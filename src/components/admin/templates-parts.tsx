import type { ReactNode } from "react";

import type { TemplateItem } from "@/lib/templates";

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
