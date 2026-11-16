import { fillWords } from "./admin-fill";
import type { BuilderMessages } from "./admin-messages/builder.en";
import type { PageDifference } from "./version-compare";

/**
 * One difference between two versions of a page in words (D358), from `compareVersions()`: the versions dialogs, an A/B test's page
 * ("What is different", D655) and the AI manager's `explain_results` say them the same way. Pure: the words are the caller's language.
 */
export function differenceLine(d: PageDifference, words: Pick<BuilderMessages, "differences" | "blockNames">): string {
  const w = words.differences;
  const name = (type: string) => ((words.blockNames as Record<string, string>)[type] ?? type).toLowerCase();
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
}
