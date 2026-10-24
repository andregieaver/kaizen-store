import type { SearchAnswer } from "@/lib/domain-search";

import type { FormState } from "./action-form";

/** A form's server action, as the domain cards take them (D315). */
export type DomainAction = (state: FormState, form: FormData) => Promise<FormState>;

/** The page's search for names to buy (D315 4.2). */
export type DomainSearch = (query: string) => Promise<SearchAnswer>;

/** A DNS change being drafted on the Domains page (D315 5): records pasted and records ticked to remove, or a recipe with its values. */
export type DnsDraftShape =
  | { kind: "records"; add: string; remove: string[] }
  | { kind: "recipe"; recipe: import("@/lib/dns-recipes").RecipeId; values: Record<string, string> };

/** What a checked change does, or why it can't be made. */
export type DnsCheckShape = { ok: true; effects: string[]; lines: string[]; rev: string; touchesEmail: boolean } | { ok: false; problems: string[] };

export type DnsCheckFn = (apex: string, draft: DnsDraftShape) => Promise<DnsCheckShape>;
export type DnsApply = (apex: string, draft: DnsDraftShape, rev: string) => Promise<FormState>;

/** Moving a domain away (D315 8): what the new nameservers answer, the transfer code (to the page only), and the plain steps. */
export type SwitchCheckShape = { ok: true; ready: boolean; missing: string[]; unanswered: string[] } | { ok: false; problems: string[] };
export type RevealShape = { ok: true; code: string } | { ok: false; problems: string[]; signIn?: boolean };
export type MoveActions = {
  check: (nameservers: string) => Promise<SwitchCheckShape>;
  switch: DomainAction;
  switchBack: () => Promise<FormState>;
  reveal: () => Promise<RevealShape>;
  stay: () => Promise<FormState>;
  disconnect: () => Promise<FormState>;
  signInAgain: () => Promise<void>;
};

/** Bringing a domain here (D315 phase 6): the price of a transfer, and what moving the DNS here would copy. */
export type TransferQuoteShape = { ok: true; domain: string; currency: string; amountMinor: number } | { ok: false; problems: string[] };
export type MoveInRecordShape = { key: string; line: string; from: "file" | "probe"; live: boolean | null };
export type MoveInLookShape =
  | { ok: true; domain: string; nameservers: string[]; registrar: string | null; found: MoveInRecordShape[]; kept: string[]; problems: string[]; skipped: string[]; registeredHere: boolean }
  | { ok: false; problems: string[] };
export type MoveInStartShape = { ok: true; domain: string; nameservers: string[]; missing: string[]; unanswered: string[]; pointed: boolean } | { ok: false; problems: string[] };
export type MoveInActions = {
  quote: (domain: string) => Promise<TransferQuoteShape>;
  transfer: DomainAction;
  look: (domain: string, zoneText: string) => Promise<MoveInLookShape>;
  start: (domain: string, zoneText: string, keys: string[], pointHere: boolean) => Promise<MoveInStartShape>;
  stop: (domain: string) => Promise<FormState>;
};

/** A price for a buyer without a store (D317 6): what the button names (`agreed`, without VAT) and what they pay with VAT. */
export type CheckoutQuote =
  | { ok: true; domain: string; currency: string; amountMinor: number; vatKind: "mva" | "reverse_charge" | "outside_scope"; ratePercent: number; vatMinor: number; totalMinor: number }
  | { ok: false; problems: string[] };
export type CheckoutBuyer = { kind: "consumer" | "business"; country: string; vatNumber: string };
export type CheckoutActions = { search: DomainSearch; quote: (domain: string, buyer: CheckoutBuyer) => Promise<CheckoutQuote>; buy: DomainAction };

/** The holder's assistant on Your domains (D317 phase 5): the tab's conversation, and the DNS changes it proposes for a yes. */
export type HolderChatMessage = { role: "user" | "assistant"; content: string };
export type HolderProposalShape = { token: string; domain: string; summary: string; lines: string[]; touchesEmail: boolean };
export type HolderActions = {
  ask: (history: HolderChatMessage[], message: string) => Promise<{ ok: true; reply: string; proposals: HolderProposalShape[] } | { ok: false; problem: string }>;
  confirm: (token: string) => Promise<FormState>;
};
