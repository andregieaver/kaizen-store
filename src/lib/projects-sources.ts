/**
 * Where a checklist task can come from (D904, `docs/projects.md` P8.3a): an order, a return or a review of the shop, or a conversation of the
 * support desk. A pair of the octopus (`docs/extensions.md` 3.1): it shows only while both arms are there, Projects and the source's own (the
 * shop's feature for an order, a return or a review; the AI support desk for a conversation). Pure, so the pages and the server agree.
 */

export const SOURCE_KINDS = ["order", "return", "review", "conversation"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A task's column for each kind (`checklist_items`, at most one set: `checklist_items_one_source`). */
export const SOURCE_COLUMNS: Record<SourceKind, "order_id" | "return_id" | "review_id" | "conversation_id"> = {
  order: "order_id",
  return: "return_id",
  review: "review_id",
  conversation: "conversation_id",
};

/** A source as a task carries it: its kind and its id. */
export type TaskSource = { kind: SourceKind; id: string };

/**
 * What a page's *Tasks* card is about (P4.7): a source, a customer, or a deal whose next steps the tasks are (D910). A customer and a deal are
 * beside a task's source, not among them: a task from an order also names the order's customer, and one made on a deal's page names the
 * deal's, so the customer's page lists it too.
 */
export const LINK_KINDS = [...SOURCE_KINDS, "customer", "deal"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type TaskLink = { kind: LinkKind; id: string };

/** A task's column for each kind of link. */
export const LINK_COLUMNS: Record<LinkKind, (typeof SOURCE_COLUMNS)[SourceKind] | "customer_id" | "deal_id"> = { ...SOURCE_COLUMNS, customer: "customer_id", deal: "deal_id" };

/** The source a task's row names, if any (the row's four columns, at most one set). */
export function sourceOf(row: { order_id: string | null; return_id: string | null; review_id: string | null; conversation_id: string | null }): TaskSource | null {
  for (const kind of SOURCE_KINDS) {
    const id = row[SOURCE_COLUMNS[kind]];
    if (id) return { kind, id };
  }
  return null;
}

/** Where a source opens in the store's admin, after `/admin/{store}`: an order, a return, the reviews list, or the conversation in the inbox. */
export function sourcePath(source: TaskSource): string {
  switch (source.kind) {
    case "order":
      return `/orders/${source.id}`;
    case "return":
      return `/returns/${source.id}`;
    case "review":
      return "/reviews";
    case "conversation":
      return `/support?c=${source.id}`;
  }
}
