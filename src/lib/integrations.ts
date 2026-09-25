/**
 * Integrations (D41): the automation services a store can connect, the
 * store events Kaizen sends them, and the webhook addresses each accepts.
 */

export type Provider = "zapier" | "make";

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
      "Save, then send a test so Zapier can see what Kaizen sends.",
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
      "Save, then send a test so Make can learn what Kaizen sends.",
    ],
    example: "https://hook.eu2.make.com/abcdefghijklmnopqrstuvwxyz123456",
    docs: "https://www.make.com/en/help/tools/webhooks",
  },
  {
    id: "tripletex",
    name: "Tripletex",
    summary: "Orders, customers and payments straight into your Norwegian accounting.",
    comingSoon: true,
  },
];

export const PROVIDERS: Provider[] = ["zapier", "make"];

export const isProvider = (value: string): value is Provider => (PROVIDERS as string[]).includes(value);

export type IntegrationEvent =
  | "order.paid"
  | "order.sent"
  | "order.cancelled"
  | "order.refunded"
  | "customer.created"
  | "subscription.started"
  | "subscription.cancelled";

export const EVENTS: { id: IntegrationEvent; label: string; hint: string }[] = [
  { id: "order.paid", label: "Order paid", hint: "A shopper paid, or a subscription renewed." },
  { id: "order.sent", label: "Order sent", hint: "An order was marked as sent, with its tracking." },
  { id: "order.cancelled", label: "Order cancelled", hint: "A paid order was cancelled." },
  { id: "order.refunded", label: "Order refunded", hint: "Money went back to the shopper, in full or in part." },
  { id: "customer.created", label: "New customer account", hint: "A shopper made an account." },
  { id: "subscription.started", label: "Subscription started", hint: "A subscription's first payment went through." },
  { id: "subscription.cancelled", label: "Subscription cancelled", hint: "A subscription was cancelled." },
];

export const isEvent = (value: string): value is IntegrationEvent => EVENTS.some((e) => e.id === value);

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
      : /^hook\.[a-z0-9-]+\.make\.com$/.test(url.hostname) || url.hostname === "hook.integromat.com";
  if (url.protocol !== "https:" || url.port || url.username || url.password || !hostOk) {
    return {
      ok: false,
      problem:
        provider === "zapier"
          ? "That is not a Zapier webhook address. It starts with https://hooks.zapier.com/hooks/."
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
  const known = segments.filter((segment) => segment === "hooks" || segment === "catch");
  const tail = (segments.at(-1) ?? "").slice(-4);
  return [parsed.hostname, ...known, `…${tail}`].join("/");
}
