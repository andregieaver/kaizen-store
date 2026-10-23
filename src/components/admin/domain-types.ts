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
