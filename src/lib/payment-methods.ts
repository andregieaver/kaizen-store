/**
 * Payment methods per country (wave 4 unit D, D291, `docs/wave-4-payments.md` 6). Kaizena Flow asks Stripe for each method's capability on every
 * store's account; Stripe decides whether a method is active and shows it to a shopper only where it suits their country and currency. On top of
 * that the owner may switch a method off for one of their countries (`commerce.payment_methods`, a row with `enabled = false`; no row is on), and
 * that country's checkout sessions then pass it in `excluded_payment_method_types`, never `payment_method_types`. Cards (with Apple Pay and
 * Google Pay) are always offered, so a checkout always has a way to pay.
 */

/** A method the owner can see and switch: its Stripe payment method type, its capability, and how it pays. */
export type MethodInfo = {
  /** Stripe's payment method type, as `excluded_payment_method_types` takes it. */
  type: string;
  /** The account capability Kaizena Flow requests for it. */
  capability: string;
  label: string;
  /** Where it is used, in words for the owner. */
  where: string;
  /** The money arrives days later: the order waits for the bank, with its stock held (`awaitBankPayment()`). */
  delayed?: true;
  /** Cards cannot be switched off: every checkout keeps a way to pay. */
  always?: true;
};

export const PAYMENT_METHODS: readonly MethodInfo[] = [
  { type: "card", capability: "card_payments", label: "Cards, Apple Pay and Google Pay", where: "Everywhere", always: true },
  { type: "klarna", capability: "klarna_payments", label: "Klarna", where: "Most of Europe" },
  { type: "link", capability: "link_payments", label: "Link", where: "Everywhere" },
  { type: "mobilepay", capability: "mobilepay_payments", label: "MobilePay", where: "Denmark and Finland" },
  { type: "ideal", capability: "ideal_payments", label: "iDEAL", where: "The Netherlands, in euro" },
  { type: "bancontact", capability: "bancontact_payments", label: "Bancontact", where: "Belgium, in euro" },
  { type: "eps", capability: "eps_payments", label: "EPS", where: "Austria, in euro" },
  { type: "p24", capability: "p24_payments", label: "Przelewy24", where: "Poland" },
  { type: "blik", capability: "blik_payments", label: "BLIK", where: "Poland, in złoty" },
  { type: "sepa_debit", capability: "sepa_debit_payments", label: "SEPA Direct Debit", where: "Euro countries", delayed: true },
];

export const METHOD_TYPES = PAYMENT_METHODS.map((m) => m.type);

/** The capabilities asked for on every store's account (D23 and D291), cards first. */
export const PAYMENT_CAPABILITIES = PAYMENT_METHODS.map((m) => m.capability);

/** The methods an owner can switch off for a country. */
export const SWITCHABLE_METHODS = PAYMENT_METHODS.filter((m) => !m.always);

export function methodInfo(type: string): MethodInfo | null {
  return PAYMENT_METHODS.find((m) => m.type === type) ?? null;
}

/** One saved choice: the method switched on or off for the country. */
export type MethodChoice = { market: string; method: string; enabled: boolean };

/**
 * What a country's checkout leaves out: the methods switched off for it. A method never named is on; cards are never left out, whatever a row
 * says; an unknown method is ignored. Sorted, so a session's parameters are the same for the same choices.
 */
export function excludedTypes(choices: readonly MethodChoice[], market: string): string[] {
  const off = new Set<string>();
  for (const c of choices) {
    if (c.market !== market || c.enabled) continue;
    const info = methodInfo(c.method);
    if (info && !info.always) off.add(info.type);
  }
  return [...off].sort();
}

/** Whether a method is on for a country (no row: on). */
export function methodOn(choices: readonly MethodChoice[], market: string, method: string): boolean {
  const info = methodInfo(method);
  if (!info) return false;
  if (info.always) return true;
  return !choices.some((c) => c.market === market && c.method === method && !c.enabled);
}

/** What Stripe says of one capability on the account, kept as Stripe gave it (`stripe_accounts.method_states`). */
export type CapabilityState = { status: string; reason?: string | null };

type CapabilityLike = { status?: string; status_details?: { code?: string }[] } | null | undefined;

/** The states of Kaizena Flow's capabilities read from an Accounts v2 object, as Stripe reports them; one Stripe does not list is left out. */
export function capabilityStates(capabilities: Record<string, CapabilityLike> | null | undefined): Record<string, CapabilityState> {
  const out: Record<string, CapabilityState> = {};
  for (const capability of PAYMENT_CAPABILITIES) {
    const c = capabilities?.[capability];
    if (!c?.status) continue;
    out[capability] = { status: String(c.status).slice(0, 40), reason: c.status_details?.[0]?.code?.slice(0, 80) ?? null };
  }
  return out;
}

export type MethodStateWord = "active" | "pending" | "requested" | "unavailable" | "not_read";

/** What the owner reads for a method's state at Stripe. A capability not reported yet was asked for and not answered: *Requested*. */
export function methodStateOf(states: Record<string, CapabilityState> | null, method: MethodInfo): MethodStateWord {
  if (!states) return "not_read";
  const s = states[method.capability]?.status;
  if (!s) return "requested";
  if (s === "active") return "active";
  if (s === "pending") return "pending";
  return "unavailable";
}

export const METHOD_STATE_WORDS: Record<MethodStateWord, string> = {
  active: "Active",
  pending: "Stripe is checking",
  requested: "Requested",
  unavailable: "Not available",
  not_read: "Not read yet",
};

/** Stripe's reason a capability is not on, in words; an unknown code is shown as Stripe gave it. */
export function stateReason(code: string | null | undefined): string | null {
  if (!code) return null;
  const words: Record<string, string> = {
    requirements_past_due: "Stripe needs more details from you",
    requirements_pending_verification: "Stripe is checking your details",
    restricted_other: "Stripe has paused it; see your Stripe Dashboard",
    unsupported_business: "Stripe does not offer it to your kind of business",
    unsupported_country: "Stripe does not offer it in your country",
    unsupported_entity_type: "Stripe does not offer it to your kind of company",
  };
  return words[code] ?? code;
}

/** A bank payment waits up to this long (SEPA Direct Debit takes up to 14 business days): the order keeps its stock held until then. */
export const BANK_WAIT_DAYS = 21;
