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
import { fillWords } from "./admin-fill";
import {
  platformEn,
  type PlatformMessages,
} from "./admin-messages/platform.en";

/** The words the wizard's rules write (D312 A11, `platform.copyWizard.lib`); English unless given. */
export type CopyWizardWords = PlatformMessages["copyWizard"]["lib"];
const EN: CopyWizardWords = platformEn.copyWizard.lib;

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
export const NEVER_COPIED: readonly string[] = EN.neverCopied;

/** How many rows a checklist draws before "Show more": long lists stay light. */
export const LIST_STEP = 100;

export const KIND_WORDS: Record<
  CopyKind,
  { one: string; many: string; title: string }
> = {
  pages: { one: "page", many: "pages", title: "Pages" },
  products: { one: "product", many: "products", title: "Products" },
  posts: { one: "post", many: "posts", title: "Posts" },
};

const count = (
  n: number,
  word: { one: string; many: string },
  locale: string,
) => `${n.toLocaleString(locale)} ${n === 1 ? word.one : word.many}`;

/** The wizard as it opens: everything but people and orders, named "Copy of {store}". */
export function initialWizard(
  sourceName: string,
  words: CopyWizardWords = EN,
): WizardState {
  return {
    name: fillWords(words.copyOf, { name: sourceName })
      .slice(0, COPY_NAME_MAX)
      .trim(),
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

const selectionOf = (mode: CopyMode, ids: string[]): CopySelection =>
  mode === "selected" ? { mode, ids } : { mode };

/** Moves a kind to none, all or the ticked ones. */
export function setMode(
  state: WizardState,
  kind: CopyKind,
  mode: CopyMode,
): WizardState {
  return {
    ...state,
    options: {
      ...state.options,
      [kind]: selectionOf(mode, state.picked[kind]),
    },
  };
}

function setPicked(
  state: WizardState,
  kind: CopyKind,
  ids: string[],
): WizardState {
  const options =
    state.options[kind].mode === "selected"
      ? { ...state.options, [kind]: selectionOf("selected", ids) }
      : state.options;
  return { ...state, options, picked: { ...state.picked, [kind]: ids } };
}

/** Ticks or unticks one row. */
export function toggleId(
  state: WizardState,
  kind: CopyKind,
  id: string,
  on: boolean,
): WizardState {
  const rest = state.picked[kind].filter((picked) => picked !== id);
  return setPicked(state, kind, on ? [...rest, id] : rest);
}

/** Ticks these rows too ("Select all shown"), keeping the ones already ticked and never twice. */
export function addIds(
  state: WizardState,
  kind: CopyKind,
  ids: string[],
): WizardState {
  const have = new Set(state.picked[kind]);
  return setPicked(state, kind, [
    ...state.picked[kind],
    ...ids.filter((id) => !have.has(id)),
  ]);
}

/** Unticks everything in a list ("Clear"). */
export function clearIds(state: WizardState, kind: CopyKind): WizardState {
  return setPicked(state, kind, []);
}

/** How many of a kind are chosen, of how many there are. */
export const chosenCount = (
  state: WizardState,
  kind: CopyKind,
  total: number,
): number => {
  const selection = state.options[kind];
  return selection.mode === "all"
    ? total
    : selection.mode === "selected"
      ? Math.min(selection.ids.length, total)
      : 0;
};

const fold = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The rows whose text holds every word typed (any case, accents ignored); all rows for an empty search. */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  text: (row: T) => string,
): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = fold(text(row));
    return words.every((word) => haystack.includes(word));
  });
}

/** What a page's or post's state is called. */
export const STATE_LABELS: Record<"draft" | "published" | "changed", string> =
  EN.states;

/** A product's status in plain words ("active" is Active). */
export const statusLabel = (
  status: string,
  words: CopyWizardWords = EN,
): string =>
  words.productStatuses[status] ??
  (status
    ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")
    : "");

/** "12 of 40 selected", for the checklist's live count. */
export const selectedLine = (
  selected: number,
  total: number,
  words: CopyWizardWords = EN,
  locale = "en",
): string =>
  fillWords(words.selected, {
    selected: selected.toLocaleString(locale),
    total: total.toLocaleString(locale),
  });

// ---------------------------------------------------------------------------
// Checking the choices
// ---------------------------------------------------------------------------

/** What is wrong, and which field to send the person to. */
export type WizardProblem = {
  field: "name" | "slug" | CopyKind | "confirmDataUse";
  message: string;
};

export function wizardProblems(
  state: WizardState,
  words: CopyWizardWords = EN,
  locale = "en",
): WizardProblem[] {
  const w = words.problems;
  const problems: WizardProblem[] = [];
  if (!state.name.trim()) problems.push({ field: "name", message: w.noName });
  else if (state.name.trim().length > COPY_NAME_MAX)
    problems.push({
      field: "name",
      message: fillWords(w.nameTooLong, { max: String(COPY_NAME_MAX) }),
    });
  const slug = state.slug.trim().toLowerCase();
  if (slug) {
    const problem = slugProblem(slug);
    if (problem)
      problems.push({
        field: "slug",
        message: fillWords(w.slug, {
          problem: words.slugProblems[problem] ?? problem,
        }),
      });
  } else if (state.name.trim() && !suggestSlug(state.name)) {
    problems.push({ field: "slug", message: w.noSlug });
  }
  for (const kind of COPY_KINDS) {
    const selection = state.options[kind];
    if (selection.mode !== "selected") continue;
    if (selection.ids.length === 0) {
      problems.push({
        field: kind,
        message: fillWords(w.tickOne, { one: words.kinds[kind].one }),
      });
    } else if (selection.ids.length > COPY_IDS_MAX) {
      problems.push({
        field: kind,
        message: fillWords(w.tickAtMost, {
          max: COPY_IDS_MAX.toLocaleString(locale),
          many: words.kinds[kind].many,
        }),
      });
    }
  }
  if (
    (state.options.customers || state.options.orders) &&
    !state.options.confirmDataUse
  ) {
    problems.push({
      field: "confirmDataUse",
      message: w.confirm,
    });
  }
  return problems;
}

/** Whether the customer data confirmation is asked for. */
export const needsDataConfirmation = (options: StoreCopyOptions): boolean =>
  options.customers || options.orders;

/** The address the new store gets: the one typed, else one made from the name ("" when none can be made). */
export function effectiveSlug(
  state: Pick<WizardState, "name" | "slug">,
): string {
  return state.slug.trim().toLowerCase() || suggestSlug(state.name);
}

// ---------------------------------------------------------------------------
// The summary and the input
// ---------------------------------------------------------------------------

/** One sentence on what will be copied, from the choices. */
export function summarySentence(
  state: WizardState,
  choices: Pick<
    CopyChoices,
    "pages" | "products" | "posts" | "customers" | "orders"
  >,
  words: CopyWizardWords = EN,
  locale = "en",
): string {
  const w = words.summary;
  const plural = (n: number, kind: CopyKind) =>
    count(n, words.kinds[kind], locale);
  const parts: string[] = [];
  for (const kind of COPY_KINDS) {
    const total = choices[kind].length;
    const selection = state.options[kind];
    if (selection.mode === "all" && total > 0)
      parts.push(
        total === 1
          ? plural(total, kind)
          : fillWords(w.all, { count: plural(total, kind) }),
      );
    else if (selection.mode === "selected") {
      const n = chosenCount(state, kind, total);
      if (n > 0)
        parts.push(
          fillWords(w.some, {
            n: n.toLocaleString(locale),
            count: plural(total, kind),
          }),
        );
    }
  }
  if (state.options.customers && choices.customers > 0)
    parts.push(count(choices.customers, words.customers, locale));
  if (state.options.orders && choices.orders > 0)
    parts.push(
      fillWords(w.history, {
        count: count(choices.orders, words.orders, locale),
      }),
    );
  if (parts.length === 0) return w.only;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} ${w.and} ${parts[parts.length - 1]}`;
  return fillWords(w.plus, { list });
}

/** The input the server takes, from what is chosen. */
export function buildInput(source: string, state: WizardState): StoreCopyInput {
  const sure = needsDataConfirmation(state.options);
  return {
    source,
    name: state.name.trim(),
    slug: state.slug.trim().toLowerCase(),
    options: {
      ...state.options,
      confirmDataUse: sure && state.options.confirmDataUse,
    },
  };
}

/** Whether the server's own check accepts this (a last look before sending). */
export const inputIsValid = (input: StoreCopyInput): boolean =>
  storeCopyInput.safeParse(input).success;
