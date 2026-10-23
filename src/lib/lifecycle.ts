/**
 * The life of a demo store (a store template in code, D175) or a theme (a design profile in code, D176) on the platform (D177, D273;
 * `docs/store-templates.md` section 4, `docs/design-profiles.md` section 2): saved as a draft, published (what owners and the sign-up form see), unpublished, archived (hidden
 * from every list but the platform's Archived filter, restorable) and deleted while nothing used it. Pure: shared by both platform pages and
 * the tests.
 */

export type LifecycleFacts = {
  published: boolean;
  /** When it was archived; null while it is not. */
  archivedAt: string | null;
  /** The last Publish; null when it was never published (under D177 or before). */
  publishedAt: string | null;
  /** Changes saved since the last Publish (details, or the content in its store or workspace). */
  changed: boolean;
};

export type LifecycleState = "archived" | "published" | "published_changed" | "unpublished" | "never_published";

export function lifecycleState(facts: LifecycleFacts): LifecycleState {
  if (facts.archivedAt) return "archived";
  if (facts.published) return facts.changed ? "published_changed" : "published";
  return facts.publishedAt ? "unpublished" : "never_published";
}

/** The words for a state, as the platform admin reads them. */
export const LIFECYCLE_WORDS: Record<LifecycleState, string> = {
  archived: "Archived",
  published: "Published",
  published_changed: "Published, with unpublished changes",
  unpublished: "Unpublished",
  never_published: "Draft, never published",
};

/** What the buttons of one item are, in the order they are shown; Delete only while nothing used it. */
export function lifecycleActions(facts: LifecycleFacts & { used: boolean }): ("publish" | "unpublish" | "archive" | "restore" | "delete")[] {
  if (facts.archivedAt) return facts.used ? ["restore"] : ["restore", "delete"];
  const actions: ("publish" | "unpublish" | "archive" | "delete")[] = [];
  if (!facts.published || facts.changed) actions.push("publish");
  if (facts.published) actions.push("unpublish");
  actions.push("archive");
  if (!facts.used) actions.push("delete");
  return actions;
}

/** What a list shows: the current items, or only the archived ones (`?show=archived`). */
export type ListFilter = "current" | "archived";
export const listFilterOf = (value: unknown): ListFilter => (value === "archived" ? "archived" : "current");

/** The words of `deleteBlocker()`; `{count}` and `{reasons}` are filled in. English unless given (D312 A11). */
export type DeleteBlockerWords = {
  themeStores: { one: string; many: string };
  demoStores: { one: string; many: string };
  platform: string;
  requests: { one: string; many: string };
  theme: string;
  demo: string;
  and: string;
};

const BLOCKER_EN: DeleteBlockerWords = {
  themeStores: { one: "{count} store applied it", many: "{count} stores applied it" },
  demoStores: { one: "{count} store was made from it", many: "{count} stores were made from it" },
  platform: "Kaizena Flow's own site has it installed",
  requests: { one: "{count} access request names it", many: "{count} access requests name it" },
  theme: "This theme cannot be deleted: {reasons}. Archive it instead.",
  demo: "This demo store cannot be deleted: {reasons}. Archive it instead.",
  and: "and",
};

const counted = (n: number, words: { one: string; many: string }) => (n === 1 ? words.one : words.many).replace("{count}", String(n));

/** Why something cannot be deleted, in plain words, or null when it can. */
export function deleteBlocker(
  kind: "demo store" | "theme",
  uses: { stores: number; requests: number; platform?: boolean },
  words: DeleteBlockerWords = BLOCKER_EN,
): string | null {
  const parts: string[] = [];
  if (uses.stores > 0) parts.push(counted(uses.stores, kind === "demo store" ? words.demoStores : words.themeStores));
  if (uses.platform) parts.push(words.platform);
  if (uses.requests > 0) parts.push(counted(uses.requests, words.requests));
  if (parts.length === 0) return null;
  return (kind === "demo store" ? words.demo : words.theme).replace("{reasons}", parts.join(` ${words.and} `));
}

/** A stable text of a JSON value: object keys sorted, so two equal values always give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
