"use client";

import { fillWords } from "@/lib/admin-fill";
import type { PageDifference } from "@/lib/version-compare";

import { useAdminText } from "./admin-text";

/** The differences between two versions of a page in words (D358), one line each, from `compareVersions()`. */
export function VersionDifferences({ differences }: { differences: PageDifference[] }) {
  const all = useAdminText("builder");
  const w = all.differences;
  const name = (type: string) => ((all.blockNames as Record<string, string>)[type] ?? type).toLowerCase();
  if (differences.length === 0) return <p className="text-sm text-muted">{w.none}</p>;
  const line = (d: PageDifference): string => {
    switch (d.kind) {
      case "field":
        return w.fields[d.field];
      case "text":
        if (!d.before) return fillWords(w.textAdded, { label: d.label, after: d.after });
        if (!d.after) return fillWords(w.textRemoved, { label: d.label, before: d.before });
        return fillWords(w.text, { label: d.label, before: d.before, after: d.after });
      case "row_added":
        return fillWords(w.rowAdded, { row: d.row });
      case "row_removed":
        return fillWords(w.rowRemoved, { row: d.row });
      case "row_moved":
        return fillWords(w.rowMoved, { from: d.from, to: d.to });
      case "block_added":
        return fillWords(w.blockAdded, { block: name(d.block), row: d.row });
      case "block_removed":
        return fillWords(w.blockRemoved, { block: name(d.block), row: d.row });
      case "settings":
        return d.part === "row"
          ? fillWords(w.settingsRow, { row: d.row })
          : d.part === "column"
            ? fillWords(w.settingsColumn, { row: d.row })
            : fillWords(w.settingsBlock, { block: name(d.block ?? ""), row: d.row });
    }
  };
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-version-differences>
      {differences.map((d, i) => (
        <li key={i} className="break-words">
          {line(d)}
        </li>
      ))}
    </ul>
  );
}
