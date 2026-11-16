import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { parseAmount } from "./field-money";
import { formatMoney, minorUnitDigits } from "./money";

/**
 * The AI's card wallet (D599, step 2 of `docs/agent-spending.md`): the owner's own Airwallex account, connected by OAuth to Kaizena Flow's
 * partner app. For each purchase the owner approves, one single-use virtual card is made in it, locked to the amount, the wallet's currency
 * and a short window, and named for the purchase; it appears in the cardholder's Airwallex app, and they pay with it. Kaizena Flow never
 * holds money nor sees a card number. Pure: Airwallex's fixed addresses, the signed state of the connect, the rules for a new purchase, the
 * card a purchase asks for, and how its charges are read. Server code only (it signs with `node:crypto`).
 */

export type WalletMode = "sandbox" | "live";

/** Airwallex's hosts per mode [docs: partner connections, existing customers]. Fixed in code: never from a store, a token or a page. */
export const AIRWALLEX_HOSTS: Record<WalletMode, { authorize: string; token: string; api: string; app: string }> = {
  sandbox: {
    authorize: "https://www.sandbox.airwallex.com/oauth/authorize",
    token: "https://api.sandbox.airwallex.com/oauth/token",
    api: "https://api.sandbox.airwallex.com",
    app: "https://www.sandbox.airwallex.com/app",
  },
  live: {
    authorize: "https://www.airwallex.com/oauth/authorize",
    token: "https://api.airwallex.com/oauth/token",
    api: "https://api.airwallex.com",
    app: "https://www.airwallex.com/app",
  },
};

/** What Kaizena Flow asks of the owner's account: its cards, who they are for, and their charges. Nothing that moves money elsewhere. */
export const AIRWALLEX_SCOPES = ["issuing.card:read", "issuing.card:write", "issuing.cardholder:read", "issuing.transaction:read"] as const;

/** The state cookie: only sent to the callback's own path, for a quarter of an hour. */
export const WALLET_STATE_COOKIE = "kaizen_airwallex";
export const WALLET_STATE_PATH = "/api/integrations/airwallex";
export const WALLET_STATE_MINUTES = 15;

/** How long a purchase's card takes charges: two days from the yes, then it closes unused. */
export const CARD_HOURS = 48;

export type WalletState = { state: string; store: string; account: string; expires: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:airwallex-connect").digest();
const sign = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const walletNonce = (): string => randomBytes(48).toString("base64url");

export function sealWalletState(secret: Buffer, value: Omit<WalletState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + WALLET_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The state cookie's contents, or null when it is not one this server signed, is altered, malformed or over. */
export function openWalletState(secret: Buffer, sealed: string | null | undefined, now = Date.now()): WalletState | null {
  if (typeof sealed !== "string" || sealed.length > 2000) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !sameText(sign(secret, body), given)) return null;
  let value: Partial<WalletState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<WalletState>;
  } catch {
    return null;
  }
  const { state, store, account, expires } = value;
  if (typeof state !== "string" || !NONCE.test(state)) return null;
  if (typeof store !== "string" || !SLUG.test(store) || typeof account !== "string" || !UUID.test(account)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > WALLET_STATE_MINUTES * 60_000) return null;
  return { state, store, account, expires };
}

/** Airwallex's consent page for Kaizena Flow's partner app, with the state and the scopes (space-separated, sent as `+`). */
export function walletAuthorizeUrl(o: { mode: WalletMode; clientId: string; redirectUri: string; state: string }): string {
  const query = new URLSearchParams({ response_type: "code", client_id: o.clientId, redirect_uri: o.redirectUri, scope: AIRWALLEX_SCOPES.join(" "), state: o.state });
  return `${AIRWALLEX_HOSTS[o.mode].authorize}?${query}`;
}

/** Whether an access token's time is up, a minute early (Airwallex's last five minutes). */
export const accessDue = (expiresAt: Date | null, now = Date.now()): boolean => expiresAt === null || expiresAt.getTime() - 60_000 <= now;

// Airwallex's answers, read as narrowly as they are used.
export const tokenAnswerSchema = z.object({
  access_token: z.string().min(10).max(8000),
  refresh_token: z.string().min(10).max(8000).optional(),
  expires_in: z.number().int().positive().max(86_400 * 7).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  account_id: z.string().min(1).max(80).optional(),
});

const cardholderSchema = z.object({
  cardholder_id: z.string().min(1).max(80),
  status: z.string().max(40).optional(),
  type: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  individual: z.object({ name: z.object({ first_name: z.string().max(100).optional(), last_name: z.string().max(100).optional() }).optional() }).optional(),
});
export const cardholdersSchema = z.object({ items: z.array(cardholderSchema) });

export type Cardholder = { id: string; name: string; active: boolean };

/** The people cards may be made for: a person's name (else their email), and whether Airwallex has them ready. */
export function cardholdersOf(answer: z.output<typeof cardholdersSchema>): Cardholder[] {
  return answer.items.map((c) => {
    const name = [c.individual?.name?.first_name, c.individual?.name?.last_name].filter(Boolean).join(" ").trim() || c.email || c.cardholder_id;
    return { id: c.cardholder_id, name: name.slice(0, 200), active: (c.status ?? "READY").toUpperCase() === "READY" };
  });
}

export const cardAnswerSchema = z.object({
  card_id: z.string().min(1).max(120),
  card_number: z.string().max(40).optional(),
  card_status: z.string().max(40).optional(),
});

export const transactionsSchema = z.object({
  has_more: z.boolean().optional(),
  items: z.array(
    z.object({
      transaction_id: z.string().min(1).max(120),
      card_id: z.string().max(120).optional(),
      transaction_type: z.string().max(40).optional(),
      status: z.string().max(40).optional(),
      billing_amount: z.number().optional(),
      billing_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      merchant: z.object({ name: z.string().max(400).optional(), category_code: z.string().max(10).optional() }).optional(),
      transaction_date: z.string().max(40).optional(),
      posted_date: z.string().max(40).optional(),
    }),
  ),
});

/** The last four digits of a masked card number (`************4111`), or null. */
export const lastFour = (masked: string | undefined): string | null => (masked && /\d{4}$/.test(masked) ? masked.slice(-4) : null);

/** Minor units as the major-unit number Airwallex takes (`24950` NOK → `249.5`), exact for every currency of ours. */
export const majorAmount = (minor: number, currency: string): number => Number((minor / 10 ** minorUnitDigits(currency)).toFixed(minorUnitDigits(currency)));

/** Airwallex's major-unit amount as minor units, rounded to the currency's own digits; null when it is not a finite amount. */
export function minorAmount(major: number | undefined, currency: string): number | null {
  if (major === undefined || !Number.isFinite(major)) return null;
  const minor = Math.round(Math.abs(major) * 10 ** minorUnitDigits(currency));
  return Number.isSafeInteger(minor) ? minor : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// A purchase
// ---------------------------------------------------------------------------------------------------------------------

export { purchaseInput, type PurchaseInput } from "./purchase-input";

export type WalletFacts = { state: "choose" | "on" | "auth_failed"; paused: boolean; currency: string; limitMinor: number | null; cardholderId: string | null };

/** Why no card may be made for a purchase now, as a code (`walletProblemWords()`), or null. */
export type WalletProblem = "not_connected" | "choose" | "auth_failed" | "paused" | "no_limit" | "over_limit" | "amount";

/**
 * Whether a purchase may get a card: the wallet connected, its cardholder chosen, not paused, a monthly limit set, and this purchase within
 * what is left of it this month (`takenMinor`: every open purchase's full amount and every closed one's spend, `monthTaken()`).
 */
export function walletProblem(wallet: WalletFacts | null, takenMinor: number, amountMinor: number | null): WalletProblem | null {
  if (!wallet) return "not_connected";
  if (wallet.state === "auth_failed") return "auth_failed";
  if (wallet.state === "choose" || !wallet.cardholderId) return "choose";
  if (wallet.paused) return "paused";
  if (amountMinor === null || amountMinor < 100) return "amount";
  if (wallet.limitMinor === null) return "no_limit";
  if (takenMinor + amountMinor > wallet.limitMinor) return "over_limit";
  return null;
}

/** The amount the tool was given, in the wallet's currency, as minor units; null when it is not one. */
export const purchaseAmount = (text: string, currency: string): number | null => parseAmount(text.replace(/\s/g, ""), currency);

const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

/** Why a purchase cannot get a card, in words for the model and the owner. */
export function walletProblemWords(problem: WalletProblem, f: { currency?: string; limitMinor?: number | null; takenMinor?: number } = {}): string {
  switch (problem) {
    case "not_connected":
      return "The store has no card wallet. The owner connects Airwallex under Autopilot, Settings, AI wallet.";
    case "choose":
      return "The card wallet is connected, but the owner has not chosen who the cards are for (Autopilot, Settings, AI wallet).";
    case "auth_failed":
      return "Airwallex no longer accepts the wallet's connection. The owner connects it again under Autopilot, Settings, AI wallet.";
    case "paused":
      return "The owner has paused the AI's cards. Nothing can be bought until they switch them on again.";
    case "no_limit":
      return "The owner has not set what the AI's cards may take in a month (Autopilot, Settings, AI wallet).";
    case "over_limit":
      return f.currency && f.limitMinor !== null && f.limitMinor !== undefined
        ? `That is more than is left of the AI's monthly limit: ${money(Math.max(0, f.limitMinor - (f.takenMinor ?? 0)), f.currency)} of ${money(f.limitMinor, f.currency)}.`
        : "That is more than is left of the AI's monthly limit.";
    case "amount":
      return f.currency ? `Give the most it may cost as an amount in ${f.currency}, at least 1.00, such as 249 or 249.50.` : "Give the most it may cost as an amount.";
  }
}

/** The purchase in words made from its arguments and the wallet (never the model's own sentence about it), for the approval. */
export function purchaseWords(p: { what: string; merchant: string; amountMinor: number; currency: string; url?: string | null }, cardholder: string | null): string {
  return `Make a single-use card for "${p.what}" from ${p.merchant}, up to ${money(p.amountMinor, p.currency)}, open for ${CARD_HOURS} hours${
    cardholder ? `, in ${cardholder}'s Airwallex app` : ""
  }.${p.url ? ` The merchant's page: ${p.url}.` : ""} The card works once, then closes.`;
}

/**
 * The card a purchase asks Airwallex for: virtual, for the wallet's cardholder, one charge only, at most the purchase's amount in the
 * wallet's currency (Airwallex converts a charge in another currency to it), open from now for `CARD_HOURS` and closed by Airwallex the day
 * after. Named for the purchase in the owner's app. The purchase's id is the request's own id, so a retry never makes a second card.
 */
export function cardRequest(
  p: { id: string; what: string; amountMinor: number; currency: string },
  wallet: { cardholderId: string },
  createdBy: string,
  now: Date,
): Record<string, unknown> {
  const activeTo = new Date(now.getTime() + CARD_HOURS * 3_600_000);
  const closeOn = new Date(activeTo.getTime() + 86_400_000).toISOString().slice(0, 10);
  const amount = majorAmount(p.amountMinor, p.currency);
  return {
    request_id: p.id,
    form_factor: "VIRTUAL",
    is_personalized: true,
    cardholder_id: wallet.cardholderId,
    created_by: createdBy.slice(0, 100) || "Kaizena Flow",
    program: { purpose: "COMMERCIAL" },
    purpose: "ONLINE_PURCHASING",
    nick_name: `Kaizena Flow: ${p.what}`.slice(0, 40),
    authorization_controls: {
      allowed_transaction_count: "SINGLE",
      transaction_limits: {
        currency: p.currency,
        limits: [
          { amount, interval: "PER_TRANSACTION" },
          { amount, interval: "ALL_TIME" },
        ],
      },
      active_from: now.toISOString(),
      active_to: activeTo.toISOString(),
    },
    auto_close_date: closeOn,
    metadata: { kaizena_purchase: p.id },
  };
}

/** When the card stops taking charges. */
export const cardActiveTo = (now: Date): Date => new Date(now.getTime() + CARD_HOURS * 3_600_000);

// ---------------------------------------------------------------------------------------------------------------------
// Its charges
// ---------------------------------------------------------------------------------------------------------------------

export type ChargeKind = "authorization" | "clearing" | "reversal" | "refund" | "other";
export type Charge = { ref: string; kind: ChargeKind; status: string; amountMinor: number; currency: string; merchantName: string | null; merchantCategory: string | null; at: Date };

const KINDS: Record<string, ChargeKind> = { AUTHORIZATION: "authorization", CLEARING: "clearing", REVERSAL: "reversal", REFUND: "refund" };
/** A transaction that did not take money: declined or failed. */
const NOT_TAKEN = new Set(["FAILED", "DECLINED", "REJECTED", "CANCELLED", "EXPIRED"]);

/** A transaction as a charge in the wallet's currency, or null when it cannot be read (another currency than the card's, no amount). */
export function chargeOf(t: z.output<typeof transactionsSchema>["items"][number], currency: string): Charge | null {
  const billed = t.billing_currency ?? currency;
  if (billed !== currency) return null;
  const amount = minorAmount(t.billing_amount, currency);
  if (amount === null) return null;
  const at = new Date(t.transaction_date ?? t.posted_date ?? "");
  const category = t.merchant?.category_code && /^\d{4}$/.test(t.merchant.category_code) ? t.merchant.category_code : null;
  return {
    ref: t.transaction_id,
    kind: KINDS[(t.transaction_type ?? "").toUpperCase()] ?? "other",
    status: (t.status ?? "UNKNOWN").toUpperCase().slice(0, 40),
    amountMinor: amount,
    currency,
    merchantName: t.merchant?.name?.trim().slice(0, 200) || null,
    merchantCategory: category,
    at: Number.isNaN(at.getTime()) ? new Date(0) : at,
  };
}

/**
 * What a purchase's card took: the clearings less refunds once a clearing has come, else the authorisations less reversals still waiting
 * (a charge declined or failed takes nothing). Never below zero.
 */
export function spentOf(charges: readonly Pick<Charge, "kind" | "status" | "amountMinor">[]): number {
  const taken = charges.filter((c) => !NOT_TAKEN.has(c.status));
  const sum = (kind: ChargeKind) => taken.filter((c) => c.kind === kind).reduce((s, c) => s + c.amountMinor, 0);
  const cleared = sum("clearing");
  const value = cleared > 0 ? cleared - sum("refund") : sum("authorization") - sum("reversal") - sum("refund");
  return Math.max(0, value);
}

/** A purchase's next state from its charges and the clock: charged, or closed when its window is over (`close` says the card is to be closed). */
export function purchaseAfter(
  p: { status: string; activeTo: Date },
  charges: readonly Pick<Charge, "kind" | "status" | "amountMinor">[],
  now: Date,
): { status: "card_ready" | "spent" | "closed"; spentMinor: number; close: boolean } {
  const spent = spentOf(charges);
  const cleared = charges.some((c) => c.kind === "clearing" && !NOT_TAKEN.has(c.status));
  if (spent > 0 || cleared) return { status: cleared ? "closed" : "spent", spentMinor: spent, close: cleared };
  if (now.getTime() > p.activeTo.getTime()) return { status: "closed", spentMinor: 0, close: true };
  return { status: p.status === "spent" ? "spent" : "card_ready", spentMinor: 0, close: false };
}
