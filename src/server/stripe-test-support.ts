// Test support: the one stand-in for Kaizena Flow's own Stripe account (the Connect platform), in both modes, for the integration tests
// that put it where every call reaches Stripe (`platformStripe()` in `./stripe`). Not imported by the app.
//
// It keeps what Stripe keeps (accounts, Checkout sessions, coupons, payments, refunds, invoices, subscriptions, webhook endpoints),
// answers an idempotency key as Stripe does (the first answer again for the same parameters, a refusal for others), refuses what Stripe
// refuses (an amount that is not a whole number of minor units, more than one currency in a session, a fee above what is paid, a coupon,
// session or payment of another account, a refund above what is left) and records every call with the mode of the client that made it.
// Nothing reaches the network and no key is needed. A test file mocks `./stripe` with it:
//
//   vi.mock("./stripe", async (importActual) => {
//     const { stripe } = await import("./stripe-test-support");
//     return { ...(await importActual<typeof import("./stripe")>()), platformStripe: stripe.platform };
//   });
//
// and imports `stripe` from here itself: the mock and the test then share the one stand-in of that file.
import Stripe from "stripe";

type Capability = { status: string; status_details?: { code: string; resolution: string }[] };
type Entry = { awaiting_action_from: "user" | "stripe"; description: string; minimum_deadline: { status: string }; errors?: { code: string }[] };
type Side = { capabilities: Record<string, Capability>; entries: Entry[] };
export type StripeCall = { method: string; args: unknown[]; mode: string | null };
type CreateParams = { dashboard?: string; configuration?: { merchant?: { capabilities?: Record<string, unknown> } } };
type Options = { stripeAccount?: string; idempotencyKey?: string } | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- what Stripe is sent and answers is JSON; the tests read it as such
type Json = Record<string, any>;

/** A Checkout session as the stand-in keeps it: Stripe's fields, and the account it was made on (null: a store's own keys). */
export type StandInSession = Json & { id: string; account: string | null; status: "open" | "complete" | "expired"; payment_status: "paid" | "unpaid" | "no_payment_required"; amount_total: number };

/** Stripe's own error for a request it refused, as the SDK throws it. */
type RawError = ConstructorParameters<typeof Stripe.errors.StripeInvalidRequestError>[0];
export function stripeRefusal(message: string, extra: { code?: string; statusCode?: number; type?: "invalid_request_error" | "idempotency_error" } = {}): Error {
  const raw: RawError = { message, type: extra.type ?? "invalid_request_error", code: extra.code, statusCode: extra.statusCode ?? 400 };
  return raw.type === "idempotency_error" ? new Stripe.errors.StripeIdempotencyError(raw) : new Stripe.errors.StripeInvalidRequestError(raw);
}

/** Stripe's answer for an object that does not exist, or is another account's. */
const missing = (what: string, id: string) => stripeRefusal(`No such ${what}: '${id}'`, { code: "resource_missing", statusCode: 404 });

/** A copy of what the stand-in keeps, as Stripe shows it: without the stand-in's own field (the account an object is on, an endpoint's secret). */
const without = (kept: Record<string, unknown>, field: string): Record<string, unknown> => {
  const copy = structuredClone(kept);
  delete copy[field];
  return copy;
};

/** A list the SDK pages through with `for await`. */
const pages = <T>(items: T[]) => ({
  data: items,
  async *[Symbol.asyncIterator]() {
    for (const item of items) yield item;
  },
});

function standIn() {
  const tag = Date.now().toString(36);
  let next = 0;
  const id = (prefix: string) => `${prefix}_cn${tag}x${++next}`;
  const calls: StripeCall[] = [];
  /** Stripe's side of each account: what a retrieve answers. */
  const accounts = new Map<string, Side>();
  const byKey = new Map<string, string>();
  const domains = new Map<string, Set<string>>();
  /** A method's next call throws this, once. */
  const failNext = new Map<string, unknown>();
  /** Every secret Stripe handed out, so the log and the activity log can be searched for them. */
  const secrets: string[] = [];
  const refusedCapabilities = new Set<string>();
  const refusedMethods = new Set<string>();
  const refuseIdentity = { error: null as unknown };
  const configs = new Map<string, { id: string; is_default: boolean }[]>();
  let methodStates: Record<string, unknown> = {};
  const modes = new Set<string>(["test", "live"]);
  const webhooks = {
    answer: null as null | { ok: false; problem: string },
  };

  /** Checkout sessions, coupons, payment intents, refunds and invoices, each on the account it was made on. */
  const sessions = new Map<string, StandInSession>();
  const coupons = new Map<string, Json & { account: string | null }>();
  const intents = new Map<string, { id: string; account: string | null; amount: number; currency: string; refunded: number }>();
  const refunds = new Map<string, Json & { account: string | null }>();
  const invoices = new Map<string, Json & { account: string | null }>();
  /** Kaizena Flow's own subscriptions to stores (Stripe Billing on the platform's account). */
  const subscriptions = new Map<string, Json>();
  const endpoints = new Map<string, Json>();
  const destinations = new Map<string, Json>();
  /** Each idempotency key's first request and answer, per account (Stripe keeps keys per account). */
  const idempotent = new Map<string, { params: string; answer: unknown }>();
  /** What a refund's status is when Stripe answers it. */
  const refundAnswer = { status: "succeeded" as string };
  /** The secrets of stores' own keys a client was made for (payments before Connect). */
  const ownKeys: string[] = [];

  /** Once per key and account: the same parameters get the first answer back, other parameters Stripe's refusal. */
  const once = <T>(method: string, account: string | null, options: Options, params: unknown, make: () => T): T => {
    const key = options?.idempotencyKey;
    if (!key) return make();
    const where = `${method}|${account ?? ""}|${key}`;
    const seen = idempotent.get(where);
    const body = JSON.stringify(params);
    if (seen) {
      if (seen.params !== body) {
        throw stripeRefusal(
          `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`,
          { type: "idempotency_error" },
        );
      }
      return seen.answer as T;
    }
    const answer = make();
    idempotent.set(where, { params: body, answer });
    return answer;
  };

  /** What Stripe charges for a session: the lines, less an amount-off coupon, and the shipping. A trial's recurring lines are not charged now. */
  const amountOf = (params: Json, coupon: Json | null): { amount: number; currency: string } => {
    const lines = (params.line_items ?? []) as Json[];
    const trial = Number(params.subscription_data?.trial_period_days ?? 0) > 0;
    const currencies = new Set<string>();
    let subtotal = 0;
    for (const line of lines) {
      const price = line.price_data as Json | undefined;
      if (!Number.isInteger(line.quantity) || line.quantity < 1) throw stripeRefusal(`Invalid integer: ${line.quantity}`);
      if (!price) continue;
      if (!Number.isInteger(price.unit_amount) || price.unit_amount < 0) throw stripeRefusal(`Invalid integer: ${price.unit_amount}`);
      currencies.add(String(price.currency).toLowerCase());
      if (!(trial && price.recurring)) subtotal += price.unit_amount * line.quantity;
    }
    const shipping = params.shipping_options?.[0]?.shipping_rate_data?.fixed_amount as Json | undefined;
    if (shipping) {
      if (!Number.isInteger(shipping.amount) || shipping.amount < 0) throw stripeRefusal(`Invalid integer: ${shipping.amount}`);
      currencies.add(String(shipping.currency).toLowerCase());
    }
    if (coupon?.amount_off != null) currencies.add(String(coupon.currency).toLowerCase());
    if (currencies.size !== 1) throw stripeRefusal(`A Checkout session is paid in one currency; it was sent ${[...currencies].join(", ") || "none"}.`);
    const discount = coupon?.amount_off != null ? Math.min(subtotal, Number(coupon.amount_off)) : 0;
    return { amount: subtotal - discount + Number(shipping?.amount ?? 0), currency: [...currencies][0] };
  };

  const build = (mode: string | null, scope: string | null = null) => {
    const answer = (method: string, args: unknown[]) => {
      calls.push({ method, args, mode });
      if (failNext.has(method)) {
        const error = failNext.get(method);
        failNext.delete(method);
        throw error;
      }
    };
    const view = (accountId: string) => {
      const side = accounts.get(accountId);
      if (!side) throw new Error(`No such account: '${accountId}'`);
      return {
        id: accountId,
        object: "v2.core.account",
        configuration: { merchant: { capabilities: structuredClone(side.capabilities) } },
        requirements: { entries: structuredClone(side.entries) },
      };
    };
    const own = <T extends { account: string | null }>(found: T | undefined, options: Options): found is T =>
      Boolean(found) && found!.account === (options?.stripeAccount ?? scope);
    const shown = (session: StandInSession) => {
      return without(session, "account") as unknown as Stripe.Checkout.Session;
    };
    const subscriptionView = (s: Json) => structuredClone(s) as unknown as Stripe.Subscription;

    return {
      v2: {
        core: {
          accounts: {
            create: async (params: CreateParams, options: { idempotencyKey: string }) => {
              answer("accounts.create", [params, options]);
              const known = byKey.get(options.idempotencyKey);
              if (known) return view(known);
              const accountId = id("acct");
              const requested = Object.keys(params.configuration?.merchant?.capabilities ?? {});
              accounts.set(accountId, {
                capabilities: Object.fromEntries(requested.map((capability) => [capability, { status: "pending" }])),
                // An account the owner runs (full Dashboard) waits for their details; one Kaizena Flow filled in is being checked.
                entries:
                  params.dashboard === "full"
                    ? [{ awaiting_action_from: "user", description: "identity.individual.address", minimum_deadline: { status: "currently_due" } }]
                    : [],
              });
              byKey.set(options.idempotencyKey, accountId);
              return view(accountId);
            },
            retrieve: async (accountId: string, params: unknown) => {
              answer("accounts.retrieve", [accountId, params]);
              return view(accountId);
            },
            update: async (accountId: string, params: { identity?: unknown; configuration?: { merchant?: { capabilities?: Record<string, unknown> } } }) => {
              answer("accounts.update", [accountId, params]);
              if (params.identity && refuseIdentity.error) throw refuseIdentity.error;
              const asked = Object.keys(params.configuration?.merchant?.capabilities ?? {});
              if (asked.some((capability) => refusedCapabilities.has(capability))) throw new Error("A capability is not offered to this account.");
              const side = accounts.get(accountId);
              if (side) for (const capability of asked) side.capabilities[capability] ??= { status: "pending" };
              return view(accountId);
            },
          },
          eventDestinations: {
            list: (params: unknown) => {
              answer("eventDestinations.list", [params]);
              return pages([...destinations.values()].map((d) => structuredClone(d)));
            },
            del: async (destinationId: string) => {
              answer("eventDestinations.del", [destinationId]);
              destinations.delete(destinationId);
              return { id: destinationId, deleted: true };
            },
            create: async (params: Json) => {
              answer("eventDestinations.create", [params]);
              const secret = `whsec_${id("thin")}`;
              secrets.push(secret);
              const made = { id: id("ed"), ...structuredClone(params), webhook_endpoint: { url: params.webhook_endpoint?.url, signing_secret: secret } };
              destinations.set(made.id, made);
              return structuredClone(made);
            },
          },
        },
      },
      accounts: {
        createExternalAccount: async (accountId: string, params: unknown, options: unknown) => {
          answer("accounts.createExternalAccount", [accountId, params, options]);
          return { id: id("ba"), object: "bank_account" };
        },
      },
      accountSessions: {
        create: async (params: { account: string }) => {
          answer("accountSessions.create", [params]);
          const secret = `${id("accs")}_secret_${tag}`;
          secrets.push(secret);
          return { object: "account_session", account: params.account, client_secret: secret };
        },
      },
      paymentMethodDomains: {
        create: async (params: { domain_name: string }, options: { stripeAccount: string }) => {
          answer("paymentMethodDomains.create", [params, options]);
          const known = domains.get(options.stripeAccount) ?? new Set<string>();
          if (known.has(params.domain_name)) throw new Error("This domain is already registered.");
          known.add(params.domain_name);
          domains.set(options.stripeAccount, known);
          return { id: id("pmd"), domain_name: params.domain_name };
        },
        list: async (params: { domain_name: string }, options: { stripeAccount: string }) => {
          answer("paymentMethodDomains.list", [params, options]);
          return { data: domains.get(options.stripeAccount)?.has(params.domain_name) ? [{ id: id("pmd"), domain_name: params.domain_name }] : [] };
        },
      },
      paymentMethodConfigurations: {
        list: async (params: unknown, options: { stripeAccount: string }) => {
          answer("pmc.list", [params, options]);
          return { data: configs.get(options.stripeAccount) ?? [] };
        },
        update: async (configId: string, params: Record<string, unknown>, options: { stripeAccount: string }) => {
          answer("pmc.update", [configId, params, options]);
          if (Object.keys(params).some((method) => refusedMethods.has(method))) throw new Error("A payment method is not offered to this account.");
          return { id: configId, ...structuredClone(methodStates) };
        },
      },
      coupons: {
        create: async (params: Json, options: Options) => {
          answer("coupons.create", [params, options]);
          return once("coupons.create", options?.stripeAccount ?? scope, options, params, () => {
            if (params.amount_off != null && (!Number.isInteger(params.amount_off) || params.amount_off <= 0)) throw stripeRefusal(`Invalid integer: ${params.amount_off}`);
            const coupon = { id: id("coupon"), object: "coupon", account: options?.stripeAccount ?? scope, ...structuredClone(params) };
            coupons.set(coupon.id, coupon);
            return without(coupon, "account");
          });
        },
      },
      checkout: {
        sessions: {
          create: async (params: Json, options: Options) => {
            answer("checkout.sessions.create", [params, options]);
            return once("checkout.sessions.create", options?.stripeAccount ?? scope, options, params, () => {
              const account = options?.stripeAccount ?? scope;
              const couponId = params.discounts?.[0]?.coupon as string | undefined;
              const coupon = couponId ? coupons.get(couponId) : undefined;
              if (couponId && !own(coupon, options)) throw missing("coupon", couponId);
              const { amount, currency } = amountOf(params, coupon ?? null);
              const fee = params.payment_intent_data?.application_fee_amount;
              if (fee !== undefined && (!Number.isInteger(fee) || fee < 0 || fee > amount)) {
                throw stripeRefusal(`The application fee (${fee}) must be a whole number of minor units no greater than the amount (${amount}).`);
              }
              const expires = Number(params.expires_at) - Math.floor(Date.now() / 1000);
              if (params.expires_at !== undefined && (expires < 30 * 60 || expires > 24 * 60 * 60)) {
                throw stripeRefusal("The `expires_at` timestamp must be between 30 minutes and 24 hours from Checkout Session creation.");
              }
              const sessionId = id(mode === "live" ? "cs_live" : "cs_test");
              const elements = params.ui_mode === "elements";
              if (elements) secrets.push(`${sessionId}_secret_${tag}`);
              const session: StandInSession = {
                id: sessionId,
                object: "checkout.session",
                account,
                livemode: mode === "live",
                status: "open",
                payment_status: amount === 0 ? "no_payment_required" : "unpaid",
                mode: params.mode,
                amount_total: amount,
                currency,
                metadata: structuredClone(params.metadata ?? {}),
                client_reference_id: params.client_reference_id ?? null,
                url: elements ? null : `https://checkout.stripe.test/c/pay/${sessionId}`,
                client_secret: elements ? `${sessionId}_secret_${tag}` : null,
                payment_method_types: ["card", "klarna", "mobilepay"],
                payment_intent: null,
                invoice: null,
                customer_details: null,
                collected_information: null,
              };
              sessions.set(sessionId, session);
              return shown(session);
            });
          },
          retrieve: async (sessionId: string, params?: unknown, options?: Options) => {
            answer("checkout.sessions.retrieve", [sessionId, params, options]);
            const session = sessions.get(sessionId);
            if (!own(session, options)) throw missing("checkout.session", sessionId);
            return shown(session);
          },
          expire: async (sessionId: string, params?: unknown, options?: Options) => {
            answer("checkout.sessions.expire", [sessionId, params, options]);
            const session = sessions.get(sessionId);
            if (!own(session, options)) throw missing("checkout.session", sessionId);
            if (session.status !== "open") throw stripeRefusal(`Only Checkout Sessions with a status in ["open"] can be expired. This one is ${session.status}.`);
            session.status = "expired";
            return shown(session);
          },
        },
      },
      refunds: {
        create: async (params: Json, options: Options) => {
          answer("refunds.create", [params, options]);
          return once("refunds.create", options?.stripeAccount ?? scope, options, params, () => {
            const intent = intents.get(String(params.payment_intent));
            if (!own(intent, options)) throw missing("payment_intent", String(params.payment_intent));
            const amount = params.amount ?? intent.amount - intent.refunded;
            if (!Number.isInteger(amount) || amount <= 0) throw stripeRefusal(`Invalid integer: ${amount}`);
            if (amount > intent.amount - intent.refunded) {
              throw stripeRefusal(`Refund amount (${amount}) is greater than unrefunded amount on charge (${intent.amount - intent.refunded}).`, { code: "amount_too_large" });
            }
            if (refundAnswer.status !== "failed" && refundAnswer.status !== "canceled") intent.refunded += amount;
            const refund = { id: id("re"), object: "refund", account: intent.account, amount, currency: intent.currency, status: refundAnswer.status, payment_intent: intent.id, metadata: structuredClone(params.metadata ?? {}) };
            refunds.set(refund.id, refund);
            return without(refund, "account");
          });
        },
      },
      invoices: {
        retrieve: async (invoiceId: string, params?: unknown, options?: Options) => {
          answer("invoices.retrieve", [invoiceId, params, options]);
          const invoice = invoices.get(invoiceId);
          if (!own(invoice, options)) throw missing("invoice", invoiceId);
          return without(invoice, "account");
        },
      },
      subscriptions: {
        retrieve: async (subscriptionId: string, params?: unknown) => {
          answer("subscriptions.retrieve", [subscriptionId, params]);
          const found = subscriptions.get(subscriptionId);
          if (!found) throw missing("subscription", subscriptionId);
          return subscriptionView(found);
        },
        update: async (subscriptionId: string, params: Json) => {
          answer("subscriptions.update", [subscriptionId, params]);
          const found = subscriptions.get(subscriptionId);
          if (!found) throw missing("subscription", subscriptionId);
          for (const item of (params.items ?? []) as Json[]) {
            const at = found.items.data.findIndex((existing: Json) => existing.id === item.id);
            if (at >= 0 && item.price) found.items.data[at].price = { id: item.price };
          }
          if (typeof params.cancel_at_period_end === "boolean") found.cancel_at_period_end = params.cancel_at_period_end;
          if (params.metadata) found.metadata = structuredClone(params.metadata);
          return subscriptionView(found);
        },
        cancel: async (subscriptionId: string, params?: unknown) => {
          answer("subscriptions.cancel", [subscriptionId, params]);
          const found = subscriptions.get(subscriptionId);
          if (!found) throw missing("subscription", subscriptionId);
          found.status = "canceled";
          return subscriptionView(found);
        },
      },
      webhookEndpoints: {
        list: (params: unknown) => {
          answer("webhookEndpoints.list", [params]);
          return pages([...endpoints.values()].map((e) => structuredClone(e)));
        },
        del: async (endpointId: string) => {
          answer("webhookEndpoints.del", [endpointId]);
          endpoints.delete(endpointId);
          return { id: endpointId, deleted: true };
        },
        create: async (params: Json) => {
          answer("webhookEndpoints.create", [params]);
          const secret = `whsec_${id("we")}`;
          secrets.push(secret);
          const made = { id: id("we"), object: "webhook_endpoint", ...structuredClone(params), secret };
          endpoints.set(made.id, made);
          return structuredClone(made);
        },
        retrieve: async (endpointId: string) => {
          answer("webhookEndpoints.retrieve", [endpointId]);
          const found = endpoints.get(endpointId);
          if (!found) throw missing("webhook_endpoint", endpointId);
          return without(found, "secret");
        },
        update: async (endpointId: string, params: Json) => {
          answer("webhookEndpoints.update", [endpointId, params]);
          const found = endpoints.get(endpointId);
          if (!found) throw missing("webhook_endpoint", endpointId);
          Object.assign(found, structuredClone(params));
          return without(found, "secret");
        },
      },
      /** Checked with Stripe's own code by a test that needs it: a signature is verified as in production. */
      parseEventNotification: (() => {
        throw new Error("set by the test");
      }) as (body: string, signature: string, secret: string) => unknown,
    };
  };

  /** The client the Connect tests use for both modes (its calls carry no mode). */
  const client = build(null);
  const byMode = { test: build("test"), live: build("live") };

  /** A session's buyer, as Stripe's form collects them. */
  type Buyer = { email: string; name: string; address?: { line1: string; postal_code: string; city: string; country: string } };
  const complete = (sessionId: string, buyer: Buyer, paymentStatus: "paid" | "unpaid") => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`No session ${sessionId}`);
    const address = buyer.address ? { line1: buyer.address.line1, line2: null, postal_code: buyer.address.postal_code, city: buyer.address.city, country: buyer.address.country, state: null } : null;
    session.status = "complete";
    session.payment_status = paymentStatus;
    session.customer_details = { email: buyer.email, name: buyer.name, phone: null, address };
    if (address) session.collected_information = { shipping_details: { name: buyer.name, address } };
    return session;
  };

  return {
    tag,
    id,
    calls,
    accounts,
    domains,
    failNext,
    secrets,
    refusedCapabilities,
    refusedMethods,
    refuseIdentity,
    configs,
    setMethodStates: (states: Record<string, unknown>) => void (methodStates = states),
    modes,
    webhooks,
    client,
    callsOf: (method: string) => calls.filter((call) => call.method === method),
    sessions,
    coupons,
    intents,
    refunds,
    invoices,
    subscriptions,
    endpoints,
    destinations,
    refundAnswer,
    ownKeys,
    /** `platformStripe(mode)`: the mode's client while the platform has its keys, else null. */
    platform: (mode: string) => (modes.has(mode) && (mode === "test" || mode === "live") ? (byMode[mode] as unknown as Stripe) : null),
    /** `stripeFor(secret)`: a store's own keys, before Connect (on no connected account: what it makes is found with that key alone). */
    ownKey: (secret: string) => {
      ownKeys.push(secret);
      return build("own", `key:${secret}`) as unknown as Stripe;
    },
    /** The buyer paid on Stripe's page: the session is complete and paid, with a payment intent on its account for what it charged. */
    pay: (sessionId: string, buyer: Buyer) => {
      const session = complete(sessionId, buyer, "paid");
      const intent = { id: id("pi"), account: session.account, amount: session.amount_total, currency: String(session.currency), refunded: 0 };
      intents.set(intent.id, intent);
      session.payment_intent = intent.id;
      return session;
    },
    /** The buyer finished, but the money is on its way (a bank payment): complete and unpaid. */
    finish: (sessionId: string, buyer: Buyer) => complete(sessionId, buyer, "unpaid"),
    /** A subscription's first payment, as Stripe makes it: the session names an invoice (no payment intent), whose payment is the one paid. */
    payByInvoice: (sessionId: string, buyer: Buyer) => {
      const session = complete(sessionId, buyer, "paid");
      const intent = { id: id("pi"), account: session.account, amount: session.amount_total, currency: String(session.currency), refunded: 0 };
      intents.set(intent.id, intent);
      const invoice = {
        id: id("in"),
        object: "invoice",
        account: session.account,
        payments: { data: [{ status: "canceled", payment: { payment_intent: id("pi") } }, { status: "paid", payment: { payment_intent: intent.id } }] },
      };
      invoices.set(invoice.id, invoice);
      session.invoice = invoice.id;
      return { session, invoice: invoice.id, intent: intent.id };
    },
    /** A payment intent of its own on an account (a no-show fee, D66). */
    intent: (account: string, amount: number, currency: string) => {
      const intent = { id: id("pi"), account, amount, currency, refunded: 0 };
      intents.set(intent.id, intent);
      return intent.id;
    },
    /** A store's subscription to a plan on Kaizena Flow's own account, as Stripe holds it. */
    subscription: (price: string, metadata: Record<string, string>, status = "active") => {
      const made = {
        id: id("sub"),
        object: "subscription",
        status,
        cancel_at_period_end: false,
        metadata,
        discounts: [],
        items: { data: [{ id: id("si"), price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 20 * 86_400 }] },
      };
      subscriptions.set(made.id, made);
      return made.id;
    },
  };
}

/** The stand-in of the test file that imports it. */
export const stripe = standIn();
