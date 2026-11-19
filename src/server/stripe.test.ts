import { describe, expect, it, vi } from "vitest";

/**
 * Kaizena Flow's own Stripe client and webhooks (`src/server/stripe.ts`; code review 1.9's next, FH9, D811): a mode's client is made with that
 * mode's key alone and Stripe's pinned API version, and `createPlatformWebhooks()` makes the three endpoints Stripe tells Kaizena Flow of payments,
 * accounts and plans through, replacing only earlier ones at the same addresses. A store's payment is applied only when its event arrives at the
 * snapshot endpoint (`connect: true`, every payment event), so what it is made with is money.
 *
 * Stripe is the stand-in of `stripe-test-support.ts`, handed out by the SDK's constructor (mocked); the platform's keys are the test's.
 */

vi.mock("server-only", () => ({}));
const keys = vi.hoisted(() => ({ test: "sk_test_platform" as string | null, live: "sk_live_platform" as string | null }));
vi.mock("./stripe-keys", () => ({
  platformModes: () => (["test", "live"] as const).filter((mode) => keys[mode]),
  platformPublishableKey: (mode: "test" | "live") => `pk_${mode}_x`,
  platformSecretKey: (mode: "test" | "live") => keys[mode],
}));
/** Every client the SDK was asked to build: the key and the options. */
const built = vi.hoisted(() => ({ clients: [] as { key: string; options: Record<string, unknown> }[], answer: null as null | ((key: string) => unknown) }));
vi.mock("stripe", async (importActual) => {
  const actual = await importActual<typeof import("stripe")>();
  function Stripe(key: string, options: Record<string, unknown>) {
    built.clients.push({ key, options });
    return built.answer!(key);
  }
  Object.assign(Stripe, actual.default);
  return { ...actual, default: Stripe };
});

const { stripe, stripeRefusal } = await import("./stripe-test-support");
built.answer = (key) => stripe.platform(key.startsWith("sk_live") ? "live" : "test");
const { platformStripe, createPlatformWebhooks, STRIPE_API_VERSION, WEBHOOK_EVENTS, BILLING_EVENTS, ACCOUNT_EVENTS } = await import("./stripe");

const origin = "https://kaizenaflow.test";

describe("Kaizena Flow's Stripe client per mode (platformStripe)", () => {
  it("builds a mode's client with that mode's key and the pinned API version, once, and none without the key", () => {
    const live = platformStripe("live");
    expect(live).toBe(stripe.platform("live"));
    expect(platformStripe("live")).toBe(live);
    expect(built.clients.filter((c) => c.key === "sk_live_platform")).toHaveLength(1);
    expect(built.clients.at(-1)?.options).toMatchObject({ apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 15_000 });
    expect(platformStripe("test")).toBe(stripe.platform("test"));
    // Without live keys there is no live client: never the test one in its place.
    keys.live = null;
    try {
      expect(platformStripe("live")).toBeNull();
    } finally {
      keys.live = "sk_live_platform";
    }
  });
});

describe("the platform's webhooks (createPlatformWebhooks)", () => {
  it("makes the three endpoints with every payment, account and plan event, at Kaizena Flow's addresses, and returns their secrets", async () => {
    const result = await createPlatformWebhooks("live", origin);
    if (!result.ok) throw new Error(result.problem);
    const made = stripe.callsOf("webhookEndpoints.create").map((call) => ({ params: call.args[0], mode: call.mode }));
    expect(made).toEqual([
      {
        mode: "live",
        params: { url: `${origin}/api/stripe/connect/live`, connect: true, api_version: STRIPE_API_VERSION, enabled_events: WEBHOOK_EVENTS, description: expect.any(String) },
      },
      { mode: "live", params: { url: `${origin}/api/stripe/billing/live`, api_version: STRIPE_API_VERSION, enabled_events: BILLING_EVENTS, description: expect.any(String) } },
    ]);
    // A store's payment completes, lapses, is refunded or disputed only through these events.
    for (const event of ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "refund.updated", "charge.dispute.created", "payment_intent.canceled"]) {
      expect(WEBHOOK_EVENTS).toContain(event);
    }
    expect(stripe.callsOf("eventDestinations.create").at(-1)?.args[0]).toMatchObject({
      type: "webhook_endpoint",
      event_payload: "thin",
      events_from: ["other_accounts"],
      enabled_events: ACCOUNT_EVENTS,
      webhook_endpoint: { url: `${origin}/api/stripe/connect/live/accounts` },
    });
    const secretOf = (url: string) => [...stripe.endpoints.values(), ...[...stripe.destinations.values()].map((d) => ({ url: d.webhook_endpoint.url, secret: d.webhook_endpoint.signing_secret }))].find((e) => e.url === url)?.secret;
    expect(result.webhooks).toEqual([
      { kind: "snapshot", endpointId: expect.stringMatching(/^we_/), url: `${origin}/api/stripe/connect/live`, secret: secretOf(`${origin}/api/stripe/connect/live`) },
      { kind: "thin", endpointId: expect.stringMatching(/^ed_/), url: `${origin}/api/stripe/connect/live/accounts`, secret: secretOf(`${origin}/api/stripe/connect/live/accounts`) },
      { kind: "billing", endpointId: expect.stringMatching(/^we_/), url: `${origin}/api/stripe/billing/live`, secret: secretOf(`${origin}/api/stripe/billing/live`) },
    ]);
  });

  it("replaces the endpoints at its own addresses when connected again, and leaves every other endpoint alone", async () => {
    const elsewhere = await (stripe.platform("live") as unknown as { webhookEndpoints: { create: (p: object) => Promise<{ id: string }> } }).webhookEndpoints.create({ url: "https://books.example/stripe", enabled_events: ["invoice.paid"] });
    const before = [...stripe.endpoints.keys()];
    const result = await createPlatformWebhooks("live", origin);
    expect(result.ok).toBe(true);
    const urls = [...stripe.endpoints.values()].map((e) => e.url).sort();
    expect(urls).toEqual([`${origin}/api/stripe/billing/live`, `${origin}/api/stripe/connect/live`, "https://books.example/stripe"].sort());
    expect(stripe.endpoints.has(elsewhere.id)).toBe(true);
    expect(before.filter((id) => id !== elsewhere.id).some((id) => stripe.endpoints.has(id))).toBe(false);
    expect([...stripe.destinations.values()].map((d) => d.webhook_endpoint.url)).toEqual([`${origin}/api/stripe/connect/live/accounts`]);
  });

  it("makes each mode's endpoints on that mode's account", async () => {
    const mark = stripe.calls.length;
    expect((await createPlatformWebhooks("test", origin)).ok).toBe(true);
    const asked = stripe.calls.slice(mark);
    expect(new Set(asked.map((call) => call.mode))).toEqual(new Set(["test"]));
    expect(asked.filter((call) => call.method === "webhookEndpoints.create").map((call) => (call.args[0] as { url: string }).url)).toEqual([
      `${origin}/api/stripe/connect/test`,
      `${origin}/api/stripe/billing/test`,
    ]);
  });

  it("refuses without the mode's key, says what Stripe refused, and says when Stripe gave no secret", async () => {
    keys.test = null;
    try {
      expect(await createPlatformWebhooks("test", origin)).toEqual({ ok: false, problem: "No test secret key is configured." });
    } finally {
      keys.test = "sk_test_platform";
    }
    stripe.failNext.set("webhookEndpoints.create", stripeRefusal("Invalid URL: the address must be public."));
    expect(await createPlatformWebhooks("live", origin)).toEqual({ ok: false, problem: "Invalid URL: the address must be public." });
    stripe.failNext.set("eventDestinations.create", new Error("socket hang up"));
    expect(await createPlatformWebhooks("live", origin)).toEqual({ ok: false, problem: "Stripe could not be reached." });
    const client = stripe.platform("live") as unknown as { webhookEndpoints: { create: (p: object) => Promise<Record<string, unknown>> } };
    const create = client.webhookEndpoints.create;
    client.webhookEndpoints.create = async (params: object) => ({ ...(await create(params)), secret: undefined });
    try {
      expect(await createPlatformWebhooks("live", origin)).toEqual({ ok: false, problem: "Stripe did not return a signing secret." });
    } finally {
      client.webhookEndpoints.create = create;
    }
  });
});
