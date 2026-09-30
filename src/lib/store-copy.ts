import { z } from "zod";

/**
 * Duplicating a store (D129): an owner makes a new store from one of theirs, choosing what comes along. The pieces an
 * owner chooses are pages, products, blog posts (articles), customers and orders; a store's settings always come
 * (everything but secrets and other people's rights), and the things that only make sense for the original never do
 * (payments, domains, keys, integrations, invoices and their numbering, billing, the team, Work, logs). Pure types and
 * checks, shared by the wizard in the browser and the server, which checks everything again.
 *
 * What copying each piece means (decided with the owner):
 * - **Pages, products, posts**: all, or the ones ticked. What they use comes with them (menus, header and footer,
 *   categories and tags, variants, prices, pictures, custom field values, subscription plans of a product); pictures are
 *   copied into the new store's own media library.
 * - **Customers**: shoppers only, with their addresses, groups and companies. No passwords, sessions, carts, wish lists
 *   or marketing consents come along; people who unsubscribed stay unsubscribed.
 * - **Orders**: read-only history. Lines, totals, dates and the customer are kept and the order is marked as copied
 *   (numbered `C-{original number}`): no payments, refunds, invoices, emails, integration events, shipments or effect on
 *   stock, and the new store's own order numbers start fresh.
 * - **Subscriptions**: a product's subscription plans come with the product; no customer's subscription or subscription
 *   box list is copied, so nobody can be billed or delivered to twice.
 */

/** How many of a kind to copy: none, all of them, or these (by id). */
export type CopySelection = { mode: "none" | "all" } | { mode: "selected"; ids: string[] };

export type StoreCopyOptions = {
  pages: CopySelection;
  products: CopySelection;
  posts: CopySelection;
  /** The shoppers (customer accounts), not the team. */
  customers: boolean;
  /** Order history, read-only. */
  orders: boolean;
  /** The owner says they may use this customer data in the new store; needed with customers or orders. */
  confirmDataUse: boolean;
};

export const COPY_IDS_MAX = 5000;
export const COPY_NAME_MAX = 80;

const selection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("selected"), ids: z.array(z.uuid()).max(COPY_IDS_MAX) }),
]);

export const storeCopyOptions = z
  .object({
    pages: selection,
    products: selection,
    posts: selection,
    customers: z.boolean(),
    orders: z.boolean(),
    confirmDataUse: z.boolean(),
  })
  .superRefine((options, ctx) => {
    if ((options.customers || options.orders) && !options.confirmDataUse) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmDataUse"],
        message: "Confirm that you may use this customer data in the new store.",
      });
    }
  });

/** What the wizard sends to start a copy. */
export const storeCopyInput = z.object({
  /** The store copied, by address; the account must own it. */
  source: z.string().min(1).max(60),
  name: z.string().trim().min(1, "Enter a store name.").max(COPY_NAME_MAX),
  /** The new store's address; made from the name when empty. */
  slug: z.string().trim().max(40).default(""),
  options: storeCopyOptions,
});
export type StoreCopyInput = z.infer<typeof storeCopyInput>;

export const noneOf = (): CopySelection => ({ mode: "none" });
export const DEFAULT_COPY_OPTIONS: StoreCopyOptions = {
  pages: { mode: "all" },
  products: { mode: "all" },
  posts: { mode: "all" },
  customers: false,
  orders: false,
  confirmDataUse: false,
};

/** Whether anything of a kind is copied, and how many of a total. */
export const copiesAny = (selection: CopySelection): boolean => selection.mode !== "none";
export const copyCount = (selection: CopySelection, total: number): number =>
  selection.mode === "all" ? total : selection.mode === "selected" ? Math.min(selection.ids.length, total) : 0;

// ---------------------------------------------------------------------------
// What the wizard shows before it starts
// ---------------------------------------------------------------------------

/** What an owner can choose from in one store: light rows to tick. */
export type CopyChoices = {
  source: { slug: string; name: string };
  pages: { id: string; title: string; slug: string; state: "draft" | "published" | "changed" }[];
  products: { id: string; title: string; handle: string; status: string; image: string | null }[];
  posts: { id: string; title: string; slug: string; state: "draft" | "published" | "changed" }[];
  customers: number;
  orders: number;
  /** Counts of the settings that always come, for the wizard's list ("3 menus, 2 markets …"): label and count. */
  settings: { label: string; count: number }[];
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const COPY_PHASES = ["queued", "content", "media", "people", "orders", "finishing", "done"] as const;
export type CopyPhase = (typeof COPY_PHASES)[number];
export const COPY_PHASE_LABELS: Record<CopyPhase, string> = {
  queued: "Waiting to start",
  content: "Copying settings, pages, products and posts",
  media: "Copying pictures and files",
  people: "Copying customers",
  orders: "Copying order history",
  finishing: "Finishing up",
  done: "Done",
};

export type CopyStatus = "running" | "done" | "failed";

/** A copy's progress, for the progress page (polled). */
export type StoreCopyProgress = {
  id: string;
  status: CopyStatus;
  phase: CopyPhase;
  sourceName: string;
  /** The original's address, so a failed copy can link back to its wizard. */
  sourceSlug: string;
  newName: string;
  newSlug: string;
  /** What was asked and what is done, by kind. `total` is 0 for a kind not chosen. */
  counts: Record<"pages" | "products" | "posts" | "customers" | "orders" | "media", { done: number; total: number }>;
  /** Pictures or files that could not be copied (left out, never left pointing at the original). */
  mediaLeftOut: number;
  /** Plain-English reason when it failed. */
  problem: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type StoreCopyResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** The server's side of the wizard, bound to the signed-in owner by the routes. */
export type StoreCopyActions = {
  choices: (sourceSlug: string) => Promise<StoreCopyResult<{ choices: CopyChoices }>>;
  start: (input: unknown) => Promise<StoreCopyResult<{ id: string }>>;
  progress: (id: string) => Promise<StoreCopyResult<{ progress: StoreCopyProgress }>>;
};

/** One copy in a list ("Recent copies"): the accounts's own, newest first. */
export type StoreCopySummary = Pick<
  StoreCopyProgress,
  "id" | "status" | "phase" | "sourceName" | "sourceSlug" | "newName" | "newSlug" | "startedAt" | "finishedAt"
>;
