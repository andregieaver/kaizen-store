/**
 * Paid extensions (D748, `docs/extensions.md`), pure: which extensions there are, what a size of one includes, and whether an account has
 * one. The catalogue's words, sizes, prices, bundles and what each plan includes are rows (`src/server/extensions.ts`, edited at Platform →
 * Plans → Extensions); the ids here are fixed in code because the gates of step E3 name them, and the database's checks repeat them (a test
 * holds the two together).
 */

/** The extensions, in the order the owner named them. A new one is an id here, its row in a migration and its gates (step E3). */
export const EXTENSION_IDS = ["ab_testing", "support_desk", "email_automation", "work", "deals"] as const;
export type ExtensionId = (typeof EXTENSION_IDS)[number];

export const isExtensionId = (value: unknown): value is ExtensionId => (EXTENSION_IDS as readonly unknown[]).includes(value);

/**
 * What a size of an extension includes, counted per month where it is a flow: contacts on the list, emails per contact a month, AI-handled
 * conversations a month (resolved or handed over: each costs tokens), people who use it. A key a size leaves out is unlimited.
 */
export const ALLOWANCE_KEYS = ["contacts", "emails_per_contact", "ai_conversations", "people"] as const;
export type AllowanceKey = (typeof ALLOWANCE_KEYS)[number];
export type Allowances = Partial<Record<AllowanceKey, number>>;

/** Which allowances each extension's sizes are told apart by: the editor shows only these. */
export const ALLOWANCES_OF: Record<ExtensionId, readonly AllowanceKey[]> = {
  ab_testing: [],
  support_desk: ["ai_conversations"],
  email_automation: ["contacts", "emails_per_contact"],
  work: ["people"],
  deals: ["people"],
};

/** Reads a size's allowances from its stored JSON, keeping only known keys with whole numbers of zero or more. */
export function readAllowances(value: unknown): Allowances {
  const out: Allowances = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of ALLOWANCE_KEYS) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) out[key] = n;
  }
  return out;
}

/**
 * How an account came to have an extension, as kept in `organisation_extensions.source`: bought on its own, bought in a bundle, or in its
 * trial. An extension a plan includes is not kept there: it follows the plan.
 */
export const EXTENSION_SOURCES = ["bought", "bundle", "trial"] as const;
export type ExtensionSource = (typeof EXTENSION_SOURCES)[number];

/**
 * An account's standing with one extension (section 4.1 of the spec):
 * - `platform`: Kaizena Flow's own account, which has every extension;
 * - `active`: the plan includes it, it is paid for, or extensions are not yet sold (`legacy`: until launch every account has every one);
 * - `trial`: in its trial; `grace`: the trial or the payment ended, and everything still runs for the grace period;
 * - `read_only`: after the grace period, readable and exportable, nothing faces customers;
 * - `absent`: never had it; its screens and connections are not there.
 */
export const EXTENSION_STATES = ["absent", "trial", "active", "grace", "read_only", "platform"] as const;
export type ExtensionState = (typeof EXTENSION_STATES)[number];

/** Where an account's standing comes from: the platform, extensions not yet sold, the plan, or its own row. */
export type StateSource = "platform" | "legacy" | "plan" | ExtensionSource | null;

/** One row of `organisation_extensions`, as the state needs it. */
export type ExtensionRow = {
  source: ExtensionSource;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  /** When a bought extension or bundle stopped being paid for; null while it is. */
  endedAt: Date | null;
};

export type StateFacts = {
  /** The account is Kaizena Flow's own. */
  platform: boolean;
  /** When extensions started being sold (`platform_settings.extensions_launched_at`); null until step E5. */
  launchedAt: Date | null;
  /** The account's plan includes the extension. */
  included: boolean;
  row: ExtensionRow | null;
};

/** An account's standing with one extension at `now`. */
export function extensionState(facts: StateFacts, now: Date): { state: ExtensionState; source: StateSource } {
  if (facts.platform) return { state: "platform", source: "platform" };
  if (!facts.launchedAt || facts.launchedAt > now) return { state: "active", source: "legacy" };
  if (facts.included) return { state: "active", source: "plan" };
  const row = facts.row;
  if (!row) return { state: "absent", source: null };
  const before = (at: Date | null) => at !== null && now < at;
  if (row.source === "trial") {
    if (before(row.trialEndsAt)) return { state: "trial", source: "trial" };
    return { state: before(row.graceEndsAt) ? "grace" : "read_only", source: "trial" };
  }
  if (row.endedAt === null || now < row.endedAt) return { state: "active", source: row.source };
  return { state: before(row.graceEndsAt) ? "grace" : "read_only", source: row.source };
}
