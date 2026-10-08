/**
 * Store templates (D175, `docs/store-templates.md`): starting points for new stores, each a real store marked `starter` and described by
 * a row of `commerce.store_starters`. Called "starters" in code so they are never confused with the page builder's templates (D125) and
 * page layouts (D127); "Store templates" in the interface. Pure: shared by the platform's pages, the owner's and the sign-up form, and
 * the tests.
 */

import { featureSummary } from "./onboarding";
import { NEW_STORE_FEATURES } from "./store-features";

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
  /** What a store made from it starts with switched on (D178 step 6): the features its store keeps (`stores.features`). */
  features: string[];
};

/**
 * A store template as the platform admin sees it. Its `OfferedStarter` fields are the **published** details (what owners see); `draft` is
 * what was saved since (D177), shown to the admin in their place. `storeSlug` is its working store, `publishedSlug` the frozen copy owners
 * preview and new stores are made from.
 */
export type StarterRow = OfferedStarter & {
  published: boolean;
  position: number;
  storeId: string;
  storeName: string;
  /** Stores made from it so far (`stores.made_from_starter`). */
  storesMade: number;
  /** Access requests that name it (D177): with stores made, what keeps it from being deleted. */
  requests: number;
  /** The design profile offered first for a store made from it (D176), or null: the published choice. */
  recommendedDesign: string | null;
  /** Details saved but not published (D177), or null. */
  draft: StarterDetails | null;
  /** What the frozen copy keeps switched on (D178 step 6): what stores made from it get now; null before it was published under D177. */
  publishedFeatures: string[] | null;
  /** The frozen copy's address (D177), or null when it was not published under D177 yet. */
  publishedSlug: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  /** Its working store changed since the last Publish, as its activity log tells (an estimate: not every change is logged). */
  changedInStore: boolean;
  updatedAt: string;
};

/** A card to choose: a store template, or the Standard store (`id` empty). */
export type StarterCard = Pick<OfferedStarter, "title" | "summary" | "description" | "pictureUrl"> & {
  /** What the form sends: a starter's id, or "" for the Standard store. */
  id: string;
  category: OfferedStarter["category"] | null;
  /** The template's storefront, opened in a new window; null when there is none to show. */
  previewHref: string | null;
  /** What it switches on, in a few words (`featureSummary()`, D178 step 6). */
  featureWords?: string | null;
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
    // A store from the default template starts with the online shop alone (D178).
    featureWords: featureSummary(NEW_STORE_FEATURES),
  };
}

export type StarterDetails = {
  title: string;
  summary: string;
  description: string;
  category: StarterCategory;
  pictureUrl: string | null;
  /** The design profile (D176) offered first for a store made from it; part of the details since D177, published with them. */
  recommendedDesign?: string | null;
};

/** A saved draft of a template's details (`store_starters.draft`), or null when it cannot be read. */
export function readStarterDraft(value: unknown): StarterDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const parsed = parseStarterDetails({ ...draft, recommendedDesign: draft.recommendedDesign ?? "" });
  return parsed.ok ? parsed.details : null;
}

/** Whether two sets of details are the same (a draft equal to what is published is no draft). */
export const sameStarterDetails = (a: StarterDetails, b: StarterDetails): boolean =>
  a.title === b.title &&
  a.summary === b.summary &&
  a.description === b.description &&
  a.category === b.category &&
  (a.pictureUrl ?? null) === (b.pictureUrl ?? null) &&
  (a.recommendedDesign ?? null) === (b.recommendedDesign ?? null);

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
  /** The recommended design profile's id (D176); left out when the form has no such field. */
  recommendedDesign?: unknown;
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
  const details: StarterDetails = { title, summary, description, category: form.category as StarterCategory, pictureUrl: picture || null };
  if (form.recommendedDesign !== undefined) details.recommendedDesign = starterChoice(form.recommendedDesign);
  return { ok: true, details };
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
  if (text.includes("store_starters.used")) return "Stores were made from this store template, so it cannot be deleted. Archive it instead.";
  if (text.includes("store_starters.requested")) return "An access request chose this store template, so it cannot be deleted. Archive it instead.";
  if (text.includes("store_starters.archived")) return "This store template is archived. Restore it before publishing it.";
  if (text.includes("store_starters.not_open")) return "The store template's store is not open, so it cannot be published.";
  if (text.includes("store_starters_archived_unpublished")) return "An archived store template is never published. Restore it first.";
  return null;
}
