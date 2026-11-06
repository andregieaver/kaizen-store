import { normaliseEmail } from "./email-address";

/**
 * A leads inbox (S4 of `docs/own-books-and-sales.md`, D475), pure: people who asked a store for something but are not its customers yet,
 * one row a person. Read where the requests are (`src/server/leads.ts`); here they are grouped, and those already dealt with left out.
 */

export const LEAD_KINDS = ["quote", "question", "chat", "subscriber"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

/** How far back the inbox looks. */
export const LEAD_WINDOW_DAYS = 90;
/** The most people the inbox lists. */
export const LEADS_MAX = 100;

/** One request: a quote asked for, a question or a form, a chat, a subscription. */
export type LeadItem = { kind: LeadKind; id: string; at: string; excerpt: string | null };

/** A request as read, with whose it is and what is known of them. */
export type LeadSourceRow = LeadItem & {
  email: string;
  name: string | null;
  /** They have paid for an order in the store: a customer, not a lead. */
  customer: boolean;
  /** An open deal is about them already. */
  inDeal: boolean;
  /** When staff last decided about them (dismissed, or made a deal), if ever. */
  decidedAt: string | null;
};

/** A person in the inbox: their requests since the last decision about them, newest first. */
export type Lead = { email: string; name: string | null; latest: string; items: LeadItem[] };

/**
 * The inbox: one lead a person, the newest first; a person who is a customer or in an open deal is left out, and a request made before the
 * last decision about its person is left out too, so a person dismissed comes back only by asking for something again.
 */
export function leadsFrom(rows: readonly LeadSourceRow[], max = LEADS_MAX): Lead[] {
  const people = new Map<string, Lead>();
  for (const row of rows) {
    const email = normaliseEmail(row.email);
    if (!email || row.customer || row.inDeal) continue;
    if (row.decidedAt && row.at <= row.decidedAt) continue;
    const lead = people.get(email) ?? { email, name: null, latest: row.at, items: [] };
    lead.items.push({ kind: row.kind, id: row.id, at: row.at, excerpt: row.excerpt?.trim() || null });
    if (!lead.name && row.name?.trim()) lead.name = row.name.trim();
    if (row.at > lead.latest) lead.latest = row.at;
    people.set(email, lead);
  }
  const leads = [...people.values()];
  for (const lead of leads) lead.items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return leads.sort((a, b) => b.latest.localeCompare(a.latest) || a.email.localeCompare(b.email)).slice(0, max);
}

/** The deal a lead becomes: named after the person and what they asked for last, as "Kari Nordmann: quote request". */
export function leadDealTitle(lead: Lead, kinds: Record<LeadKind, string>): string {
  const who = lead.name || lead.email;
  const what = lead.items[0] ? kinds[lead.items[0].kind] : null;
  return (what ? `${who}: ${what}` : who).slice(0, 200);
}
