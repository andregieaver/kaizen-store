import { Card } from "@/components/admin/ui";
import type { WhatChanges } from "@/lib/theme-changes";

/**
 * *What changes* (D244): what switching to an installed theme does to the store's own pages, as sentences written in code from facts
 * (`whatChanges()`). It says nothing of colours or taste: the preview shows those.
 */
export function ThemeChanges({ live, target, changes }: { live: string; target: string; changes: WhatChanges }) {
  return (
    <Card
      title="What changes"
      description={
        <>
          What switching from “{live}” to “{target}” does to your pages and articles. Colours, fonts and spacing are best seen in the preview.
        </>
      }
      compact
    >
      {changes.lines.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-ink-2">
          {changes.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-2">Your layouts stay the same, your pages name no section style, and nothing on them is your own: they take “{target}” as it is.</p>
      )}
    </Card>
  );
}
