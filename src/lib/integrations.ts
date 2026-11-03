/**
 * Integrations (D41): the automation services a store can connect, the
 * store events Kaizen sends them, and the webhook addresses each accepts.
 * Slack (D101) takes the same events as messages in a channel.
 */

export type Provider = "zapier" | "make" | "slack";

export type IntegrationInfo = {
  id: Provider | "tripletex";
  name: string;
  /** What connecting it does, in a line. */
  summary: string;
  /** Not yet available: listed, but cannot be set up. */
  comingSoon?: boolean;
  /** Where the owner makes the webhook address, step by step. */
  steps?: string[];
  /** An example address, for the field's placeholder. */
  example?: string;
  docs?: string;
};

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    id: "zapier",
    name: "Zapier",
    summary: "Send orders, customers and subscriptions to thousands of apps, such as Google Sheets, Slack, Mailchimp or your accounts.",
    steps: [
      "In Zapier, make a new Zap.",
      "Choose Webhooks by Zapier as the trigger, and Catch Hook as the event.",
      "Copy the webhook URL Zapier shows, and paste it below.",
      "Save, then send a test so Zapier can see what Kaizena Flow sends.",
    ],
    example: "https://hooks.zapier.com/hooks/catch/1234567/abcdefg/",
    docs: "https://help.zapier.com/hc/en-us/articles/8496288690317",
  },
  {
    id: "make",
    name: "Make",
    summary: "Send orders, customers and subscriptions to your Make scenarios, and on to the apps you use.",
    steps: [
      "In Make, make a new scenario.",
      "Add the Webhooks module Custom webhook as the first step, and add a webhook.",
      "Copy the address Make shows, and paste it below.",
      "Save, then send a test so Make can learn what Kaizena Flow sends.",
    ],
    example: "https://hook.eu2.make.com/abcdefghijklmnopqrstuvwxyz123456",
    docs: "https://www.make.com/en/help/tools/webhooks",
  },
  {
    id: "slack",
    name: "Slack",
    summary: "Get a message in a Slack channel when an order is paid, sent, cancelled or refunded, and for new customers and subscriptions.",
    steps: [
      "At api.slack.com/apps, choose Create New App, From scratch, and pick your workspace.",
      "Under Incoming Webhooks, switch them on and choose Add New Webhook to Workspace.",
      "Pick the channel for Kaizena Flow's messages and allow it.",
      "Copy the webhook URL Slack shows, paste it below, and send a test.",
    ],
    example: "https://hooks.slack.com/services/…",
    docs: "https://api.slack.com/messaging/webhooks",
  },
  {
    id: "tripletex",
    name: "Tripletex",
    summary: "Orders, customers and payments straight into your Norwegian accounting.",
    comingSoon: true,
  },
];

export const PROVIDERS: Provider[] = ["zapier", "make", "slack"];

export const isProvider = (value: string): value is Provider => (PROVIDERS as string[]).includes(value);

export type IntegrationEvent =
  | "order.paid"
  | "order.sent"
  | "order.cancelled"
  | "order.refunded"
  | "customer.created"
  | "subscription.started"
  | "subscription.cancelled"
  | "support.waiting"
  // D354: for an owner's own endpoints (and the services, when chosen).
  | "return.requested"
  | "withdrawal.received"
  | "product.created"
  | "product.updated"
  | "stock.low"
  | "discount.created"
  // D440 (wave 14 unit C): for an owner's own endpoints only.
  | "inventory.updated"
  | "product.archived"
  | "order.created"
  | "order.updated"
  | "fulfilment.created"
  | "fulfilment.updated"
  | "refund.created"
  | "return.updated"
  | "quote.requested"
  | "draft.sent"
  | "customer.updated"
  | "customer.erased"
  | "subscription.renewed"
  | "subscription.payment_failed"
  | "gift_card.issued"
  | "review.created";

export const EVENTS: { id: IntegrationEvent; label: string; hint: string }[] = [
  { id: "order.paid", label: "Order paid", hint: "A shopper paid, or a subscription renewed." },
  { id: "order.sent", label: "Order sent", hint: "An order was marked as sent, with its tracking." },
  { id: "order.cancelled", label: "Order cancelled", hint: "A paid order was cancelled." },
  { id: "order.refunded", label: "Order refunded", hint: "Money went back to the shopper, in full or in part." },
  { id: "customer.created", label: "New customer account", hint: "A shopper made an account." },
  { id: "subscription.started", label: "Subscription started", hint: "A subscription's first payment went through." },
  { id: "subscription.cancelled", label: "Subscription cancelled", hint: "A subscription was cancelled." },
  { id: "return.requested", label: "Return requested", hint: "A shopper or staff started a return, or a withdrawal's return." },
  { id: "withdrawal.received", label: "Withdrawal received", hint: "A shopper confirmed that they withdraw from a purchase." },
  { id: "product.created", label: "Product created", hint: "A product was made, by hand, an import or the AI manager." },
  { id: "product.updated", label: "Product changed", hint: "A product was saved." },
  { id: "stock.low", label: "Stock low", hint: "A variant's stock fell to its low-stock level." },
  { id: "discount.created", label: "Discount code created", hint: "A discount code was made." },
  { id: "inventory.updated", label: "Stock changed", hint: "A variant's stock on hand moved at a location: one event per variant and minute, with its stock as it is then." },
  { id: "product.archived", label: "Product archived", hint: "A product was put away: off the site and out of the admin's lists." },
  { id: "order.created", label: "Order created", hint: "An order was made, paid or still waiting for payment: at checkout, from a draft or by a subscription." },
  { id: "order.updated", label: "Order edited", hint: "A change to an order's lines or prices was applied (D174)." },
  { id: "fulfilment.created", label: "Parcel sent", hint: "A parcel of an order was recorded, with its carrier and tracking." },
  { id: "fulfilment.updated", label: "Parcel changed", hint: "A parcel's tracking moved on, its tracking number changed, or it was undone." },
  { id: "refund.created", label: "Refund made", hint: "Money went back to a customer, to the payment or as store credit: the refund itself." },
  { id: "return.updated", label: "Return changed", hint: "A return moved on: approved, declined, on its way, received, inspected, closed or cancelled." },
  { id: "quote.requested", label: "Quote requested", hint: "A shopper asked for a quote: a draft order to price and send." },
  { id: "draft.sent", label: "Draft order sent", hint: "A draft order or quote was sent to the customer with its pay link." },
  { id: "customer.updated", label: "Customer changed", hint: "A customer's name, email, phone, address or company was changed, by them or by staff." },
  { id: "customer.erased", label: "Customer erased", hint: "A customer's account was erased at their request (D162): only its id, so you can erase what you keep too." },
  { id: "subscription.renewed", label: "Subscription renewed", hint: "A subscription's renewal was paid." },
  { id: "subscription.payment_failed", label: "Subscription payment failed", hint: "A subscription's renewal could not be charged: it waits for the subscriber's payment." },
  { id: "gift_card.issued", label: "Gift card issued", hint: "A gift card or store credit was issued: never its code." },
  { id: "review.created", label: "Review written", hint: "A buyer wrote a product review, waiting for the store's check or published at once." },
  { id: "support.waiting", label: "Someone waiting in support", hint: "A customer has waited for a person in the support chat as long as the support settings say: how many wait now, and a link to the inbox. Never who they are or what they wrote." },
];

export const isEvent = (value: string): value is IntegrationEvent => EVENTS.some((e) => e.id === value);

/** The events of D354 go to an owner's own endpoints only: Zapier, Make and Slack get the events they always had. */
const ENDPOINT_ONLY: ReadonlySet<IntegrationEvent> = new Set([
  "return.requested",
  "withdrawal.received",
  "product.created",
  "product.updated",
  "stock.low",
  "discount.created",
  "inventory.updated",
  "product.archived",
  "order.created",
  "order.updated",
  "fulfilment.created",
  "fulfilment.updated",
  "refund.created",
  "return.updated",
  "quote.requested",
  "draft.sent",
  "customer.updated",
  "customer.erased",
  "subscription.renewed",
  "subscription.payment_failed",
  "gift_card.issued",
  "review.created",
]);

/** The events a service (Zapier, Make, Slack) may be sent. */
export const SERVICE_EVENTS = EVENTS.filter((event) => !ENDPOINT_ONLY.has(event.id));

export const isServiceEvent = (value: string): value is IntegrationEvent => isEvent(value) && !ENDPOINT_ONLY.has(value);

/**
 * The address, if it is one of the service's own webhook addresses: https,
 * on the service's hook host, no port or login. Kaizen sends nowhere else,
 * so a store cannot point it at another server.
 */
export function checkWebhookUrl(provider: Provider, text: string): { ok: true; url: string } | { ok: false; problem: string } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, problem: "Paste the whole webhook address, starting with https://." };
  }
  const hostOk =
    provider === "zapier"
      ? url.hostname === "hooks.zapier.com" && url.pathname.startsWith("/hooks/")
      : provider === "slack"
        ? url.hostname === "hooks.slack.com" && /^\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname) && !url.search
        : /^hook\.[a-z0-9-]+\.make\.com$/.test(url.hostname) || url.hostname === "hook.integromat.com";
  if (url.protocol !== "https:" || url.port || url.username || url.password || !hostOk) {
    return {
      ok: false,
      problem:
        provider === "zapier"
          ? "That is not a Zapier webhook address. It starts with https://hooks.zapier.com/hooks/."
          : provider === "slack"
            ? "That is not a Slack webhook address. It starts with https://hooks.slack.com/services/."
            : "That is not a Make webhook address. It starts with https://hook. and ends in make.com.",
    };
  }
  return { ok: true, url: url.toString() };
}

/** The address with its secret part hidden: `hooks.zapier.com/hooks/catch/…/fg12`. */
export function webhookHint(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  // Only the service's own words stay; the rest is the secret.
  const known = segments.filter((segment) => segment === "hooks" || segment === "catch" || segment === "services");
  const tail = (segments.at(-1) ?? "").slice(-4);
  return [parsed.hostname, ...known, `…${tail}`].join("/");
}
