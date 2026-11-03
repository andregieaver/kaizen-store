/**
 * Request a quote (D431): a shopper asks the store for a price on goods, from a product's page or from the cart, and the request becomes a
 * draft order of source `quote` (D173) that staff price with the draft editor and send as a quote (the draft's pay link). Who may ask is the
 * store's `order_settings.quote_requests` (`off`, `everyone`, `business`); a product priced on request (`products.price_on_request`) offers it
 * whatever that says, as its only way to buy. Pure and free of zod: the request is checked here the same in the visitor's browser (the cart is
 * a pay route, D158) and on the server (`src/server/quote-requests.ts`).
 */
import { cleanShopperText } from "./gift";
import { isEmail, isPhone } from "./forms";
import { DRAFT_QUANTITY_MAX } from "./order-limits";

export const QUOTE_MODES = ["off", "everyone", "business"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];
export const isQuoteMode = (value: unknown): value is QuoteMode => typeof value === "string" && (QUOTE_MODES as readonly string[]).includes(value);

/** The buy part's Request a quote (the layout's `quote` setting): beside Add to cart, or instead of it. */
export const QUOTE_PLACEMENTS = ["beside", "instead"] as const;
export type QuotePlacement = (typeof QUOTE_PLACEMENTS)[number];

/** A request's note as the shopper writes it: refused, not cut, beyond these. */
export const QUOTE_NOTE_MAX = 2000;
export const QUOTE_NOTE_LINES = 40;
/** Staff's short reply when they decline a request (emailed to the shopper). */
export const QUOTE_REPLY_MAX = 1000;
export const QUOTE_REPLY_LINES = 15;
/** Lines one request carries at most (a cart's goods). */
export const QUOTE_LINES_MAX = 50;
/** Requests a store takes in a day, and a visitor in an hour across the store's forms (`VISITOR_HOURLY` of D93). */
export const QUOTES_PER_STORE_DAY = 100;
const NAME_MAX = 120;
const COMPANY_MAX = 120;
const PHONE_MAX = 40;

/**
 * Whether a shopper may ask for a quote of a product that has its price: the store's mode, and for `business` whether this shopper buys for
 * a business (the store sells only to businesses, they chose Business (D63), or their account belongs to a company or a customer group, D108).
 * A product priced on request is offered whatever this says (`quoteFor()`).
 */
export function quoteOffered(mode: QuoteMode, buyer: { business: boolean }): boolean {
  return mode === "everyone" || (mode === "business" && buyer.business);
}

/** What the buy part draws: the price on request product's only way, a button beside Add to cart, instead of it, or nothing. */
export function quoteFor(product: { priceOnRequest: boolean }, offered: boolean, placement: QuotePlacement | undefined): "only" | "beside" | "instead" | null {
  if (product.priceOnRequest) return "only";
  if (!offered) return null;
  return placement === "instead" ? "instead" : "beside";
}

/** Each field of the form: not asked, asked, or needed. The email address is always needed (the quote goes to it). */
export const FIELD_NEEDS = ["hidden", "optional", "required"] as const;
export type FieldNeed = (typeof FIELD_NEEDS)[number];
export type QuoteFields = { name: FieldNeed; phone: FieldNeed; company: FieldNeed; note: FieldNeed };
export const DEFAULT_QUOTE_FIELDS: QuoteFields = { name: "required", phone: "optional", company: "optional", note: "optional" };

/** What the browser sends to `/api/quotes`. `lines` are the product's (from its page); the cart's are read by the server from the cart itself. */
export type QuoteRequestBody = {
  store: string;
  market: string;
  from: "product" | "cart";
  lines: { variantId: string; quantity: number }[];
  name: string;
  email: string;
  phone: string;
  company: string;
  note: string;
  /** A field people never see: only robots fill it in. */
  website: string;
  /** Milliseconds from showing the form to sending it. */
  elapsed: number;
  /** The product layout's part that sent it (its field settings), when not the buy part's own form. */
  block: string | null;
};

export type QuoteField = "name" | "email" | "phone" | "company" | "note" | "lines";
export type QuoteProblem = "required" | "invalid" | "too_long" | "too_many_lines";
export type QuoteProblems = Partial<Record<QuoteField, QuoteProblem>>;

/** The request as kept: cleaned, with empty fields as null. */
export type CheckedQuote = {
  store: string;
  market: string;
  from: "product" | "cart";
  lines: { variantId: string; quantity: number }[];
  name: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  note: string | null;
  website: string;
  elapsed: number;
  block: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MARKET = /^[a-z]{2}(?:-[a-z]{2,3}){0,2}$/;
const BLOCK = /^[A-Za-z0-9_-]{1,64}$/;
/** One line of text: control characters and line breaks out. */
const line = (value: unknown) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, " ").trim() : "");

/**
 * Checks a request as `/api/quotes` receives it, against the form's fields (`fields`: the part's, else the defaults). Null when the shape
 * itself is wrong (not a request at all); otherwise the problems by field, or the cleaned request.
 */
export function checkQuoteRequest(
  raw: unknown,
  fields: QuoteFields = DEFAULT_QUOTE_FIELDS,
): { ok: true; value: CheckedQuote } | { ok: false; problems: QuoteProblems } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const store = typeof body.store === "string" ? body.store : "";
  const market = typeof body.market === "string" ? body.market : "";
  if (!SLUG.test(store) || !MARKET.test(market)) return null;
  const from = body.from === "cart" ? "cart" : body.from === "product" ? "product" : null;
  if (!from) return null;
  const block = typeof body.block === "string" && BLOCK.test(body.block) ? body.block : null;
  const problems: QuoteProblems = {};

  const lines: CheckedQuote["lines"] = [];
  if (from === "product") {
    const given = Array.isArray(body.lines) ? body.lines : [];
    if (given.length === 0 || given.length > QUOTE_LINES_MAX) problems.lines = given.length === 0 ? "required" : "invalid";
    for (const item of given.slice(0, QUOTE_LINES_MAX)) {
      const entry = (item ?? {}) as Record<string, unknown>;
      const variantId = typeof entry.variantId === "string" ? entry.variantId : "";
      const quantity = typeof entry.quantity === "number" ? entry.quantity : Number.NaN;
      if (!UUID.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > DRAFT_QUANTITY_MAX) {
        problems.lines = "invalid";
        continue;
      }
      const same = lines.find((l) => l.variantId === variantId);
      if (same) same.quantity = Math.min(DRAFT_QUANTITY_MAX, same.quantity + quantity);
      else lines.push({ variantId, quantity });
    }
  }

  const email = line(body.email);
  if (email === "") problems.email = "required";
  else if (!isEmail(email)) problems.email = "invalid";

  const text = (field: "name" | "company", max: number): string | null => {
    const value = line(body[field]);
    if (fields[field] === "hidden") return null;
    if (value === "") {
      if (fields[field] === "required") problems[field] = "required";
      return null;
    }
    if ([...value].length > max) problems[field] = "too_long";
    return value;
  };
  const name = text("name", NAME_MAX);
  const company = text("company", COMPANY_MAX);

  let phone: string | null = null;
  if (fields.phone !== "hidden") {
    const value = line(body.phone);
    if (value === "") {
      if (fields.phone === "required") problems.phone = "required";
    } else if (value.length > PHONE_MAX || !isPhone(value)) problems.phone = "invalid";
    else phone = value;
  }

  let note: string | null = null;
  if (fields.note !== "hidden") {
    const cleaned = cleanShopperText(typeof body.note === "string" ? body.note : "", { maxChars: QUOTE_NOTE_MAX, maxLines: QUOTE_NOTE_LINES });
    if (!cleaned.ok) problems.note = cleaned.problem;
    else if (cleaned.value === null && fields.note === "required") problems.note = "required";
    else note = cleaned.value;
  }

  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      store,
      market,
      from,
      lines,
      name,
      email,
      phone,
      company,
      note,
      website: typeof body.website === "string" ? body.website.slice(0, 1000) : "",
      elapsed: typeof body.elapsed === "number" && Number.isFinite(body.elapsed) ? Math.max(0, Math.floor(body.elapsed)) : 0,
      block,
    },
  };
}

/** Staff's reply when declining: cleaned, refused when empty or too long. */
export function checkQuoteReply(value: unknown): { ok: true; value: string } | { ok: false; problem: "required" | "too_long" | "too_many_lines" } {
  const cleaned = cleanShopperText(value, { maxChars: QUOTE_REPLY_MAX, maxLines: QUOTE_REPLY_LINES });
  if (!cleaned.ok) return { ok: false, problem: cleaned.problem };
  if (cleaned.value === null) return { ok: false, problem: "required" };
  return { ok: true, value: cleaned.value };
}

/** Whether a cart line can be asked a quote for: sent by post, bought once, not a booking or a gift card (a draft sells goods only, D173; the server reads the product's kind again). */
export const quotableLine = (line: { delivery: string; plan: unknown; booking: unknown; giftCard?: unknown }): boolean =>
  line.delivery === "physical" && !line.plan && !line.booking && !line.giftCard;

/** Where a request is for, read before its form's fields are known: the store, the market view and the product layout's part, or null for no request at all. */
export function quoteRequestPlace(raw: unknown): { store: string; market: string; block: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.store !== "string" || !SLUG.test(body.store) || typeof body.market !== "string" || !MARKET.test(body.market)) return null;
  return { store: body.store, market: body.market, block: typeof body.block === "string" && BLOCK.test(body.block) ? body.block : null };
}
