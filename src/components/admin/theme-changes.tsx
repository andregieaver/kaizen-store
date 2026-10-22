import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { WhatChanges } from "@/lib/theme-changes";

/**
 * *What changes* (D244): what switching to an installed theme does to the store's own pages, as sentences written in code from facts
 * (`whatChanges()`, given the same language's words by the page). It says nothing of colours or taste: the preview shows those.
 */
export function ThemeChanges({ live, target, changes, lang = "en" }: { live: string; target: string; changes: WhatChanges; lang?: AdminLang }) {
  const w = adminText(lang, "design").changes;
  return (
    <Card title={w.title} description={fillWords(w.description, { live, target })} compact>
      {changes.lines.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-ink-2">
          {changes.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-2">{fillWords(w.nothing, { target })}</p>
      )}
    </Card>
  );
}
