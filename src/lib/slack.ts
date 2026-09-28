import { formatMoney, minorUnitDigits } from "./money";

/**
 * Slack messages for a store's events (D101). The event's content is built
 * as for Zapier and Make (`buildPayload()`), then written here as a message
 * for people: what happened, the amount, the products, and a link to the
 * admin. Emails, phone numbers and addresses stay in Kaizen: a channel is
 * read by many, so the order is opened in the admin for those.
 *
 * Everything that came from shoppers or staff is escaped, so a product or a
 * name can never become a link or a mention (`<!channel>`).
 */

export type SlackMessage = {
  text: string;
  blocks: Record<string, unknown>[];
  unfurl_links: false;
  unfurl_media: false;
};

/** Slack's own escapes for its `mrkdwn`: only these three are special. */
export const escapeSlack = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A link, only to a web address that cannot break out of Slack's `<url|label>`. */
export function slackLink(url: unknown, label: string): string {
  const text = escapeSlack(label);
  if (typeof url !== "string" || !/^https?:\/\/[^\s<>|]+$/.test(url)) return text;
  return `<${url.replace(/&/g, "&amp;")}|${text.replace(/\|/g, "¦")}>`;
}

const LINES_SHOWN = 10;
const SECTION_MAX = 2900;

type Data = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);

/** A payload's amount (in whole units, as the services get it) as the store's locale writes it. */
function money(amount: unknown, currency: string, locale: string): string {
  try {
    return formatMoney(Math.round(num(amount) * 10 ** minorUnitDigits(currency)), currency, locale);
  } catch {
    return `${num(amount)} ${currency}`.trim();
  }
}

const clip = (text: string, max = SECTION_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function section(text: string): Record<string, unknown> {
  return { type: "section", text: { type: "mrkdwn", text: clip(text) } };
}

function footer(store: Data, url: unknown, label: string): Record<string, unknown> {
  return { type: "context", elements: [{ type: "mrkdwn", text: `${escapeSlack(str(store.name))} · ${slackLink(url, label)}` }] };
}

function orderLines(order: Data, locale: string): string | null {
  const lines = Array.isArray(order.lines) ? (order.lines as Data[]) : [];
  if (lines.length === 0) return null;
  const currency = str(order.currency);
  const shown = lines
    .slice(0, LINES_SHOWN)
    .map((line) => `• ${num(line.quantity)} × ${escapeSlack(str(line.title))}  ${money(line.total, currency, locale)}`);
  if (lines.length > LINES_SHOWN) shown.push(`…and ${lines.length - LINES_SHOWN} more`);
  return shown.join("\n");
}

const EVERY: Record<string, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/** "1 month" → "every month", "3 month" → "every 3 months". */
function every(value: unknown): string {
  const [count, unit] = str(value).split(" ");
  const words = EVERY[unit] ?? [escapeSlack(unit ?? ""), escapeSlack(unit ?? "")];
  return Number(count) === 1 ? `every ${words[0]}` : `every ${num(count)} ${words[1]}`;
}

function orderMessage(event: string, order: Data, store: Data, locale: string, test: boolean): SlackMessage {
  const currency = str(order.currency);
  const number = `#${str(order.number)}`;
  const total = money(order.total, currency, locale);
  const who = str(order.customer_name).trim();
  const from = who ? ` from ${escapeSlack(who)}` : "";
  const market = str(order.market) ? ` · ${escapeSlack(str(order.market))}` : "";
  const tag = test ? "Test: " : "";
  const title = (words: string) => `${tag}${words}`;
  const link = slackLink(order.admin_url, number);
  let head: string;
  let plain: string;
  const extra: string[] = [];
  switch (event) {
    case "order.sent": {
      head = `*${title("Order")} ${link} sent*`;
      plain = `${title("Order")} ${number} sent`;
      const shipment = (order.shipment ?? null) as Data | null;
      const carrier = escapeSlack(str(shipment?.carrier));
      const tracking = str(shipment?.tracking_number);
      if (shipment) {
        const code = tracking ? slackLink(shipment.tracking_url, tracking) : "";
        extra.push([carrier, code].filter(Boolean).join(" · ") || "No tracking");
      }
      break;
    }
    case "order.cancelled":
      head = `*${title("Order")} ${link} cancelled*\n${total}${from}`;
      plain = `${title("Order")} ${number} cancelled · ${total}`;
      break;
    case "order.refunded": {
      const refunded = money(order.refunded, currency, locale);
      head = `*${title("Order")} ${link} refunded*\n${refunded} of ${total}${from}`;
      plain = `${title("Order")} ${number} refunded · ${refunded} of ${total}`;
      break;
    }
    default:
      head = `*${title("New order")} ${link}*\n${total}${from}${market}`;
      plain = `${title("New order")} ${number} · ${total}${who ? ` · ${who}` : ""}`;
  }
  const lines = event === "order.paid" || test ? orderLines(order, locale) : null;
  return {
    text: escapeSlack(plain),
    blocks: [section(head), ...extra.map(section), ...(lines ? [section(lines)] : []), footer(store, order.admin_url, "Open the order in Kaizen")],
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** The message for an event's content (`buildPayload()`), in the store's locale; null for one Slack is not told about. */
export function slackMessage(payload: Data, locale: string): SlackMessage | null {
  const event = str(payload.event);
  const store = (payload.store ?? {}) as Data;
  const test = payload.test === true;
  if (payload.order && (event.startsWith("order.") || test)) {
    return orderMessage(test ? "order.paid" : event, payload.order as Data, store, locale, test);
  }
  if (event === "customer.created" && payload.customer) {
    const customer = payload.customer as Data;
    const name = str(customer.name).trim();
    const plain = name ? `New customer account: ${name}` : "New customer account";
    return {
      text: escapeSlack(plain),
      blocks: [
        section(`*New customer account*${name ? `\n${escapeSlack(name)}` : ""}`),
        footer(store, customer.admin_url, "Open the customer in Kaizen"),
      ],
      unfurl_links: false,
      unfurl_media: false,
    };
  }
  if (event.startsWith("subscription.") && payload.subscription) {
    const subscription = payload.subscription as Data;
    const number = `#${str(subscription.number)}`;
    const amount = `${money(subscription.total_per_renewal, str(subscription.currency), locale)} ${every(subscription.every)}`;
    const verb = event === "subscription.cancelled" ? "cancelled" : "started";
    return {
      text: escapeSlack(`Subscription ${number} ${verb} · ${amount}`),
      blocks: [
        section(`*Subscription ${slackLink(subscription.admin_url, number)} ${verb}*\n${amount}`),
        footer(store, subscription.admin_url, "Open the subscription in Kaizen"),
      ],
      unfurl_links: false,
      unfurl_media: false,
    };
  }
  return null;
}
