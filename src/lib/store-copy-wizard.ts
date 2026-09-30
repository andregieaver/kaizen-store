import {
  COPY_IDS_MAX,
  COPY_NAME_MAX,
  storeCopyInput,
  type CopyChoices,
  type CopySelection,
  type StoreCopyInput,
  type StoreCopyOptions,
} from "./store-copy";
import { slugProblem, suggestSlug } from "./slug";

/**
 * The duplicate-a-store wizard's own rules (D129), pure so the browser and the tests share them: what is chosen, what
 * is wrong with it, the sentence that sums it up and the input sent to the server (which checks everything again).
 */

export type CopyKind = "pages" | "products" | "posts";
export const COPY_KINDS: readonly CopyKind[] = ["pages", "products", "posts"];
export type CopyMode = "none" | "all" | "selected";

export type WizardState = {
  name: string;
  slug: string;
  options: StoreCopyOptions;
  /** The ids ticked in each list, kept when the choice moves to All or None and back. */
  picked: Record<CopyKind, string[]>;
};

/** What is never copied, in plain words (the contract in `store-copy.ts`). */
export const NEVER_COPIED: readonly string[] = [
  "The payment connection and any payment keys: the new store connects its own",
  "Domains: the new store starts at its own address",
  "Integrations, such as email, Slack and other connected services",
  "Invoices and their numbering",
  "Billing and the plan: the new store chooses its own",
  "Team members: you are the new store's owner",
  "Work data: clients, assignments, time and invoices",
  "Logs and cookie consents",
  "Customers' subscriptions and subscription box lists, so nobody is billed or delivered to twice",
];

/** How many rows a checklist draws before "Show more": long lists stay light. */
export const LIST_STEP = 100;

export const KIND_WORDS: Record<CopyKind, { one: string; many: string; title: string }> = {
  pages: { one: "page", many: "pages", title: "Pages" },
  products: { one: "product", many: "products", title: "Products" },
  posts: { one: "post", many: "posts", title: "Posts" },
};

const plural = (n: number, kind: CopyKind) =>
  `${n.toLocaleString("en")} ${n === 1 ? KIND_WORDS[kind].one : KIND_WORDS[kind].many}`;
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The wizard as it opens: everything but people and orders, named "Copy of {store}". */
export function initialWizard(sourceName: string): WizardState {
  return {
    name: `Copy of ${sourceName}`.slice(0, COPY_NAME_MAX).trim(),
    slug: "",
    options: {
      pages: { mode: "all" },
      products: { mode: "all" },
      posts: { mode: "all" },
      customers: false,
      orders: false,
      confirmDataUse: false,
    },
    picked: { pages: [], products: [], posts: [] },
  };
}

const selectionOf = (mode: CopyMode, ids: string[]): CopySelection => (mode === "selected" ? { mode, ids } : { mode });

/** Moves a kind to none, all or the ticked ones. */
export function setMode(state: WizardState, kind: CopyKind, mode: CopyMode): WizardState {
  return { ...state, options: { ...state.options, [kind]: selectionOf(mode, state.picked[kind]) } };
}

function setPicked(state: WizardState, kind: CopyKind, ids: string[]): WizardState {
  const options =
    state.options[kind].mode === "selected"
      ? { ...state.options, [kind]: selectionOf("selected", ids) }
      : state.options;
  return { ...state, options, picked: { ...state.picked, [kind]: ids } };
}

/** Ticks or unticks one row. */
export function toggleId(state: WizardState, kind: CopyKind, id: string, on: boolean): WizardState {
  const rest = state.picked[kind].filter((picked) => picked !== id);
  return setPicked(state, kind, on ? [...rest, id] : rest);
}

/** Ticks these rows too ("Select all shown"), keeping the ones already ticked and never twice. */
export function addIds(state: WizardState, kind: CopyKind, ids: string[]): WizardState {
  const have = new Set(state.picked[kind]);
  return setPicked(state, kind, [...state.picked[kind], ...ids.filter((id) => !have.has(id))]);
}

/** Unticks everything in a list ("Clear"). */
export function clearIds(state: WizardState, kind: CopyKind): WizardState {
  return setPicked(state, kind, []);
}

/** How many of a kind are chosen, of how many there are. */
export const chosenCount = (state: WizardState, kind: CopyKind, total: number): number => {
  const selection = state.options[kind];
  return selection.mode === "all" ? total : selection.mode === "selected" ? Math.min(selection.ids.length, total) : 0;
};

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The rows whose text holds every word typed (any case, accents ignored); all rows for an empty search. */
export function filterRows<T>(rows: readonly T[], query: string, text: (row: T) => string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = fold(text(row));
    return words.every((word) => haystack.includes(word));
  });
}

/** What a page's or post's state is called. */
export const STATE_LABELS: Record<"draft" | "published" | "changed", string> = {
  draft: "Draft",
  published: "Published",
  changed: "Published, changes unpublished",
};

/** A product's status in plain words ("active" is Active). */
export const statusLabel = (status: string): string =>
  status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "";

/** "12 of 40 selected", for the checklist's live count. */
export const selectedLine = (selected: number, total: number): string =>
  `${selected.toLocaleString("en")} of ${total.toLocaleString("en")} selected`;

// ---------------------------------------------------------------------------
// Checking the choices
// ---------------------------------------------------------------------------

/** What is wrong, and which field to send the person to. */
export type WizardProblem = { field: "name" | "slug" | CopyKind | "confirmDataUse"; message: string };

const NOUN: Record<CopyKind, string> = { pages: "page", products: "product", posts: "post" };

export function wizardProblems(state: WizardState): WizardProblem[] {
  const problems: WizardProblem[] = [];
  if (!state.name.trim()) problems.push({ field: "name", message: "Enter a name for the new store." });
  else if (state.name.trim().length > COPY_NAME_MAX)
    problems.push({ field: "name", message: `Use at most ${COPY_NAME_MAX} characters in the name.` });
  const slug = state.slug.trim().toLowerCase();
  if (slug) {
    const problem = slugProblem(slug);
    if (problem) problems.push({ field: "slug", message: `Store address: ${problem}` });
  } else if (state.name.trim() && !suggestSlug(state.name)) {
    problems.push({ field: "slug", message: "Enter a store address: the name gives none." });
  }
  for (const kind of COPY_KINDS) {
    const selection = state.options[kind];
    if (selection.mode !== "selected") continue;
    if (selection.ids.length === 0) {
      problems.push({ field: kind, message: `Tick at least one ${NOUN[kind]}, or choose All or None.` });
    } else if (selection.ids.length > COPY_IDS_MAX) {
      problems.push({
        field: kind,
        message: `Tick at most ${COPY_IDS_MAX.toLocaleString("en")} ${KIND_WORDS[kind].many}, or choose All.`,
      });
    }
  }
  if ((state.options.customers || state.options.orders) && !state.options.confirmDataUse) {
    problems.push({
      field: "confirmDataUse",
      message: "Confirm that you may use this customer data in the new store.",
    });
  }
  return problems;
}

/** Whether the customer data confirmation is asked for. */
export const needsDataConfirmation = (options: StoreCopyOptions): boolean => options.customers || options.orders;

/** The address the new store gets: the one typed, else one made from the name ("" when none can be made). */
export function effectiveSlug(state: Pick<WizardState, "name" | "slug">): string {
  return state.slug.trim().toLowerCase() || suggestSlug(state.name);
}

// ---------------------------------------------------------------------------
// The summary and the input
// ---------------------------------------------------------------------------

/** One sentence on what will be copied, from the choices. */
export function summarySentence(
  state: WizardState,
  choices: Pick<CopyChoices, "pages" | "products" | "posts" | "customers" | "orders">,
): string {
  const parts: string[] = [];
  for (const kind of COPY_KINDS) {
    const total = choices[kind].length;
    const selection = state.options[kind];
    if (selection.mode === "all" && total > 0)
      parts.push(total === 1 ? plural(total, kind) : `all ${plural(total, kind)}`);
    else if (selection.mode === "selected") {
      const n = chosenCount(state, kind, total);
      if (n > 0) parts.push(`${n.toLocaleString("en")} of ${plural(total, kind)}`);
    }
  }
  if (state.options.customers && choices.customers > 0) parts.push(count(choices.customers, "customer", "customers"));
  if (state.options.orders && choices.orders > 0)
    parts.push(`${count(choices.orders, "order", "orders")} as read-only history`);
  if (parts.length === 0) return "Copies the store's settings only.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Copies the store's settings, plus ${list}.`;
}

/** The input the server takes, from what is chosen. */
export function buildInput(source: string, state: WizardState): StoreCopyInput {
  const sure = needsDataConfirmation(state.options);
  return {
    source,
    name: state.name.trim(),
    slug: state.slug.trim().toLowerCase(),
    options: { ...state.options, confirmDataUse: sure && state.options.confirmDataUse },
  };
}

/** Whether the server's own check accepts this (a last look before sending). */
export const inputIsValid = (input: StoreCopyInput): boolean => storeCopyInput.safeParse(input).success;
