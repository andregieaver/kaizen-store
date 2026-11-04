import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { APP_TOPICS } from "./apps";
import { APP_EVENTS, EVENTS, isAppEvent, isServiceEvent } from "./integrations";
import { ID_HEADER, PAYLOAD_VERSION, SIGNATURE_HEADER, signWebhook, TIMESTAMP_HEADER, TOLERANCE_SECONDS, TOPIC_HEADER, verifyWebhook } from "./webhook-signature";
import { topicOf, WEBHOOK_SUBJECTS, WEBHOOK_TEST_DATA, WEBHOOK_TOPICS, webhookCatalogue, webhookEnvelope, webhookOpenApi } from "./webhook-topics";

/** The webhook topics' contracts (D438): every event of `EVENTS` typed, its receivers as the services and endpoints get it, and the catalogue. */
describe("WEBHOOK_TOPICS", () => {
  it("is every event, in order, with who may be sent it", () => {
    expect(WEBHOOK_TOPICS.map((t) => t.id)).toEqual([...EVENTS, ...APP_EVENTS].map((e) => e.id));
    for (const topic of WEBHOOK_TOPICS) {
      // An app is sent a topic it chose whose area its installation reads (D441), and its own two whatever it chose; never a service or an owner.
      const expected = isAppEvent(topic.id)
        ? ["apps"]
        : [...(isServiceEvent(topic.id) ? ["services"] : []), "endpoints", ...(APP_TOPICS.includes(topic.id) ? ["apps"] : [])];
      expect(topic.receivers, topic.id).toEqual(expected);
      // The data holds the subject under its own name, and nothing else.
      expect(Object.keys(topic.data.shape), topic.id).toEqual([topic.subject]);
      expect(topic.description.length).toBeGreaterThan(10);
    }
    expect(topicOf("order.paid")?.subject).toBe("order");
    expect(topicOf("test")).toBeUndefined();
  });

  it("types each subject as its builder makes it", () => {
    const order = {
      id: "00000000-0000-4000-8000-000000000000",
      number: "1001",
      status: "paid",
      placed_at: "2026-01-01T12:00:00.000Z",
      market: "NO",
      currency: "NOK",
      email: "customer@example.com",
      customer_name: "Sample Customer",
      subtotal: 398,
      shipping: 99,
      discount: 0,
      credits_used: 0,
      referral_discount: 0,
      discount_code: "",
      vat: 99.4,
      vat_kind: "standard",
      vat_relief: 0,
      total: 497,
      refunded: 0,
      shipping_address: { name: "A", line1: "B", line2: "", postal_code: "0150", city: "Oslo", country: "NO", phone: "" },
      billing_address: { name: "A", line1: "B", line2: "", postal_code: "0150", city: "Oslo", country: "NO", phone: "" },
      lines: [{ sku: "SAMPLE-1", title: "Sample product", quantity: 2, unit_price: 199, total: 398, delivery: "physical" }],
      shipment: null,
      subscription_id: null,
      admin_url: "",
    };
    expect(WEBHOOK_SUBJECTS.order.safeParse(order).success).toBe(true);
    expect(WEBHOOK_TEST_DATA.safeParse({ test: true, order }).success).toBe(true);
    // A field that is missing, or of another type, is a drift the check finds.
    const { vat_kind: _gone, ...older } = order;
    void _gone;
    expect(WEBHOOK_SUBJECTS.order.safeParse(older).success).toBe(false);
    expect(WEBHOOK_SUBJECTS.support.safeParse({ waiting: "2", admin_url: "" }).success).toBe(false);
  });
});

describe("the topics' catalogue", () => {
  const catalogue = webhookCatalogue();

  it("publishes every topic's payload, the version, the headers and the retries", () => {
    expect(catalogue.version).toBe(PAYLOAD_VERSION);
    expect(catalogue.topics.map((t) => t.id)).toEqual([...EVENTS, ...APP_EVENTS].map((e) => e.id));
    expect(catalogue.headers.map((h) => h.name)).toEqual([ID_HEADER, TIMESTAMP_HEADER, TOPIC_HEADER, SIGNATURE_HEADER]);
    expect(catalogue.signature).toMatchObject({ algorithm: "HMAC-SHA256", header: SIGNATURE_HEADER, tolerance_seconds: TOLERANCE_SECONDS });
    expect(catalogue.description).toContain("1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours");
    expect(catalogue.topics.find((t) => t.id === "stock.low")?.data).toMatchObject({ properties: { stock: { properties: { sku: { type: "string" } } } }, required: ["stock"] });
    expect(JSON.stringify(catalogue)).not.toMatch(/whsec_|kf_[A-Za-z0-9]/);
  });

  it("says how to check a signature in steps that check what verifyWebhook checks", () => {
    // Follow the published steps by hand, as a receiver in another language would with its own HMAC.
    const secret = "whsec_receiver";
    const body = JSON.stringify({ id: "d", topic: "order.paid", version: 1, store: { slug: "s", name: "S" }, created_at: "2026-11-03T10:00:00.000Z", data: {} });
    const timestamp = 1_800_000_000;
    const header = `v1=deadbeef, ${signWebhook(secret, timestamp, body)}`;
    const step = catalogue.signature;
    expect(step.signed).toBe("{timestamp}.{body}");
    const mine = `v1=${createHmac("sha256", secret).update(step.signed.replace("{timestamp}", String(timestamp)).replace("{body}", body)).digest("hex")}`;
    expect(header.split(/[ ,]+/)).toContain(mine);
    expect(verifyWebhook({ secret, signature: header, timestamp: String(timestamp), body, now: timestamp + TOLERANCE_SECONDS })).toBe(true);
    expect(step.steps.join(" ")).toContain(`${TOLERANCE_SECONDS} seconds`);
  });

  it("is the OpenAPI document's webhooks: each a POST of its envelope", () => {
    const hooks = webhookOpenApi() as Record<string, { post: { requestBody: { content: { "application/json": { schema: { properties: Record<string, { const?: unknown }> } } } } } }>;
    expect(Object.keys(hooks)).toEqual([...EVENTS, ...APP_EVENTS].map((e) => e.id));
    const schema = hooks["order.sent"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(schema.properties)).toEqual(["id", "topic", "version", "store", "created_at", "data"]);
    expect(schema.properties.topic.const).toBe("order.sent");
    expect(schema.properties.version.const).toBe(PAYLOAD_VERSION);
    expect(webhookEnvelope(z.literal("x"), z.object({})).safeParse({ id: "00000000-0000-4000-8000-000000000000", topic: "x", version: 1, store: { slug: "a", name: "A" }, created_at: "2026-11-03T10:00:00.000Z", data: {} }).success).toBe(true);
  });
});
