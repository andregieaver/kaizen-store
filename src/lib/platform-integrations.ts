import { formatMoney, minorUnitDigits } from "./money";
import { escapeSlack, slackLink, type SlackMessage } from "./slack";

/**
 * Kaizena Flow's own integrations (D465, `docs/platform-parity.md`): the platform's twin of a store's Zapier, Make and Slack (D41, D101),
 * for its own events. Pure: which events there are, what a new connection gets, and the Slack message each payload becomes.
 *
 * The services are the stores' (`INTEGRATIONS`, `checkWebhookUrl()`, `webhookHint()` in `src/lib/integrations.ts`); only the events are the
 * platform's. Each is queued by the database where it happens (`commerce.queue_platform_event()`), so none is missed.
 */

export type PlatformEvent =
  | "request.received"
  | "store.created"
  | "store.opened"
  | "plan.started"
  | "plan.changed"
  | "plan.cancelled"
  | "plan.payment_failed"
  | "report.received";

/** Every platform event, in the order the settings list them; the words are the catalogue's (`platform.integrations.events`). */
export const PLATFORM_EVENTS: readonly PlatformEvent[] = [
  "request.received",
  "store.created",
  "store.opened",
  "plan.started",
  "plan.changed",
  "plan.cancelled",
  "plan.payment_failed",
  "report.received",
];

export const isPlatformEvent = (value: string): value is PlatformEvent => (PLATFORM_EVENTS as readonly string[]).includes(value);

/** What a newly connected service gets until a platform admin chooses: the news an operator acts on. */
export const DEFAULT_PLATFORM_EVENTS: readonly PlatformEvent[] = [
  "request.received",
  "store.created",
  "plan.started",
  "plan.cancelled",
  "plan.payment_failed",
  "report.received",
];

/** Kept by the services' log, as a store's are (`integrations`' KEEP_DAYS). */
export const PLATFORM_DELIVERY_KEEP_DAYS = 30;

type Data = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const obj = (value: unknown): Data | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : null);
const SECTION_MAX = 2900;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A plan's price as English writes it, from the whole units the payload carries: "NOK 490.00 a month". */
function planPrice(plan: Data | null): string {
  if (!plan) return "";
  const currency = str(plan.currency);
  const amount = typeof plan.amount === "number" ? plan.amount : null;
  if (!currency || amount === null) return "";
  let money: string;
  try {
    money = formatMoney(Math.round(amount * 10 ** minorUnitDigits(currency)), currency, "en");
  } catch {
    money = `${amount} ${currency}`;
  }
  const interval = str(plan.interval);
  return interval ? `${money} a ${escapeSlack(interval)}` : money;
}

/** "Plan name · NOK 490.00 a month", the parts there are. */
function planLine(plan: Data | null): string {
  if (!plan) return "";
  return [escapeSlack(str(plan.name)), planPrice(plan)].filter(Boolean).join(" · ");
}

const REPORT_WORDS: Record<string, string> = {
  unsafe_product: "Unsafe product",
  counterfeit_ip: "Counterfeit or someone else's rights",
  illegal_goods: "Illegal goods",
  consumer_fraud: "Consumer fraud",
  hate_violence: "Hate or violence",
  privacy: "Privacy",
  minors: "Harm to children",
  other: "Something else",
};

function message(text: string, head: string, foot: string[]): SlackMessage {
  const blocks: Record<string, unknown>[] = [{ type: "section", text: { type: "mrkdwn", text: clip(head, SECTION_MAX) } }];
  if (foot.length > 0) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: foot.join(" · ") }] });
  // The plain text (notifications, and clients that show no blocks) is escaped as the stores' is: no mention, no link.
  return { text: escapeSlack(clip(text, 300)), blocks, unfurl_links: false, unfurl_media: false };
}

/**
 * The Slack message for a platform payload (`platformPayload()` on the server), in English as the stores' messages are. A channel is read
 * by many, so a request shows the person's name but never their email; a notice shows its category and the store, never who sent it or what
 * they wrote. Everything is escaped, so a store's name can never become a link or a mention. Null for an event Slack is not sent.
 */
export function platformSlackMessage(payload: Data): SlackMessage | null {
  const event = str(payload.event);
  const tag = payload.test === true ? "Test: " : "";
  const store = obj(payload.store);
  const storeName = escapeSlack(str(store?.name));
  const storeLink = slackLink(store?.admin_url, str(store?.name) || "the store");
  const site = slackLink(store?.url, str(store?.url).replace(/^https?:\/\//, ""));
  const plan = obj(payload.plan);
  const testMode = plan?.mode === "test" ? " (Stripe test mode)" : "";
  const foot = ["Kaizena Flow"];
  switch (event) {
    case "request.received": {
      const request = obj(payload.request);
      const name = escapeSlack(str(request?.store_name));
      const who = escapeSlack(str(request?.name).trim());
      const sells = escapeSlack(clip(str(request?.sells).trim(), 300));
      foot.push(slackLink(request?.admin_url, "Open the requests"));
      return message(
        `${tag}New store request: ${str(request?.store_name)}`,
        [`*${tag}New store request: ${name}*`, [who && `From ${who}`, sells].filter(Boolean).join("\n")].filter(Boolean).join("\n"),
        foot,
      );
    }
    case "test":
    case "store.created":
      return message(`${tag}New store: ${str(store?.name)}`, [`*${tag}New store: ${storeLink}*`, site].filter(Boolean).join("\n"), foot);
    case "store.opened":
      return message(`${tag}Store opened: ${str(store?.name)}`, [`*${tag}Store opened: ${storeLink}*`, site].filter(Boolean).join("\n"), foot);
    case "plan.started":
      return message(
        `${tag}Plan started: ${str(store?.name)}`,
        [`*${tag}Plan started: ${storeLink}*${testMode}`, planLine(plan)].filter(Boolean).join("\n"),
        foot,
      );
    case "plan.changed":
      return message(
        `${tag}Plan changed: ${str(store?.name)}`,
        [`*${tag}Plan changed: ${storeLink}*${testMode}`, plan ? `Now ${planLine(plan)}` : ""].filter(Boolean).join("\n"),
        foot,
      );
    case "plan.cancelled": {
      const ends = str(plan?.current_period_end);
      const when = ends && plan?.status !== "canceled" ? ` · ends ${ends.slice(0, 10)}` : plan?.status === "canceled" ? " · ended" : "";
      return message(
        `${tag}Plan cancelled: ${str(store?.name)}`,
        [`*${tag}Plan cancelled: ${storeLink}*${testMode}`, plan ? `${escapeSlack(str(plan.name))}${when}` : ""].filter(Boolean).join("\n"),
        foot,
      );
    }
    case "plan.payment_failed":
      return message(
        `${tag}Plan payment failed: ${str(store?.name)}`,
        [`*${tag}Plan payment failed: ${storeLink}*${testMode}`, planLine(plan), "Stripe could not charge it, and tries again."].filter(Boolean).join("\n"),
        foot,
      );
    case "report.received": {
      const report = obj(payload.report);
      const reported = obj(report?.store);
      const category = REPORT_WORDS[str(report?.category)] ?? "Something else";
      const where = reported ? ` · ${escapeSlack(str(reported.name))}` : "";
      const by = report?.source === "screening" ? "Found by screening" : "A notice";
      foot.push(slackLink(report?.admin_url, "Open the notices"));
      return message(`${tag}Illegal content: ${category}`, `*${tag}Illegal content: ${escapeSlack(category)}*\n${by}${where}`, foot);
    }
    default:
      return storeName ? message(`${tag}${event}: ${str(store?.name)}`, `*${tag}${escapeSlack(event)}: ${storeLink}*`, foot) : null;
  }
}
