import "server-only";

import type { OwnerToolInput } from "@/lib/owner-tools";
import { checkRegistration, firstBlockedDay, numberShownByDefault, PROBLEM_WORDS, registrationState } from "@/lib/producer-registrations";

import type { Account } from "./auth";
import { catalogTag } from "./catalog";
import { OwnerToolError } from "./owner-tool-error";
import { listRegistrations, missingRegistrations, saveRegistration, storeToday } from "./producer-registrations";
import type { Store } from "./stores";

/**
 * The AI manager's producer responsibility (wave 7 unit H, D342): `producer_registrations` reads what the Producer responsibility page shows
 * (registrations, and what is not sold for want of one); `save_producer_registration` decides what a country's shoppers can buy, so it waits for
 * the owner's yes (gate `public`, never automatic) and goes through the page's own writer (`saveRegistration()`). The model never makes up a
 * number: the tool's description says so, and nothing here supplies one.
 */

type Ctx = { account: Account; store: Store; invalidate?: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store) => `/admin/${store.slug}/settings/producer-responsibility`;

/** How many products of a group are named in an answer. */
const NAMED = 10;

export async function producerRegistrationsTool({ store }: Ctx) {
  const [registrations, missing, today] = await Promise.all([
    listRegistrations(store.id),
    missingRegistrations(store.id, store.localization.locales[0] ?? "en"),
    storeToday(store.id),
  ]);
  return {
    today,
    registrations: registrations.map((r) => ({
      id: r.id,
      scheme: r.scheme,
      country: r.market,
      kind: r.kind,
      number: r.number,
      authority: r.authority,
      reason: r.exemption,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      state: registrationState(r, today),
      sales_stop_from: firstBlockedDay(r),
      shown_on_product_pages: r.showNumber,
    })),
    not_sold: missing.map((g) => ({
      scheme: g.scheme,
      country: g.market,
      products: g.products.length,
      named: g.products.slice(0, NAMED).map((p) => p.title),
    })),
    note:
      missing.length === 0
        ? "Every active product under a scheme can be sold in every country the store sells to."
        : "Products under a scheme with no valid registration in a country are not sold there: the cart and checkout refuse them. The owner adds the registration, or records why none is needed there.",
    admin: adminLink(store),
  };
}

/** The registration the input asks for, as the page's form would send it. */
async function asTyped(store: Store, input: OwnerToolInput<"save_producer_registration">) {
  const country = input.country.toUpperCase();
  return {
    scheme: input.scheme,
    market: country,
    kind: input.kind,
    number: input.number ?? null,
    authority: input.authority ?? null,
    exemption: input.reason ?? null,
    showNumber: input.show_number ?? numberShownByDefault(input.scheme, country),
    validFrom: input.valid_from ?? (await storeToday(store.id)),
    validTo: input.valid_to ?? null,
  };
}

/** Checks the registration before it is kept for a yes: what the page would refuse is refused now, in its words. */
export async function preflightProducerTool({ store }: Ctx, raw: Record<string, unknown>): Promise<void> {
  const input = raw as OwnerToolInput<"save_producer_registration">;
  if (input.id && !(await listRegistrations(store.id)).some((r) => r.id === input.id)) fail("That registration is not one of this store's. Read producer_registrations.");
  const checked = checkRegistration(await asTyped(store, input), store.keptMarkets.map((m) => m.code));
  if (!checked.ok) fail(checked.problems.map((p) => PROBLEM_WORDS[p]).join(" "));
}

export async function saveProducerRegistrationTool(ctx: Ctx, input: OwnerToolInput<"save_producer_registration">) {
  const { store } = ctx;
  const saved = await saveRegistration(store, ctx.account.id, await asTyped(store, input), input.id ?? null);
  if (!saved.ok) return fail("missing" in saved ? "That registration is not one of this store's." : saved.problems.map((p) => PROBLEM_WORDS[p]).join(" "));
  ctx.invalidate?.(catalogTag(store.id));
  const missing = await missingRegistrations(store.id, store.localization.locales[0] ?? "en");
  return {
    done: input.id ? "The registration is changed." : "The registration is recorded.",
    id: saved.id,
    still_not_sold: missing.map((g) => ({ scheme: g.scheme, country: g.market, products: g.products.length })),
    admin: adminLink(store),
  };
}
