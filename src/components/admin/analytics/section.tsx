import type { ReactNode } from "react";

/**
 * The frame of an analytics page (D152): a section with its heading, a card for a chart, and the notes that say what a figure is not
 * (not tracked, estimated). Server components in the admin's tokens, so they follow it in light and dark.
 */

/** A heading with a description and an action, over what the section holds. The heading's `id` is what the section is labelled by (and can be linked to). */
export function AnalyticsSection({
  id,
  title,
  description,
  action,
  level = 2,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={id} className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Heading id={id} className={level === 3 ? "text-base font-semibold" : "text-lg font-semibold"}>
            {title}
          </Heading>
          {description ? <p className="mt-0.5 max-w-prose text-sm text-muted">{description}</p> : null}
        </div>
        {action ? <div className="max-w-full text-sm">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A card around one chart or table, with a small title and an optional line under it. */
export function ChartCard({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {action ? <div className="max-w-full text-xs">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

export type NoteTone = "info" | "warning";

const NOTE_ICON: Record<NoteTone, string> = { info: "i", warning: "!" };

/**
 * A box that says what a figure is not: "not tracked", "estimated", "based on 83 % of sales". It starts with a word and an icon, so it
 * never leans on colour alone.
 */
export function Note({ tone = "info", title, children }: { tone?: NoteTone; title?: string; children?: ReactNode }) {
  return (
    <div
      role="note"
      data-tone={tone}
      className={`flex gap-2.5 rounded-lg border px-3 py-2 text-sm ${tone === "warning" ? "border-(--chart-warn) bg-surface" : "border-border bg-surface"}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${tone === "warning" ? "border-(--chart-warn) text-(--chart-warn)" : "border-muted text-muted"}`}
      >
        {NOTE_ICON[tone]}
      </span>
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}
