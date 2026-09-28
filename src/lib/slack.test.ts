import { describe, expect, it } from "vitest";

import { escapeSlack, slackLink, slackMessage } from "./slack";

const store = { slug: "kaffe", name: "Kaffe & Co" };
const order = {
  number: "1001",
  status: "paid",
  market: "NO",
  currency: "NOK",
  email: "kari@example.com",
  customer_name: "Kari Nordmann",
  total: 497,
  refunded: 0,
  shipping_address: { line1: "Storgata 1", city: "Oslo" },
  lines: [{ title: "Handlenett", quantity: 2, total: 398 }],
  shipment: null,
  admin_url: "https://kaizenstore.cloud/admin/kaffe/orders/abc",
};
/** Intl writes amounts with no-break spaces; the tests compare plain ones. */
const spaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
const all = (message: ReturnType<typeof slackMessage>) => spaces(JSON.stringify(message));
const text = (message: ReturnType<typeof slackMessage>) => spaces(message!.text);

describe("Slack messages (D101)", () => {
  it("tell of a new order with its amount, products and a link to it, in the store's locale", () => {
    const message = slackMessage({ event: "order.paid", store, order }, "nb-NO")!;
    expect(text(message)).toBe("New order #1001 · 497,00 kr · Kari Nordmann");
    expect(all({ ...message, blocks: [message.blocks[0]] })).toContain(
      '"text":{"type":"mrkdwn","text":"*New order <https://kaizenstore.cloud/admin/kaffe/orders/abc|#1001>*\\n497,00 kr from Kari Nordmann · NO"}',
    );
    expect(all(message)).toContain("• 2 × Handlenett  398,00 kr");
    expect(all(message)).toContain("Kaffe &amp; Co · <https://kaizenstore.cloud/admin/kaffe/orders/abc|Open the order in Kaizen>");
    expect(message.unfurl_links).toBe(false);
  });

  it("never carry the shopper's email or address", () => {
    const message = all(slackMessage({ event: "order.paid", store, order }, "nb-NO"));
    expect(message).not.toContain("kari@example.com");
    expect(message).not.toContain("Storgata");
  });

  it("escape what shoppers and staff wrote, so it cannot link or mention", () => {
    const message = slackMessage(
      {
        event: "order.paid",
        store,
        order: { ...order, customer_name: "<!channel> <https://evil.example|click>", lines: [{ title: "A & <b>", quantity: 1, total: 1 }] },
      },
      "en-GB",
    )!;
    const written = all(message);
    expect(written).not.toContain("<!channel>");
    expect(written).not.toContain("<https://evil.example");
    expect(written).toContain("&lt;!channel&gt;");
    expect(written).toContain("A &amp; &lt;b&gt;");
    expect(escapeSlack("a<b>&")).toBe("a&lt;b&gt;&amp;");
  });

  it("link only to web addresses that stay inside the link", () => {
    expect(slackLink("https://posten.no/track?id=1&x=2", "TRACK1")).toBe("<https://posten.no/track?id=1&amp;x=2|TRACK1>");
    expect(slackLink("javascript:alert(1)", "TRACK1")).toBe("TRACK1");
    expect(slackLink("mailto:kari@example.com", "TRACK1")).toBe("TRACK1");
    expect(slackLink("https://a.example/|x>", "TRACK1")).toBe("TRACK1");
    expect(slackLink(null, "<b>")).toBe("&lt;b&gt;");
  });

  it("tell of a sent order with its tracking, and of refunds and cancellations", () => {
    const sent = slackMessage(
      { event: "order.sent", store, order: { ...order, shipment: { carrier: "Posten", tracking_number: "TRACK1", tracking_url: "https://sporing.posten.no/TRACK1" } } },
      "nb-NO",
    )!;
    expect(text(sent)).toBe("Order #1001 sent");
    expect(all(sent)).toContain("Posten · <https://sporing.posten.no/TRACK1|TRACK1>");
    expect(all(sent)).not.toContain("Handlenett");
    expect(text(slackMessage({ event: "order.refunded", store, order: { ...order, refunded: 100 } }, "nb-NO"))).toBe(
      "Order #1001 refunded · 100,00 kr of 497,00 kr",
    );
    expect(text(slackMessage({ event: "order.cancelled", store, order }, "nb-NO"))).toBe("Order #1001 cancelled · 497,00 kr");
  });

  it("mark a test as one", () => {
    const test = slackMessage({ event: "test", test: true, store, order }, "nb-NO")!;
    expect(text(test)).toBe("Test: New order #1001 · 497,00 kr · Kari Nordmann");
    expect(all(test)).toContain("Handlenett");
  });

  it("tell of new customers by name only, and of subscriptions", () => {
    const customer = slackMessage(
      { event: "customer.created", store, customer: { name: "Ola", email: "ola@example.com", admin_url: "https://kaizenstore.cloud/admin/kaffe/customers/1" } },
      "nb-NO",
    )!;
    expect(text(customer)).toBe("New customer account: Ola");
    expect(all(customer)).not.toContain("ola@example.com");
    expect(text(slackMessage({ event: "customer.created", store, customer: { name: "" } }, "nb-NO"))).toBe("New customer account");
    const subscription = { number: "S1", currency: "EUR", total_per_renewal: 19.9, every: "1 month", admin_url: "https://kaizenstore.cloud/admin/kaffe/subscriptions/1" };
    expect(text(slackMessage({ event: "subscription.started", store, subscription }, "en-IE"))).toBe("Subscription #S1 started · €19.90 every month");
    expect(text(slackMessage({ event: "subscription.cancelled", store, subscription: { ...subscription, every: "3 week" } }, "en-IE"))).toBe(
      "Subscription #S1 cancelled · €19.90 every 3 weeks",
    );
  });

  it("keep long orders short", () => {
    const lines = Array.from({ length: 14 }, (_, i) => ({ title: `Item ${i}`, quantity: 1, total: 1 }));
    const written = all(slackMessage({ event: "order.paid", store, order: { ...order, lines } }, "nb-NO"));
    expect(written).toContain("Item 9");
    expect(written).not.toContain("Item 10");
    expect(written).toContain("…and 4 more");
  });

  it("say nothing of events it does not know", () => {
    expect(slackMessage({ event: "order.paid", store }, "nb-NO")).toBeNull();
    expect(slackMessage({ event: "something.else", store }, "nb-NO")).toBeNull();
  });
});
