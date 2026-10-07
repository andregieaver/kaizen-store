/**
 * Store templates (D175, `docs/store-templates.md`): starting points for new stores, each a real store marked `starter` and described by
 * a row of `commerce.store_starters`. Called "starters" in code so they are never confused with the page builder's templates (D125) and
 * page layouts (D127); "Store templates" in the interface. Pure: shared by the platform's pages, the owner's and the sign-up form, and
 * the tests.
 */

export const STARTER_CATEGORIES = ["appointments", "retail", "downloads", "rentals_stays", "subscriptions", "services", "other"] as const;
export type StarterCategory = (typeof STARTER_CATEGORIES)[number];

export const STARTER_CATEGORY_LABELS: Record<StarterCategory, string> = {
  appointments: "Appointments",
  retail: "Retail",
  downloads: "Digital downloads",
  rentals_stays: "Rentals and stays",
  subscriptions: "Subscriptions",
  services: "Services",
  other: "Other",
};

export const isStarterCategory = (value: unknown): value is StarterCategory =>
  typeof value === "string" && (STARTER_CATEGORIES as readonly string[]).includes(value);

/** The limits the database's checks hold too (`store_starters_*`). */
export const STARTER_LIMITS = { title: 80, summary: 200, description: 2000, pictureUrl: 2000 } as const;

/** A store template as owners and the sign-up form see it: what the card shows and where its preview is. */
export type OfferedStarter = {
  /** `store_starters.id`: what a form sends, never a store id. */
  id: string;
  title: string;
  summary: string;
  /** Longer, plain text: shown under the card on request. */
  description: string;
  category: StarterCategory;
  pictureUrl: string | null;
  /** The template's store, whose storefront is the preview. */
  storeSlug: string;
};

/** A store template as the platform admin sees it. */
export type StarterRow = OfferedStarter & {
  published: boolean;
  position: number;
  storeId: string;
  storeName: string;
  /** Stores made from it so far (`stores.made_from_starter`). */
  storesMade: number;
  updatedAt: string;
};

/** A card to choose: a store template, or the Standard store (`id` empty). */
export type StarterCard = Pick<OfferedStarter, "title" | "summary" | "description" | "pictureUrl"> & {
  /** What the form sends: a starter's id, or "" for the Standard store. */
  id: string;
  category: OfferedStarter["category"] | null;
  /** The template's storefront, opened in a new window; null when there is none to show. */
  previewHref: string | null;
};

/** The Standard store's card: the default template, offered first (D175). */
export function standardCard(previewHref: string | null): StarterCard {
  return {
    id: "",
    title: "Standard store",
    summary: "Kaizen's demo store: a few demo products of every kind, the usual pages and settings. Change everything after.",
    description: "",
    category: null,
    pictureUrl: null,
    previewHref,
  };
}

export type StarterDetails = {
  title: string;
  summary: string;
  description: string;
  category: StarterCategory;
  pictureUrl: string | null;
};

/** A picture's address a template may carry: on the site (`/…`, not `//…`) or https. */
export function isStarterPicture(value: string): boolean {
  if (value.length > STARTER_LIMITS.pictureUrl) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !/[\s\\]/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Reads a template's details from a form, or says what is wrong with them, in plain words. */
export function parseStarterDetails(form: {
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  category?: unknown;
  pictureUrl?: unknown;
}): { ok: true; details: StarterDetails } | { ok: false; problems: string[] } {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const title = text(form.title);
  const summary = text(form.summary);
  // Plain text: line breaks are kept, other control characters are not.
  const description = Array.from(text(form.description).replace(/\r\n?/g, "\n"))
    .filter((c) => c === "\n" || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
    .join("");
  const picture = text(form.pictureUrl);
  const problems: string[] = [];
  if (!title) problems.push("Enter a title.");
  else if (title.length > STARTER_LIMITS.title) problems.push(`Keep the title under ${STARTER_LIMITS.title + 1} characters.`);
  if (summary.length > STARTER_LIMITS.summary) problems.push(`Keep the summary under ${STARTER_LIMITS.summary + 1} characters.`);
  if (description.length > STARTER_LIMITS.description) problems.push(`Keep the description under ${STARTER_LIMITS.description + 1} characters.`);
  if (!isStarterCategory(form.category)) problems.push("Choose a category.");
  if (picture && !isStarterPicture(picture)) problems.push("The picture's address must start with https:// or be a path on this site.");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, details: { title, summary, description, category: form.category as StarterCategory, pictureUrl: picture || null } };
}

/**
 * What a form's choice of template is: a starter's id (a UUID), or null for the Standard store. Anything else is null too, and the
 * server decides again (`commerce.starter_source()`), so a value that is not a published starter never chooses a store.
 */
export function starterChoice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** The new order of templates after moving one up or down: their ids in order, or null when it cannot move that way. */
export function movedOrder(ids: readonly string[], id: string, direction: "up" | "down"): string[] | null {
  const at = ids.indexOf(id);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The plain words for a refusal of the database's starter rules, or null when the error is not one of them. */
export function starterRefusal(text: string): string | null {
  if (text.includes("store_starters.not_offered")) return "That store template is not offered any more. Choose another.";
  if (text.includes("there is no template store")) return "There is no template store to copy.";
  if (text.includes("stores.starter_has_sales")) return "A store that has sold or has customers cannot become a store template.";
  if (text.includes("stores.starter_fixed")) return "A store template stays a store template.";
  if (text.includes("store_starters.not_starter")) return "Only a store made as a store template can be described as one.";
  return null;
}
