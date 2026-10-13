import type { SavedReply } from "@/lib/support-replies";

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
  /** Their own *Partner on / off* when the inbox opened (step 8); null when they may not answer. */
  partnerOn: boolean | null;
  actions: {
    heartbeat: () => Promise<{ ok: boolean }>;
    presence: ((status: "online" | "away") => Promise<{ ok: boolean }>) | null;
    /** The person's own silent-partner switch (step 8). */
    partner: ((on: boolean) => Promise<{ ok: boolean }>) | null;
    /**
     * Take over, answer, note, hand over, give back, end, ask to sign in (step 4), or null for those who only read. A single desk's
     * action takes the conversation and the act; the owner's level's takes the conversation's store first.
     */
    act: { byStore: false; run: (conversationId: string, act: unknown) => Promise<ActResult> } | { byStore: true; run: (store: string, conversationId: string, act: unknown) => Promise<ActResult> } | null;
  };
};

export type ActResult =
  | { ok: true; brief?: string | null; ran?: boolean; replies?: SavedReply[]; locale?: string; text?: string; language?: string }
  | { ok: false; problem: string };

/** Runs an act through the level's action. */
export function runAct(context: Pick<SupportDeskContext, "actions">, store: string | null, conversationId: string, act: unknown): Promise<ActResult> {
  const action = context.actions.act;
  if (!action) return Promise.resolve({ ok: false, problem: "You can read this desk's conversations but not answer them." });
  return action.byStore ? action.run(store ?? "", conversationId, act) : action.run(conversationId, act);
}

/** A conversation's feed address for a row (its store at the owner's level). */
export const conversationHref = (context: Pick<SupportDeskContext, "conversationUrl">, id: string, store: string | null, after: number) =>
  `${context.conversationUrl.replace("{store}", store ?? "")}/${id}?after=${after}`;
