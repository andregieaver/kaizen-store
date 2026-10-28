import "server-only";

import { AUTOMATION_KINDS, LIFECYCLE_KINDS, type LifecycleKind } from "@/lib/automation-kinds";
import { AUTOMATION_WORDS } from "@/lib/automations";
import { suggestionBlocks } from "@/lib/broadcasts";
import { localInstant } from "@/lib/follow-ups";
import { mainCurrency } from "@/lib/markets";
import { parseAmount } from "@/lib/field-money";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { describeRules } from "@/lib/segments";

import { automationStats, getAutomations, switchAutomation } from "./automations";
import { audienceCount, getBroadcast, listBroadcasts, saveBroadcast, scheduleBroadcast, startBroadcast, suggestBroadcast, type Broadcast } from "./broadcasts";
import { listTiers } from "./customer-tiers";
import { issueGiftCard } from "./gift-cards-admin";
import { OwnerToolError } from "./owner-tool-error";
import { addTag, evaluateSegment, listSegments, removeTag, type SavedSegment } from "./segments";
import { storeById } from "./shopper-emails";
import type { Store } from "./stores";
import type { Account } from "./auth";

/**
 * The AI manager's marketing tools (PSI AGT-01; D295-D298): broadcasts, segments, customer tags and automations, each through the
 * function the admin's own screen calls, so every rule there holds here. A broadcast is drafted by the store's own suggestion (the claims
 * filter included) and sent or scheduled only on the owner's yes (`send`); an automation is switched only on a yes. Answers carry counts
 * and words made in code, never who is on a list.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const timeWords = (store: Store, at: Date) =>
  `${new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: store.timeZone }).format(at)} (${store.timeZone})`;

/** A broadcast by its id or its name (any case); refused when there is none, or more than one by that name. */
async function findBroadcast(store: Store, named: string): Promise<Broadcast> {
  const byId = await getBroadcast(store.id, named);
  if (byId) return byId;
  const wanted = named.trim().toLowerCase();
  const found = (await listBroadcasts(store.id)).filter((b) => b.title.trim().toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  return fail(found.length > 1 ? `Several broadcasts are called "${named}": give its id from list_broadcasts.` : `No broadcast "${named}". Look with list_broadcasts.`);
}

async function findSegment(store: Store, named: string): Promise<SavedSegment> {
  const segments = await listSegments(store.id);
  const wanted = named.trim().toLowerCase();
  const found = segments.filter((s) => s.id === named || s.name.trim().toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  return fail(found.length > 1 ? `Several segments are called "${named}": give its id from list_segments.` : `No segment "${named}". Look with list_segments.`);
}

/** A scheduled send's time, from the tool's `at` in the store's time zone. */
const sendAt = (store: Store, at: string): Date => {
  const ms = localInstant(at, store.timeZone);
  return ms === null ? fail("Give the time as YYYY-MM-DD HH:MM in the store's time zone.") : new Date(ms);
};

export async function listBroadcastsTool({ store }: Ctx, { limit }: OwnerToolInput<"list_broadcasts">) {
  const all = await listBroadcasts(store.id);
  return {
    broadcasts: all.slice(0, limit).map((b) => ({
      id: b.id,
      name: b.title,
      status: b.status,
      audience: b.audience === "everyone" ? "everyone on the list" : `segment: ${b.segmentName ?? "deleted"}`,
      ...(b.scheduledFor && b.status === "scheduled" && { scheduled_for: timeWords(store, new Date(b.scheduledFor)) }),
      ...(b.scheduleProblem && { schedule_problem: b.scheduleProblem }),
      ...(b.startedAt && { started: b.startedAt.slice(0, 10) }),
      ...(b.recipientCount !== null && { recipients: b.recipientCount }),
    })),
    total: all.length,
    link: adminLink(store, "/broadcasts"),
  };
}

export async function draftBroadcastTool({ account, store }: Ctx, input: OwnerToolInput<"draft_broadcast">) {
  const segment = input.segment ? await findSegment(store, input.segment) : null;
  const locale = store.localization.locales[0] ?? "en";
  const suggested = await suggestBroadcast(store, account.id, input.brief, locale, { segmentId: segment?.id ?? null });
  if (!suggested.ok) return fail(suggested.problem);
  const s = suggested.suggestion;
  const saved = await saveBroadcast(store, account.id, null, {
    title: input.name,
    audience: segment ? "segment" : "everyone",
    segmentId: segment?.id ?? null,
    content: { [locale]: { subject: s.subject, preview: s.preview, blocks: suggestionBlocks(s) } },
  });
  if (!saved.ok) return fail(saved.problem);
  return {
    done: `A draft broadcast "${input.name}" is saved, for ${segment ? `the segment "${segment.name}"` : "everyone on the list"}. Nothing is sent.`,
    id: saved.id,
    subject: s.subject,
    words: [s.heading, ...s.paragraphs],
    // Chosen by the store's AI from its own products and running campaigns; their pictures, prices and offers are drawn by code (D352).
    ...(s.products.length > 0 && { products: s.products.map((p) => p.label) }),
    ...(s.campaigns.length > 0 && { campaigns: s.campaigns.map((c) => c.label) }),
    ...(s.button && { button: `${s.button} (it links to the store's front page until the owner changes it)` }),
    next: "Ask the owner to read and change it on its page (the link), then send it with send_broadcast, which needs their approval.",
    link: adminLink(store, `/broadcasts/${saved.id}`),
  };
}

export async function sendBroadcastTool({ account, store }: Ctx, { broadcast, at }: OwnerToolInput<"send_broadcast">) {
  const found = await findBroadcast(store, broadcast);
  if (at) {
    const when = sendAt(store, at);
    const scheduled = await scheduleBroadcast(store.id, account.id, found.id, when);
    if (!scheduled.ok) return fail(scheduled.problem);
    return { done: `"${found.title}" is scheduled for ${timeWords(store, when)}; it is checked again then.`, link: adminLink(store, `/broadcasts/${found.id}`) };
  }
  const started = await startBroadcast(store.id, account.id, found.id);
  if (!started.ok) return fail(started.problem);
  return { done: `"${found.title}" is being sent to ${started.recipients} ${started.recipients === 1 ? "person" : "people"}.`, link: adminLink(store, `/broadcasts/${found.id}`) };
}

/** Checks a send before it is kept for a yes, as the send itself will: the broadcast, its state, its time and who it would reach. */
export async function preflightSendBroadcast({ store }: Ctx, { broadcast, at }: OwnerToolInput<"send_broadcast">): Promise<void> {
  const found = await findBroadcast(store, broadcast);
  if (found.status !== "draft" && found.status !== "scheduled") return fail(`"${found.title}" is ${found.status}, not a draft.`);
  if (at) {
    const when = sendAt(store, at);
    if (when.getTime() < Date.now() + 5 * 60_000) return fail("Choose a time at least five minutes from now.");
  }
  const emailStore = await storeById(store.id);
  if (!emailStore) return fail("The store is gone.");
  const count = await audienceCount(emailStore, found.audience, found.segmentId);
  if (!count.ok) return fail(count.problem);
  if (count.people === 0) return fail("Nobody on the list wants the store's emails yet, so nobody would get it.");
}

/** What the owner says yes to, written from the broadcast itself: its name, subject, audience and how many it reaches now. */
export async function broadcastApprovalSummary(store: Store, args: Record<string, unknown>): Promise<string | null> {
  try {
    const found = await findBroadcast(store, String(args.broadcast ?? ""));
    const emailStore = await storeById(store.id);
    const count = emailStore ? await audienceCount(emailStore, found.audience, found.segmentId) : null;
    const subject = found.content[store.localization.locales[0] ?? ""]?.subject;
    const who = found.audience === "everyone" ? "everyone on the list who asked for your emails" : `the segment "${found.segmentName ?? "deleted"}"`;
    const reach = count?.ok ? ` (${count.people} ${count.people === 1 ? "person" : "people"} now)` : "";
    const when = typeof args.at === "string" && args.at ? ` at ${timeWords(store, sendAt(store, args.at))}` : " now";
    return `Send the broadcast "${found.title}"${subject ? ` ("${subject}")` : ""}${when} to ${who}${reach}.`;
  } catch {
    return null;
  }
}

export async function listSegmentsTool({ store }: Ctx) {
  const [segments, tiers] = await Promise.all([listSegments(store.id), listTiers(store.id)]);
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), store.localization.locales[0] ?? "en-GB");
  const rows = [];
  for (const segment of segments.slice(0, 20)) {
    if (!segment.rules) {
      rows.push({ id: segment.id, name: segment.name, rules: "can no longer be read: open it and save it again" });
      continue;
    }
    const counted = await evaluateSegment(store, segment.rules);
    rows.push({
      id: segment.id,
      name: segment.name,
      rules: describeRules(segment.rules, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name }),
      people: counted.people,
      want_emails: counted.subscribed,
      ...(counted.moneyUnknown > 0 && { not_judged_on_money: counted.moneyUnknown }),
      ...(counted.capped && { note: "counted from the first people only: the store has more than a segment reads" }),
    });
  }
  return { segments: rows, total: segments.length, link: adminLink(store, "/segments") };
}

export async function tagCustomerTool({ account, store }: Ctx, { email, tag, remove }: OwnerToolInput<"tag_customer">) {
  if (remove) return (await removeTag(store.id, account.id, email, tag)) ? { done: `The tag "${tag}" is taken off.` } : fail(`That address has no tag "${tag}".`);
  const added = await addTag(store.id, account.id, email, tag);
  return added.ok ? { done: `Tagged "${tag}".` } : fail(added.problem);
}

export async function listAutomationsTool({ store }: Ctx) {
  const [automations, stats] = await Promise.all([getAutomations(store), automationStats(store.id)]);
  const sent = stats.sent as Record<LifecycleKind, number>;
  return {
    automations: AUTOMATION_KINDS.map((kind) => {
      const a = automations[kind];
      const words = AUTOMATION_WORDS[kind];
      return {
        kind,
        name: words.title,
        does: words.does,
        on: a.enabled,
        ...(a.delayDays !== null && words.days && { when: words.days(a.delayDays) }),
        ...((LIFECYCLE_KINDS as readonly string[]).includes(kind) && { sent_last_30_days: sent[kind as LifecycleKind] ?? 0 }),
      };
    }),
    waiting_for_products_back: stats.waiting,
    link: adminLink(store, "/automations"),
  };
}

export async function switchAutomationTool({ account, store }: Ctx, { kind, on }: OwnerToolInput<"switch_email_automation">) {
  const result = await switchAutomation(store, account.id, kind, on);
  if (!result.ok) return fail(result.problem);
  return { done: `${AUTOMATION_WORDS[kind].title} is ${on ? "on" : "off"}.`, link: adminLink(store, "/automations") };
}

// Gift cards (D300 F4) -------------------------------------------------------------------------------

/** The card's amount and currency as the store will issue it, or why not: the store's main currency unless one it sells in is named. */
function giftCardValue(store: Store, input: Pick<OwnerToolInput<"issue_gift_card">, "amount" | "currency">): { amountMinor: number; currency: string } {
  const currency = (input.currency ?? mainCurrency(store)).toUpperCase();
  if (!store.localization.currencies.some((c) => c.currency === currency)) return fail(`The store does not sell in ${currency}.`);
  const amountMinor = parseAmount(input.amount, currency);
  if (amountMinor === null || amountMinor <= 0) return fail("Give the card's value as a number above zero, such as 500.");
  return { amountMinor, currency };
}

/** Checks an issue before it is kept for a yes: the value, the currency and that the store issues cards (its feature). */
export async function preflightIssueGiftCard({ store }: Ctx, input: OwnerToolInput<"issue_gift_card">): Promise<void> {
  giftCardValue(store, input);
}

/**
 * Issues the card through the Gift cards page's own `issueGiftCard()`, emailed to the address given. The code is never in the answer: it reached the
 * person by email, and the AI manager's conversation keeps nothing it could be spent with.
 */
export async function issueGiftCardTool({ account, store }: Ctx, input: OwnerToolInput<"issue_gift_card">) {
  const { amountMinor, currency } = giftCardValue(store, input);
  const outcome = await issueGiftCard(store, account.id, {
    amountMinor,
    currency,
    recipientEmail: input.to,
    recipientName: input.name ?? null,
    message: input.message ?? null,
    lang: (store.localization.locales[0] ?? "en").slice(0, 2),
    note: input.reason,
  });
  if (!outcome.ok) return fail(outcome.problem === "currency" ? `The store does not sell in ${currency}.` : outcome.problem === "amount" ? "The value must be above zero." : "No code could be made just now. Try again.");
  const value = formatMoney(amountMinor, currency, store.localization.locales[0] ?? "en-GB");
  return {
    done:
      outcome.emailed === "sent"
        ? `Issued a gift card of ${value} and emailed it to ${input.to}. Its code is only in that email.`
        : `Issued a gift card of ${value}, but its email to ${input.to} did not go. Its code is not shown here: open the card's page to see what to do.`,
    link: adminLink(store, `/gift-cards/${outcome.cardId}`),
  };
}
