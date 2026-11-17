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

/**
 * Where a request is kept, which its link opens (ecosystem plan E2.8, D713): a quote request's draft, a form's responses, a conversation in
 * the support inbox (a chat, or a form's message kept there), a subscriber.
 */
export const LEAD_SOURCES = ["draft", "form", "conversation", "subscriber"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * One request: a quote asked for, a question or a form, a chat, a subscription. `sourceId` is the record its link opens: the request itself,
 * but for a form's response, whose form it is.
 */
export type LeadItem = { kind: LeadKind; id: string; at: string; excerpt: string | null; source: LeadSource; sourceId: string };

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
    lead.items.push({ kind: row.kind, id: row.id, at: row.at, excerpt: row.excerpt?.trim() || null, source: row.source, sourceId: row.sourceId });
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

/**
 * The page each source opens on, after the store's admin address, as the admin map writes it: what the permissions and the features are
 * asked of once a list, never once a row.
 */
export const LEAD_SOURCE_PAGES: Record<LeadSource, string> = {
  draft: "/orders/drafts/[draftId]",
  form: "/forms/responses/[formId]",
  conversation: "/support",
  subscriber: "/subscribers/[subscriberId]",
};

/** Where a request's link goes, after the store's admin address: the draft, the form's responses, the conversation, the subscriber. */
export function leadSourcePath(item: Pick<LeadItem, "source" | "sourceId">): string {
  const id = encodeURIComponent(item.sourceId);
  switch (item.source) {
    case "draft":
      return `/orders/drafts/${id}`;
    case "form":
      return `/forms/responses/${id}`;
    case "conversation":
      return `/support?c=${id}`;
    case "subscriber":
      return `/subscribers/${id}`;
  }
}

/**
 * A lead's requests as its row shows them (ecosystem plan E2.8, D713): one a kind, in the order the newest of each came (the items are newest
 * first), linked to the newest of that kind whose page the viewer may open (`open`, by source); not linked where they may open none.
 */
export function leadKindLinks(lead: Pick<Lead, "items">, base: string, open: Partial<Record<LeadSource, boolean>>): { kind: LeadKind; href: string | null }[] {
  const links = new Map<LeadKind, string | null>();
  for (const item of lead.items) {
    if (links.get(item.kind)) continue;
    links.set(item.kind, open[item.source] ? `${base}${leadSourcePath(item)}` : null);
  }
  return [...links.entries()].map(([kind, href]) => ({ kind, href }));
}
