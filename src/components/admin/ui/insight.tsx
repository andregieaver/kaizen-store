import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What the AI wrote (docs/admin-style.md 5.8): the insight's tint, the sparkle and a title, and always when it was written, so a
 * reader can tell a fresh reading from an old one. Nothing else uses this panel: a fact the site worked out is a card or a chip.
 */
export function InsightPanel({ title, at, when, children }: { title: ReactNode; at: Date | string; when: ReactNode; children: ReactNode }) {
  const iso = typeof at === "string" ? at : at.toISOString();
  return (
    <aside className="rounded-panel bg-insight-soft p-5 forced-colors:border">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-body-strong text-insight-text">
          <Sparkles aria-hidden className="size-4" />
          {title}
        </span>
        <time dateTime={iso} className="text-caption text-muted">
          {when}
        </time>
      </div>
      <div className="text-body-lg text-ink">{children}</div>
    </aside>
  );
}
