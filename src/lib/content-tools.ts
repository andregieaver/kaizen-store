/**
 * What the AI manager's content tools (wave 6 unit H3, D326) say that needs no database: the words of a change kept for the owner's yes,
 * from its arguments. The server puts the entry's or type's own name in where it can (`contentApprovalWords()`).
 */

export const CONTENT_TOOLS = [
  "list_content_types",
  "list_entries",
  "get_entry",
  "save_entry",
  "publish_entry",
  "unpublish_entry",
  "save_content_type",
] as const;

/** What a kept content change will do, from its arguments; `title` is the entry's or type's own name when the server knows it. */
export function contentApprovalSummary(name: string, input: Record<string, unknown>, title?: string): string {
  const text = (key: string) => String(input[key] ?? "");
  const entry = title ? `"${title}"` : `the entry ${text("entry")}`;
  if (name === "publish_entry") return `Publish ${entry} on the site as its draft is now.`;
  if (name === "unpublish_entry") return `Take ${entry} off the site, keeping its draft.`;
  if (name === "save_content_type") {
    const fields = Array.isArray(input.fields) ? (input.fields as { label?: unknown; access?: unknown }[]) : [];
    const list = fields.map((f) => `${String(f.label)}${f.access === "private" ? " (staff only)" : ""}`).join(", ");
    const pages = input.has_pages === true ? ", each entry with a page of its own" : input.has_pages === false ? ", with no pages for its entries" : "";
    return input.type
      ? `Change the content type "${title ?? text("type")}"${list ? `: add ${list}` : ""}${pages}.`
      : `Make the content type "${text("name")}"${list ? ` with ${list}` : ""}${pages}.`;
  }
  return "";
}
