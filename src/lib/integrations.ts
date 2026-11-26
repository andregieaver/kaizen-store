/**
 * Integrations (D41): the automation services a store can connect, the
 * store events Kaizen sends them, and the webhook addresses each accepts.
 * Slack (D101) takes the same events as messages in a channel.
 */

export type Provider = "zapier" | "make" | "slack";

export type IntegrationInfo = {
  id: Provider | "tripletex" | "fiken" | "ebay";
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
    summary: "Send orders, customers, subscriptions and deals to thousands of apps, such as Google Sheets, a CRM like Pipedrive or HubSpot, or your accounts.",
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
    summary: "Send orders, customers, subscriptions and deals to your Make scenarios, and on to the apps you use, such as a CRM.",
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
    summary: "Get a message in a Slack channel when an order is paid, sent, cancelled or refunded, for new customers and subscriptions, and when a deal opens, moves, is won or lost.",
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
    // Not a webhook (D453): its own page, `/integrations/tripletex`, connected with one pasted token.
    summary: "Your invoices and credit notes go straight into your Norwegian accounting.",
  },
  {
    id: "fiken",
    name: "Fiken",
    // Not a webhook (D460): its own page, `/integrations/fiken`, connected through Fiken's own consent page.
    summary: "Your invoices and credit notes go straight into Fiken.",
  },
  {
    id: "ebay",
    name: "eBay",
    // A sales channel (D555): its own page, `/integrations/ebay`, connected through eBay's own consent page.
    summary: "List your products on eBay's European marketplaces and handle their orders here.",
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
  | "review.created"
  // D148 phase 15: an A/B test has an answer.
  | "experiment.answered"
  // D695 step 4: a deal's contract was sent for signing, signed by everyone, or declined.
  | "contract.sent"
  | "contract.signed"
  | "contract.declined"
  // Ecosystem plan E3.2 (D718): the events that were missing. Deals (D464), the email list (D295), support (D216), a review published
  // (D301), a checkout left (D33), and Work's clients and invoices (D122), which the database queued and this list dropped.
  | "deal.created"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "subscriber.subscribed"
  | "subscriber.unsubscribed"
  | "conversation.ended"
  | "conversation.rated"
  | "review.published"
  | "checkout.abandoned"
  | "work_client.created"
  | "work_invoice.sent"
  | "work_invoice.paid"
  | "work_invoice.credited"
  // D705 F5: a visitor sent one of the store's forms (a sign-up once confirmed).
  | "form.response"
  // Email plan M1.2 (D732): an email bounced or was marked as spam, a broadcast finished, the sending guard held marketing email.
  | "email.bounced"
  | "email.complained"
  | "broadcast.sent"
  | "marketing.paused"
  // Ecosystem plan E5.1 (D757): what E3.2 left. An activity added or done (D468), staff's decision about a lead (D475), and a connected
  // domain the daily watch finds failing or working again (E4.2).
  | "activity.created"
  | "activity.done"
  | "lead.dismissed"
  | "lead.deal_made"
  | "domain.failing"
  | "domain.recovered"
  // Projects' events (D903 P5.2): a project made or its status changed, a list made, a task added, given its person or done.
  | "project.created"
  | "project.status_changed"
  | "checklist.created"
  | "task.created"
  | "task.assigned"
  | "task.done";

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
  { id: "experiment.answered", label: "A/B test has an answer", hint: "A running A/B test has an answer for the first time: its verdict, the version that did best and each version's figures." },
  { id: "contract.sent", label: "Contract sent for signing", hint: "A deal's contract was sent: its first signer is asked to sign. Never a signer's email or the contract's words." },
  { id: "contract.signed", label: "Contract signed", hint: "Every signer signed a deal's contract: the deal is won. The sealed PDF follows within minutes, on the contract's page." },
  { id: "contract.declined", label: "Contract declined", hint: "A signer declined a deal's contract. Never the reason they gave: it is on the contract's page." },
  { id: "form.response", label: "Form sent", hint: "A visitor sent one of the store's forms, or confirmed a newsletter sign-up: the form and what they answered, as the response is kept." },
  { id: "support.waiting", label: "Someone waiting in support", hint: "A customer has waited for a person in the support chat as long as the support settings say: how many wait now, and a link to the inbox. Never who they are or what they wrote." },
  { id: "deal.created", label: "Deal created", hint: "A deal was made: by hand, from a lead or by the AI manager. Deals moved in from another CRM send none." },
  { id: "deal.stage_changed", label: "Deal moved", hint: "A deal moved to another stage of its pipeline: by a person, or because its quote or contract was sent." },
  { id: "deal.won", label: "Deal won", hint: "A deal was marked won: by a person, a paid order, an issued Work invoice or a signed contract." },
  { id: "deal.lost", label: "Deal lost", hint: "A deal was marked lost. Never the reason typed for it." },
  { id: "subscriber.subscribed", label: "Joined the email list", hint: "Someone joined the store's email list: confirmed their address, or subscribed signed in. Addresses moved in from another shop send none." },
  { id: "subscriber.unsubscribed", label: "Left the email list", hint: "A subscriber left the email list: through an email's link, their account, staff, a complaint or a bounce." },
  { id: "conversation.ended", label: "Support conversation ended", hint: "A support conversation ended: by the customer, a person, or when it went quiet. Never what was written." },
  { id: "conversation.rated", label: "Support conversation rated", hint: "A customer rated a support conversation good or bad. Never the comment they wrote." },
  { id: "review.published", label: "Review published", hint: "A buyer's product review was published on the site: at once, or when the store checked it." },
  { id: "checkout.abandoned", label: "Checkout abandoned", hint: "A shopper typed their email at checkout and did not pay: sent once a cart, when its first cart reminder is due." },
  { id: "work_client.created", label: "Work client added", hint: "A client was added in Work. Never their email or phone." },
  { id: "work_invoice.sent", label: "Work invoice sent", hint: "A Work invoice was issued: numbered and sent." },
  { id: "work_invoice.paid", label: "Work invoice paid", hint: "A Work invoice is paid in full." },
  { id: "work_invoice.credited", label: "Work invoice credited", hint: "A credit note was issued against a Work invoice." },
  { id: "email.bounced", label: "Email bounced", hint: "One of the store's emails to a customer came back: the address may be wrong or full. Which email, to whom, and the reason the mail server gave." },
  { id: "email.complained", label: "Email marked as spam", hint: "A customer marked one of the store's emails as spam. They have left the email list." },
  { id: "broadcast.sent", label: "Broadcast sent", hint: "A broadcast finished sending: how many it went to, and how many were sent, skipped or failed." },
  { id: "marketing.paused", label: "Marketing email paused", hint: "Too many recent marketing emails bounced or were marked as spam, so newsletters and automations are held until an owner resumes them." },
  { id: "activity.created", label: "Activity added", hint: "A call, a meeting or a task was added, by a person or the AI manager, about a customer, a company or a deal. Activities moved in from another CRM send none. Never its note." },
  { id: "activity.done", label: "Activity done", hint: "A call, a meeting or a task was marked done, or added as done. Marking it not done again sends nothing." },
  { id: "lead.dismissed", label: "Lead set aside", hint: "Someone dismissed a lead in the leads inbox: they leave it until they ask for something again. What they asked for, as ids; never their address or words." },
  { id: "lead.deal_made", label: "Lead made a deal", hint: "Someone made a deal of a lead: the person became a customer if they were not one, and a deal about them opened. What they asked for, as ids; never their address or words." },
  { id: "domain.failing", label: "Domain failing", hint: "One of the store's connected domains no longer reaches the store, as the daily domain watch found: its certificate fails, or it points elsewhere or at nothing. Sent once, until it works again." },
  { id: "domain.recovered", label: "Domain working again", hint: "A connected domain that was failing reaches the store again, as the daily domain watch found." },
  { id: "project.created", label: "Project made", hint: "A project was made in Projects, by a person, from a won deal or by the AI manager." },
  { id: "project.status_changed", label: "Project status changed", hint: "A project moved to planning, active, blocked, done or archived." },
  { id: "checklist.created", label: "Checklist made", hint: "A checklist was made, or copied. A template sends none." },
  { id: "task.created", label: "Task added", hint: "A task was added to a checklist: typed, pasted, made from an order, a return, a review or a conversation, or copied with a list. Never its notes." },
  { id: "task.assigned", label: "Task given a person", hint: "A task was given someone on the store's team, or given to someone else. Taken away from everyone sends nothing." },
  { id: "task.done", label: "Task done", hint: "A task was ticked off; a repeating task each time it is done. Unticked sends nothing." },
];

export const isEvent = (value: string): value is IntegrationEvent => EVENTS.some((e) => e.id === value);

/**
 * What only an app's installation is sent (D441 D2), whatever topics it chose and though its endpoint is off by then: never an owner's
 * endpoint, a service or a workflow. Kept apart from `EVENTS`, which every owner's list reads.
 */
export type AppEvent = "app.uninstalled" | "store.erase_requested";
export const APP_EVENTS: { id: AppEvent; label: string; hint: string }[] = [
  {
    id: "app.uninstalled",
    label: "App removed",
    hint: "The app was removed from the store: by an owner, or because the person who installed it left the store or the app was blocked. Its tokens no longer work, and nothing else is sent but store.erase_requested.",
  },
  {
    id: "store.erase_requested",
    label: "Store data to erase",
    hint: "48 hours after app.uninstalled: erase what the app keeps of the store, its customers and its orders.",
  },
];
export const isAppEvent = (value: string): value is AppEvent => APP_EVENTS.some((e) => e.id === value);

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
  "contract.sent",
  "contract.signed",
  "contract.declined",
  // Ecosystem plan E3.2 (D718): Zapier, Make and Slack keep the eight they had. Deals reach them since D902, D901 P29 (below).
  "subscriber.subscribed",
  "subscriber.unsubscribed",
  "conversation.ended",
  "conversation.rated",
  "review.published",
  "checkout.abandoned",
  "work_client.created",
  "work_invoice.sent",
  "work_invoice.paid",
  "work_invoice.credited",
  "form.response",
  // Email plan M1.2 (D732): Zapier, Make and Slack keep the events they had.
  "email.bounced",
  "email.complained",
  "broadcast.sent",
  "marketing.paused",
  // Ecosystem plan E5.1 (D757). Activities and leads reach Zapier and Make since D902, D901 P29.
  "domain.failing",
  "domain.recovered",
]);

/** The events a service (Zapier, Make, Slack) may be sent. */
export const SERVICE_EVENTS = EVENTS.filter((event) => !ENDPOINT_ONLY.has(event.id));

export const isServiceEvent = (value: string): value is IntegrationEvent => isEvent(value) && !ENDPOINT_ONLY.has(value);

/**
 * What Zapier and Make get but Slack does not (D902, D901 P29): a channel is told what the team wants to read together (a deal opened, moved, won
 * or lost: `slackMessage()`), not each person's calls and tasks or each lead set aside, which Zapier and Make carry on to another CRM.
 */
const NOT_TO_SLACK: ReadonlySet<IntegrationEvent> = new Set([
  "activity.created",
  "activity.done",
  "lead.dismissed",
  "lead.deal_made",
  // Projects' events (D903 P5.2): carried on by Zapier and Make to another tool, never each a message in a channel.
  "project.created",
  "project.status_changed",
  "checklist.created",
  "task.created",
  "task.assigned",
  "task.done",
]);

/** The events this service may be sent: `SERVICE_EVENTS`, less what Slack has no message for. */
export const serviceEventsOf = (provider: Provider) => SERVICE_EVENTS.filter((event) => provider !== "slack" || !NOT_TO_SLACK.has(event.id));

export const isServiceEventOf = (provider: Provider, value: string): value is IntegrationEvent =>
  isServiceEvent(value) && (provider !== "slack" || !NOT_TO_SLACK.has(value));

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
