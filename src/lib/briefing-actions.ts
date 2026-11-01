/**
 * The briefing's one-press actions (D416): each finding of the briefing, by email or on the store's home page, names the one thing to do
 * about it, and its link opens a page with that work prepared, never done. Stock running out opens a purchase order filled in from what sells
 * and what is left (*Prepare reorder*); customers coming back opens a thank-you broadcast (*Create campaign*); a change in the figures opens
 * the AI manager with the finding's words and figures written in (*Ask the AI manager*); the rest open their page as before. A link only
 * opens a page, as a mail program may follow links by itself: the draft is made, and the message sent, by the person's own press there.
 */

export type BriefingActionKind = "reorder" | "campaign" | "ask" | "open";
export type BriefingAction = { kind: BriefingActionKind; href: string };

/** The page that prepares a purchase order from what is running out (`?reorder=1` on Purchase orders). */
export const REORDER_PATH = "/inventory/purchase-orders?reorder=1";
/** A broadcast started from the thank-you template, for customers coming back. */
export const CAMPAIGN_PATH = "/broadcasts/new?from=thanks";

/** Alerts whose answer is to ask why: a change in the figures, which the AI manager reads with its tools. */
const ASK_ALERTS: ReadonlySet<string> = new Set(["conversion-drop", "revenue-weekday", "refund-rate", "cac-up", "checkout-abandonment", "discount-creep", "target-behind"]);

/** The home page with the AI manager opened on this alert: `?ask={id}` after the store's admin address. */
export const askPath = (alertId: string) => `?ask=${encodeURIComponent(alertId)}`;

/** What to do about an analytics alert, by its rule's id; else its own page. */
export function alertAction(alert: { id: string; href: string }): BriefingAction {
  if (alert.id === "stockout") return { kind: "reorder", href: REORDER_PATH };
  if (alert.id === "returning-high") return { kind: "campaign", href: CAMPAIGN_PATH };
  if (ASK_ALERTS.has(alert.id)) return { kind: "ask", href: askPath(alert.id) };
  return { kind: "open", href: alert.href.startsWith("/") ? alert.href : `/${alert.href}` };
}

/** What to do about a store checkup finding: stock to reorder opens the prepared purchase order; the rest their page. */
export function checkupAction(finding: { key: string; page: string }): BriefingAction {
  if (finding.key === "restock" || finding.key === "stock_low") return { kind: "reorder", href: REORDER_PATH };
  return { kind: "open", href: finding.page.startsWith("/") ? finding.page : `/${finding.page}` };
}

/** An alert id as it may come back in an address: one of the rules' own ids (letters, digits and hyphens), else null. */
export function askedAlert(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
}
