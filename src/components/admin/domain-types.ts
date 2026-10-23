import type { SearchAnswer } from "@/lib/domain-search";

import type { FormState } from "./action-form";

/** A form's server action, as the domain cards take them (D315). */
export type DomainAction = (state: FormState, form: FormData) => Promise<FormState>;

/** The page's search for names to buy (D315 4.2). */
export type DomainSearch = (query: string) => Promise<SearchAnswer>;
