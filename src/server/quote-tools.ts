import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { findClaims } from "@/lib/claims";
import { formFromDraft, inputFromForm } from "@/lib/draft-editor";
import { parsePrice } from "@/lib/product-input";
import { checkQuoteReply } from "@/lib/quotes";
import {
  priceWordProblemText,
  wordsOverlay,
  type DeclineQuoteInput,
  type SetDraftPricesInput,
  type SetPriceDisplayInput,
  type SetQuoteRequestsInput,
} from "@/lib/quote-tools";
import type { PriceDecimals } from "@/lib/money";
import type { QuantityPicker } from "@/lib/quantity-stepper";

import { passMembership, type Account, type Membership } from "./auth";
import { getDraft, previewDraft, saveDraft } from "./draft-orders";
import { staffActor } from "./order-actor";
import { draftAnswer, findDraft } from "./order-ops-tools";
import { getOrderSettings, saveOrderSettings } from "./order-settings";
import { OwnerToolError } from "./owner-tool-error";
import { readPriceDisplay, savePriceDisplay, type PriceDisplay, type PriceDisplayProblem } from "./price-display";
import { declineQuote, quoteRequestsWaiting } from "./quote-requests";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The AI manager's quotes and price display (D437): `price_display` reads what Settings, Prices and quantity and the quote setting under
 * Settings, Orders hold; `set_price_display` and `set_quote_requests` change them through those pages' own writers (`savePriceDisplay()`,
 * `saveOrderSettings()`) after the owner's yes (`public`); `set_draft_prices` types the price of an open draft's lines (most often a request for a
 * quote waiting for its prices) through the draft editor's own state and `saveDraft()`, so a line left unpriced keeps waiting; `decline_quote`
 * declines a request with a short reply emailed to the shopper (`declineQuote()`, `send`, never without a yes). The shopper's note, name and
 * company are never read here: they are on the draft's page. Every figure is the store's, written by its own functions.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

async function member(ctx: Ctx): Promise<Membership> {
  const found = await passMembership(ctx.store.slug, ctx.account.id);
  return found ?? fail("You are not a member of this store any more.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Price display and who may request a quote
// ---------------------------------------------------------------------------------------------------------------------

const DECIMALS: Record<PriceDecimals, string> = { always: "every price with its decimals", hide_whole: "whole amounts without decimals" };
const PICKERS: Record<QuantityPicker, string> = { buttons: "− and + around a number", box: "the number alone", hidden: "no chooser" };

export async function priceDisplayTool(ctx: Ctx) {
  const { store } = ctx;
  const [display, settings, waiting] = await Promise.all([readPriceDisplay(store.id), getOrderSettings(store.id), quoteRequestsWaiting(store.id)]);
  return {
    decimals: `${display.decimals}: ${DECIMALS[display.decimals]}`,
    countries: display.markets.map((m) => ({ country: m.code, decimals: m.decimals ?? "store" })),
    words_around_prices: store.localization.locales.map((locale) => ({ language: locale, before: display.words[locale]?.prefix ?? "", after: display.words[locale]?.suffix ?? "" })),
    words_note: "A language without words of its own shows the main language's. A product may follow these, show none or have its own (get_product, update_product).",
    quantity_chooser: `${display.quantityPicker}: ${PICKERS[display.quantityPicker]}`,
    quote_requests: settings.quoteRequests,
    quote_requests_waiting: waiting,
    admin: { prices: adminLink(store, "/settings/prices"), quotes: adminLink(store, "/settings/orders"), requests: adminLink(store, "/orders/drafts?quotes=1") },
  };
}

const problemWords = (problem: PriceDisplayProblem): string => {
  switch (problem.kind) {
    case "decimals":
      return "Decimals are always or hide_whole.";
    case "picker":
      return "The quantity chooser is buttons, box or hidden.";
    case "market":
      return `${problem.code} is not one of the store's countries.`;
    case "word":
      return `The words ${problem.place === "prefix" ? "before" : "after"} the price in ${problem.locale}: ${priceWordProblemText(problem.problem)}.`;
  }
};

/** What `set_price_display` would save: the call laid over what the store has, every value checked as the page checks it. */
async function plannedDisplay(ctx: Ctx, input: SetPriceDisplayInput): Promise<PriceDisplay> {
  const { store } = ctx;
  const had = await readPriceDisplay(store.id);
  const problems: string[] = [];
  const markets = had.markets.map((m) => ({ ...m }));
  for (const given of input.countries ?? []) {
    const code = given.country.toUpperCase();
    const market = markets.find((m) => m.code === code);
    if (!market) {
      problems.push(`${code} is not one of the store's countries (${markets.map((m) => m.code).join(", ")}).`);
      continue;
    }
    market.decimals = given.decimals === "store" ? null : (given.decimals as PriceDecimals);
  }
  const words = wordsOverlay(input.words ?? [], had.words, store.localization.locales);
  if (!words.ok) problems.push(...words.problems);
  if (problems.length > 0) return fail(problems.join(" "));
  const changes = input.decimals !== undefined || (input.countries ?? []).length > 0 || (input.words ?? []).length > 0 || input.quantity_chooser !== undefined;
  if (!changes) return fail("Nothing to change: give decimals, countries, words or quantity_chooser.");
  return {
    decimals: (input.decimals as PriceDecimals | undefined) ?? had.decimals,
    markets,
    words: words.ok ? words.words : had.words,
    quantityPicker: (input.quantity_chooser as QuantityPicker | undefined) ?? had.quantityPicker,
  };
}

/** Checked before the owner is asked: a country or a word the page would refuse is refused now. */
export async function preflightPriceDisplay(ctx: Ctx, input: SetPriceDisplayInput): Promise<void> {
  await plannedDisplay(ctx, input);
}

export async function setPriceDisplayTool(ctx: Ctx, input: SetPriceDisplayInput) {
  const next = await plannedDisplay(ctx, input);
  const saved = await savePriceDisplay(await member(ctx), next, ctx.store.localization.keptLocales);
  if (!saved.ok) return fail(saved.problems.map(problemWords).join(" "));
  return { done: "The shop shows prices this way now, on every page.", ...(await priceDisplayTool(ctx)) };
}

export async function setQuoteRequestsTool(ctx: Ctx, input: SetQuoteRequestsInput) {
  const saved = await saveOrderSettings(await member(ctx), { quoteRequests: input.who });
  if (!saved.ok) return fail(saved.problem);
  const words: Record<string, string> = {
    off: "Request a quote is off: only products priced on request offer it.",
    everyone: "Every shopper can now request a quote, beside Add to cart and in the cart.",
    business: "Business buyers can now request a quote, beside Add to cart and in the cart.",
  };
  return { done: words[saved.settings.quoteRequests], admin: adminLink(ctx.store, "/settings/orders") };
}

// ---------------------------------------------------------------------------------------------------------------------
// A draft's prices, and declining a request
// ---------------------------------------------------------------------------------------------------------------------

export async function setDraftPricesTool(ctx: Ctx, input: SetDraftPricesInput) {
  const { store, account } = ctx;
  const found = await findDraft(store, input.draft);
  const draft = (await getDraft(store.id, found.id)) ?? fail(`No draft order ${input.draft} in this store.`);
  if (draft.status !== "open") return fail(`Draft ${found.number} is not open: only an open draft's prices are typed. A sent, expired or cancelled draft is reopened on its page.`);
  // The editor's own state: a line priced on request and still waiting has an empty price box, so it keeps waiting unless a price is given here.
  const form = formFromDraft(draft);
  const problems: string[] = [];
  for (const given of input.lines) {
    const at = form.lines.flatMap((line, i) => (line.kind === "goods" && line.sku.toLowerCase() === given.sku.toLowerCase() ? [i] : []));
    if (at.length === 0) {
      problems.push(`The draft has no line ${given.sku}. Its SKUs: ${[...new Set(form.lines.filter((l) => l.kind === "goods").map((l) => l.sku))].join(", ") || "none"}.`);
      continue;
    }
    if (given.price !== "" && parsePrice(given.price, draft.currency) === null) {
      problems.push(`"${given.price}" is not a price in ${draft.currency}: write it as 450 or 449,50.`);
      continue;
    }
    for (const i of at) form.lines[i] = { ...form.lines[i], price: given.price };
  }
  if (problems.length > 0) return fail(problems.join(" "));
  const saved = await saveDraft(store.id, staffActor(account.id), found.id, inputFromForm(form, draft.version));
  if (!saved.ok) return fail(`The prices could not be saved: ${saved.fields?.map((f) => f.message).join(" ") || saved.problem}`);
  const preview = (await previewDraft(store.id, found.id)) ?? fail("The prices were saved but the draft could not be read back. Open it.");
  return {
    ...draftAnswer(store, preview),
    done: `The prices of draft ${found.number} are saved. Nothing has been sent.`,
    next: "Send it with send_draft_order (the owner's yes first); a request for a quote goes out as a quote.",
  };
}

const QUOTE_ROW = z.object({ source: col.text, status: col.text, declined: col.bool });

/** Checked before the owner is asked: an open request for a quote not declined yet, and a reply the page and the claims filter accept. */
export async function preflightDeclineQuote(ctx: Ctx, input: DeclineQuoteInput): Promise<{ id: string; number: string; reply: string }> {
  const { store } = ctx;
  const found = await findDraft(store, input.draft);
  const row = await typedRow(
    QUOTE_ROW,
    sql`select source, status, quote_declined_at is not null as declined from commerce.draft_orders where store_id = ${store.id}::uuid and id = ${found.id}::uuid`,
  );
  if (!row || row.source !== "quote") return fail(`Draft ${found.number} is not a request for a quote: only a shopper's request is declined.`);
  if (row.declined) return fail(`The request ${found.number} is already declined.`);
  if (row.status !== "open") return fail(`The request ${found.number} is not open (it was sent or ended), so it cannot be declined.`);
  const reply = checkQuoteReply(input.reply);
  if (!reply.ok) {
    const words = { required: "Write the reply the customer gets.", too_long: "The reply is too long: keep it short.", too_many_lines: "The reply has too many lines: keep it short." };
    return fail(words[reply.problem]);
  }
  // The reply reaches the customer in the store's name: it passes the claims filter like every text written for a customer (D76).
  const [claim] = findClaims(reply.value);
  if (claim) return fail(`The reply cannot say "${claim.phrase}". Write it plainly, in the owner's words.`);
  return { id: found.id, number: found.number, reply: reply.value };
}

export async function declineQuoteTool(ctx: Ctx, input: DeclineQuoteInput) {
  const { store, account } = ctx;
  const checked = await preflightDeclineQuote(ctx, input);
  const done = await declineQuote(store.id, staffActor(account.id), checked.id, checked.reply);
  if (!done.ok) {
    const words: Record<string, string> = {
      not_found: "The request is gone.",
      not_quote: "It is not a request for a quote.",
      not_open: "The request is not open any more.",
      declined: "The request was already declined.",
      reply: "The reply could not be used: keep it short.",
    };
    return fail(words[done.problem] ?? "The request could not be declined.");
  }
  const emailed: Record<string, string> = {
    sent: "The customer was emailed the reply.",
    duplicate: "The customer was emailed the reply.",
    logged: "Email is not set up for this store, so the reply was only recorded on the request.",
    suppressed: "The address does not receive emails from the store, so the reply is only on the request.",
    failed: "The reply could not be emailed: it is on the request, and the customer was not told.",
  };
  return {
    done: `The request ${checked.number} is declined and will not be sent as a quote. ${done.emailed ? (emailed[done.emailed] ?? "") : ""}`.trim(),
    admin: adminLink(store, `/orders/drafts/${checked.id}`),
  };
}
