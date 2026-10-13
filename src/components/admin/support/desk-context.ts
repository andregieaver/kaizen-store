/**
 * What an inbox needs from the level it is drawn at (D216, `docs/support.md` 5.4): a store's, the owner's combined one, or Kaizen's
 * own. The components never import a level's actions; the page passes them here, bound, as `PageOwnerContext` does for the page
 * builder. Everything is serializable: addresses are strings, and the actions are server actions.
 */
export type SupportDeskContext = {
  level: "store" | "owner" | "platform";
  /** The list's feed (GET, `?tab=&q=&store=`). */
  feedUrl: string;
  /** A conversation's feed, after which `/{id}?after=n` is added; `{store}` stands for a row's store at the owner's level. */
  conversationUrl: string;
  /** The stores of the owner's level, for its filter; empty elsewhere. */
  stores: { slug: string; name: string }[];
  /** Whether the person may go online and (from step 4) answer. */
  canWrite: boolean;
  /** Their presence when the inbox opened; null when they may not be online. */
  presence: "online" | "away" | null;
  actions: {
    heartbeat: () => Promise<{ ok: boolean }>;
    presence: ((status: "online" | "away") => Promise<{ ok: boolean }>) | null;
  };
};

/** A conversation's feed address for a row (its store at the owner's level). */
export const conversationHref = (context: Pick<SupportDeskContext, "conversationUrl">, id: string, store: string | null, after: number) =>
  `${context.conversationUrl.replace("{store}", store ?? "")}/${id}?after=${after}`;
