import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { AUTOMATION_KINDS, DELAY_RANGES, FOLLOW_UP_DAYS, isPickKind, LIFECYCLE_KINDS, type FollowUpPosition, type LifecycleKind } from "@/lib/automation-kinds";
import { AUTOMATION_WORDS, ORDER_AFTER_DAYS, PICKS_SHOWN } from "@/lib/automations";
import { defaultText, MAX_DELAY_MINUTES, MIN_DELAY_MINUTES, type ReminderText } from "@/lib/cart-reminders";
import { findAvoided } from "@/lib/brand";
import { suggestionBlocks } from "@/lib/broadcasts";
import { CLAIM_LABELS, findClaims } from "@/lib/claims";
import { localInstant } from "@/lib/follow-ups";
import { mainCurrency } from "@/lib/markets";
import { parseAmount } from "@/lib/field-money";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";
import type { PermissionHolder } from "@/lib/permissions";
import { describeRules, segmentRulesSchema } from "@/lib/segments";
import { SMS_PARTS_MAX, smsParts } from "@/lib/sms";
import { plainText } from "@/lib/approval-summaries";

import { automationStats, getAutomation, getAutomations, saveAutomation, saveFollowUp, switchAutomation, type Automation } from "./automations";
import { cartReminderStats, getCartReminderSettings, saveCartReminderStep, setCartRemindersEnabled } from "./cart-reminders";
import { brandOf } from "./brand";
import { audienceCount, getBroadcast, listBroadcasts, saveBroadcast, scheduleBroadcast, startBroadcast, suggestBroadcast, type Broadcast } from "./broadcasts";
import { listTiers } from "./customer-tiers";
import { issueGiftCard } from "./gift-cards-admin";
import { OwnerToolError } from "./owner-tool-error";
import { addTag, evaluateSegment, listSegments, removeTag, saveSegment, type SavedSegment } from "./segments";
import { storeById } from "./shopper-emails";
import { getSmsCampaign, getSmsSettings, listSmsCampaigns, previewSmsCampaign, saveSmsCampaign, smsSubscriberCounts, startSmsCampaign, type SmsCampaign } from "./sms";
import type { Store } from "./stores";
import { typedRow } from "./typed-rows";
import type { Account, Membership } from "./auth";
import { marketingEn } from "@/lib/admin-messages/marketing.en";

/**
 * The AI manager's marketing tools (PSI AGT-01; D295-D298): broadcasts, segments, customer tags and automations, each through the
 * function the admin's own screen calls, so every rule there holds here. A broadcast is drafted by the store's own suggestion (the claims
 * filter included) and sent or scheduled only on the owner's yes (`send`); an automation is switched only on a yes. Answers carry counts
 * and words made in code, never who is on a list.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void; holder?: PermissionHolder };

/** The member the tools work for, as the screens' functions take one; its permission was checked before the tool ran. */
const memberOf = ({ account, store, holder }: Ctx): Membership => ({ account, store, role: holder?.role ?? "owner", kind: holder?.kind, permissions: holder?.permissions });

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

/**
 * What the owner says yes to when a segment is saved for them (D439): its name and its rules in the store's words, with its own money and
 * customer groups. Null when the rules cannot be read, and the words made from the call stand.
 */
export async function segmentApprovalSummary(store: Store, args: Record<string, unknown>): Promise<string | null> {
  const rules = segmentRulesSchema.safeParse(args.rules);
  if (!rules.success) return null;
  try {
    const tiers = await listTiers(store.id);
    const money = (minor: number) => formatMoney(minor, mainCurrency(store), store.localization.locales[0] ?? "en-GB");
    const words = describeRules(rules.data, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name, words: marketingEn.describe });
    const name = plainText(String(args.name ?? ""), 80);
    const existing = typeof args.segment === "string" && args.segment.trim() ? await findSegment(store, args.segment).catch(() => null) : null;
    const was = existing ? plainText(existing.name, 80) : "";
    const what = !existing ? `Save the segment "${name}"` : was.toLowerCase() === name.toLowerCase() ? `Change the segment "${was}"` : `Change the segment "${was}", renamed "${name}"`;
    return `${what}: ${plainText(words, 600)}. Shoppers see nothing of it.`;
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
      rules: describeRules(segment.rules, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name, words: marketingEn.describe }),
      people: counted.people,
      want_emails: counted.subscribed,
      ...(counted.moneyUnknown > 0 && { not_judged_on_money: counted.moneyUnknown }),
      ...(counted.capped && { note: "counted from the first people only: the store has more than a segment reads" }),
    });
  }
  return { segments: rows, total: segments.length, link: adminLink(store, "/segments") };
}

/** The people the rules match now and how many want the store's emails (D380), counted by the segments' reader; never who. */
export async function countSegmentTool({ store }: Ctx, { rules }: OwnerToolInput<"count_segment">) {
  const [counted, tiers] = await Promise.all([evaluateSegment(store, rules), listTiers(store.id)]);
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), store.localization.locales[0] ?? "en-GB");
  return {
    rules: describeRules(rules, { money, groupName: (id) => tiers.find((t) => t.id === id)?.name, words: marketingEn.describe }),
    people: counted.people,
    want_emails: counted.subscribed,
    ...(counted.moneyUnknown > 0 && { not_judged_on_money: counted.moneyUnknown }),
    ...(!counted.rfmReady && rules.conditions.some((c) => c.kind === "rfm") && { note: "customer types are not worked out yet: the store has too few customers with a paid order" }),
    ...(counted.capped && { capped: "counted from the first people only: the store has more than a segment reads" }),
  };
}

/** Saves a segment through the Segments page's own saver (D380); changing one finds it by id or name. */
export async function saveSegmentTool({ account, store }: Ctx, { name, rules, segment }: OwnerToolInput<"save_segment">) {
  const existing = segment ? await findSegment(store, segment) : null;
  const saved = await saveSegment(store.id, account.id, existing?.id ?? null, { name, rules });
  if (!saved.ok) return fail(saved.problem);
  const counted = await evaluateSegment(store, rules);
  return { done: existing ? `The segment "${name}" is changed.` : `The segment "${name}" is saved.`, id: saved.id, people: counted.people, link: adminLink(store, `/segments/${saved.id}`) };
}

export async function tagCustomerTool({ account, store }: Ctx, { email, tag, remove }: OwnerToolInput<"tag_customer">) {
  if (remove) return (await removeTag(store.id, account.id, email, tag)) ? { done: `The tag "${tag}" is taken off.` } : fail(`That address has no tag "${tag}".`);
  const added = await addTag(store.id, account.id, email, tag);
  return added.ok ? { done: `Tagged "${tag}".` } : fail(added.problem);
}

/** Amounts per currency in words, such as "1 450,00 kr", for a tool's answer. */
const amountsWords = (store: Store, minor: Record<string, number>): string[] =>
  Object.entries(minor).map(([currency, amount]) => formatMoney(amount, currency, store.localization.locales[0] ?? "en-GB"));

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
        ...(isPickKind(kind) && { products: `Each email shows up to ${PICKS_SHOWN} products the shop chooses for the reader; none to show, it does not go.` }),
        ...(a.followUps.length > 0 && {
          follow_ups: a.followUps.map((f) => ({
            step: f.position,
            when: `${f.delayDays} ${f.delayDays === 1 ? "day" : "days"} after the email before, if they have not ordered since the first`,
            subject: f.content[store.localization.locales[0] ?? ""]?.subject ?? "",
          })),
        }),
        ...((LIFECYCLE_KINDS as readonly string[]).includes(kind) && {
          sent_last_30_days: sent[kind as LifecycleKind] ?? 0,
          // Worked out by the store (D4): paid orders their readers placed within the days after an email, never caused by it alone.
          orders_after: stats.revenue[kind as LifecycleKind].orders,
          ...(stats.revenue[kind as LifecycleKind].orders > 0 && { revenue_after: amountsWords(store, stats.revenue[kind as LifecycleKind].minor) }),
        }),
      };
    }),
    orders_after_means: `Paid orders placed by the reader within ${ORDER_AFTER_DAYS} days of one of its emails in the last 30 days; some would have come anyway.`,
    waiting_for_products_back: stats.waiting,
    link: adminLink(store, "/automations"),
  };
}

export async function switchAutomationTool(ctx: Ctx, { kind, on }: OwnerToolInput<"switch_email_automation">) {
  if (kind === "cart_reminders") return switchCartReminders(ctx, on);
  const { account, store } = ctx;
  const result = await switchAutomation(store, account.id, kind, on);
  if (!result.ok) return fail(result.problem);
  return { done: `${AUTOMATION_WORDS[kind].title} is ${on ? "on" : "off"}.`, link: adminLink(store, "/automations") };
}

/** Who each automation reaches and when, for the store's writer (D4): what it may and may not know about the reader. */
const AUTOMATION_AUDIENCE: Record<LifecycleKind, (days: number) => string> = {
  welcome: (d) =>
    `It is the shop's welcome email: it goes to each person ${d === 0 ? "as soon as they join" : `${d} days after they join`} the shop's list. Welcome them and say what the shop is about.`,
  after_purchase: (d) =>
    `It goes to each customer on the shop's list ${d} days after their order was delivered. Thank them; you may show products that go well with what the shop sells. You do not know what they bought, so never name it.`,
  win_back: (d) => `It goes to customers on the shop's list who have not ordered for ${d} days. Invite them back warmly, without pressure.`,
  cross_sell: (d) =>
    `It goes to each customer on the shop's list ${d} days after their order was delivered. The shop shows each reader a few products that go with what they bought, under your words. You do not know what they bought or which products are shown, so never name either; never choose products yourself.`,
  browse: (d) =>
    `It goes to signed-in customers on the shop's list ${d} ${d === 1 ? "day" : "days"} after they last looked at products they did not buy. The shop shows those products under your words. You do not know which they are, so never name them; never choose products yourself, and never say you watched them.`,
  replenish: (d) =>
    `It goes to each customer on the shop's list ${d} days after their order was delivered, when the order had products people buy again. The shop shows those products under your words. You do not know which they are, so never name them; never choose products yourself.`,
};

/** An automation's days: those asked for, else its own, refused outside its kind's range. */
async function automationDays(store: Store, kind: LifecycleKind, days: number | undefined): Promise<number> {
  const range = DELAY_RANGES[kind];
  const chosen = days ?? (await getAutomation(store, kind)).delayDays ?? range.start;
  if (!Number.isInteger(chosen) || chosen < range.min || chosen > range.max) fail(`The days for ${AUTOMATION_WORDS[kind].title} must be a whole number from ${range.min} to ${range.max}.`);
  return chosen;
}

/** The follow-up a write is for (D653): the one at that step, or the next one to add; refused for a gap, before the first is saved, or past three. */
function followUpTarget(automation: Automation, step: FollowUpPosition): { position: FollowUpPosition; exists: boolean } {
  const title = AUTOMATION_WORDS[automation.kind].title;
  if (!automation.saved) fail(`${title} has no first email saved yet: write step 1 first.`);
  if (automation.followUps.some((f) => f.position === step)) return { position: step, exists: true };
  if (step !== automation.followUps.length + 2) fail(`${title} has ${automation.followUps.length === 0 ? "no follow-up" : "one follow-up"}: write step ${automation.followUps.length + 2} first.`);
  return { position: step, exists: false };
}

/** A follow-up's days: those asked for, else its own, else where a new one starts; refused outside 1 to 60. */
function followUpDays(automation: Automation, position: FollowUpPosition, days: number | undefined): number {
  const chosen = days ?? automation.followUps.find((f) => f.position === position)?.delayDays ?? FOLLOW_UP_DAYS.start;
  if (!Number.isInteger(chosen) || chosen < FOLLOW_UP_DAYS.min || chosen > FOLLOW_UP_DAYS.max) fail(`A follow-up's days must be a whole number from ${FOLLOW_UP_DAYS.min} to ${FOLLOW_UP_DAYS.max}, after the email before.`);
  return chosen;
}

/** Checks a write before it is kept for a yes: the days within the kind's range, and for a follow-up the step it can be. */
export async function preflightWriteAutomation({ store }: Ctx, input: OwnerToolInput<"write_email_automation">): Promise<void> {
  if (input.step === 2 || input.step === 3) {
    const automation = await getAutomation(store, input.kind);
    followUpDays(automation, followUpTarget(automation, input.step).position, input.days);
    return;
  }
  await automationDays(store, input.kind, input.days);
}

/**
 * Writes an automation's words with the store's own writer (D4 of `docs/100-day-challenge.md`, D352): from the brief, to the readers the kind
 * reaches, in the store's main language, the store's products and campaigns drawn by code and every text through the claims filter and the
 * brand's words to avoid. Saved through the screen's own `saveAutomation()`, the days with it; it is not switched on or off here.
 */
export async function writeAutomationTool(ctx: Ctx, input: OwnerToolInput<"write_email_automation">) {
  if (input.step === 2 || input.step === 3) return writeFollowUp(ctx, input, input.step);
  const { account, store } = ctx;
  const days = await automationDays(store, input.kind, input.days);
  const locale = store.localization.locales[0] ?? "en";
  const suggested = await suggestBroadcast(store, account.id, input.brief, locale, { audience: AUTOMATION_AUDIENCE[input.kind](days) });
  if (!suggested.ok) return fail(suggested.problem);
  const s = suggested.suggestion;
  const current = await getAutomation(store, input.kind);
  const saved = await saveAutomation(store, account.id, input.kind, {
    delayDays: days,
    content: { ...(current.content ?? {}), [locale]: { subject: s.subject, preview: s.preview, blocks: suggestionBlocks(s) } },
  });
  if (!saved.ok) return fail(saved.problem);
  const others = Object.keys(current.content ?? {}).filter((l) => l !== locale && store.localization.keptLocales.includes(l));
  const words = AUTOMATION_WORDS[input.kind];
  return {
    done: `${words.title} has new words in ${locale}. ${words.days?.(days) ?? ""} ${current.enabled ? "It is on, so the next emails use them." : "It is off: switch it on with switch_email_automation."}`.trim(),
    subject: s.subject,
    words: [s.heading, ...s.paragraphs],
    ...(s.products.length > 0 && { products: s.products.map((p) => p.label) }),
    ...(s.campaigns.length > 0 && { campaigns: s.campaigns.map((c) => c.label) }),
    ...(others.length > 0 && { other_languages: `${others.join(", ")} keep their own words; the owner changes them on its page (the link).` }),
    link: adminLink(store, `/automations/${input.kind}`),
  };
}

/** A follow-up's words (D653), by the same writer for the same readers, told it is a later email to those who have not ordered since. */
async function writeFollowUp({ account, store }: Ctx, input: OwnerToolInput<"write_email_automation">, step: FollowUpPosition) {
  const automation = await getAutomation(store, input.kind);
  const target = followUpTarget(automation, step);
  const days = followUpDays(automation, target.position, input.days);
  const locale = store.localization.locales[0] ?? "en";
  const audience = `${AUTOMATION_AUDIENCE[input.kind](automation.delayDays ?? DELAY_RANGES[input.kind].start)} This is its ${step === 2 ? "second" : "third"} email, ${days} days after the one before, to those who have not ordered since the first: a gentle reminder, never a copy of the first.`;
  const suggested = await suggestBroadcast(store, account.id, input.brief, locale, { audience });
  if (!suggested.ok) return fail(suggested.problem);
  const s = suggested.suggestion;
  const current = automation.followUps.find((f) => f.position === target.position)?.content ?? automation.content ?? {};
  const saved = await saveFollowUp(store, account.id, input.kind, target.exists ? target.position : null, {
    delayDays: days,
    content: { ...current, [locale]: { subject: s.subject, preview: s.preview, blocks: suggestionBlocks(s) } },
  });
  if (!saved.ok) return fail(saved.problem);
  const title = AUTOMATION_WORDS[input.kind].title;
  return {
    done: `${title}'s ${step === 2 ? "second" : "third"} email ${target.exists ? "has new words" : "is added"} in ${locale}, sent ${days} ${days === 1 ? "day" : "days"} after the email before to those who have not ordered since. ${automation.enabled ? "The automation is on, so it goes from now on." : "The automation is off: switch it on with switch_email_automation."}`,
    subject: s.subject,
    words: [s.heading, ...s.paragraphs],
    ...(s.products.length > 0 && { products: s.products.map((p) => p.label) }),
    link: adminLink(store, `/automations/${input.kind}/follow-ups/${saved.position ?? target.position}`),
  };
}

// Cart reminders (D33, D653) -------------------------------------------------------------------------------

const hoursWords = (minutes: number) => {
  const hours = minutes / 60;
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? "day" : "days"}` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
};

const CODE_ROW = z.object({ id: z.string(), code: z.string() });

/** `cart_reminder_stats`: the reminders as the page lists them (D653), and the last 30 days. */
export async function listCartRemindersTool({ store }: Ctx) {
  const [settings, stats] = await Promise.all([getCartReminderSettings(store.id), cartReminderStats(store.id)]);
  const codes = new Map<string, string>();
  for (const id of new Set(settings.steps.flatMap((s) => (s.discountCodeId ? [s.discountCodeId] : [])))) {
    const row = await typedRow(CODE_ROW, sql`select id::text, code from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${id}::uuid`);
    if (row) codes.set(row.id, row.code);
  }
  const main = store.localization.locales[0] ?? "";
  return {
    on: settings.enabled,
    reminders: settings.steps.map((s) => ({
      id: s.id,
      after: hoursWords(s.delayMinutes),
      on: s.active,
      ...(s.discountCodeId && { discount_code: codes.get(s.discountCodeId) ?? "a code that no longer exists" }),
      subject: s.content[main]?.subject ?? "",
    })),
    // The figures as the tool answered them before it listed the reminders (the MCP contract keeps its fields, D438).
    period: "the last 30 days",
    checkouts_left_with_email: stats.captured,
    reminded: stats.reminded,
    bought_after_reminder: stats.recovered,
    won_back: amountsWords(store, stats.recoveredMinor),
    page: adminLink(store, "/cart-reminders"),
  };
}

/** A discount code by its code (any case): its id, null to take it away, undefined to keep; refused when the store has none by that code. */
async function reminderCode(store: Store, code: string | undefined): Promise<string | null | undefined> {
  if (code === undefined) return undefined;
  if (code === "") return null;
  const row = await typedRow(CODE_ROW, sql`select id::text, code from commerce.discount_codes where store_id = ${store.id}::uuid and lower(code) = lower(${code}) limit 1`);
  return row ? row.id : fail(`The store has no discount code "${code}". list_discounts names them.`);
}

/** Checks a cart reminder's words and timing before it is kept for a yes: claims and the brand's words to avoid, the hours, the reminder and the code. */
export async function preflightWriteCartReminder({ store }: Ctx, input: OwnerToolInput<"write_cart_reminder">): Promise<void> {
  const brand = await brandOf(store.id);
  const words = [input.subject, input.heading, input.body, input.button].join("\n");
  const found = [...findClaims(words), ...findAvoided(words, brand.avoid)];
  if (found.length > 0) {
    const named = [...new Set(found.map((c) => `"${c.phrase}"${c.kind === "avoided" ? " (a word the brand avoids)" : ` (${CLAIM_LABELS[c.kind].toLowerCase()})`}`))].join(", ");
    fail(`The words make claims the store does not let AI make: ${named}. Write them without.`);
  }
  if (input.after_hours !== undefined) {
    const minutes = Math.round(input.after_hours * 60);
    if (minutes < MIN_DELAY_MINUTES || minutes > MAX_DELAY_MINUTES) fail("A reminder goes from half an hour to 30 days after the shopper typed their email.");
  }
  if (!input.reminder && input.after_hours === undefined) fail("Say after how many hours a new reminder goes.");
  if (input.reminder && !(await getCartReminderSettings(store.id)).steps.some((s) => s.id === input.reminder)) fail("That reminder no longer exists: cart_reminder_stats names them.");
  await reminderCode(store, input.discount_code);
}

/** Writes or adds a cart reminder on the owner's yes, through the screen's own `saveCartReminderStep()`; other languages keep their words. */
export async function writeCartReminderTool(ctx: Ctx, input: OwnerToolInput<"write_cart_reminder">) {
  await preflightWriteCartReminder(ctx, input);
  const { store } = ctx;
  const settings = await getCartReminderSettings(store.id);
  const current = input.reminder ? settings.steps.find((s) => s.id === input.reminder) : undefined;
  const main = store.localization.locales[0] ?? "en";
  const code = await reminderCode(store, input.discount_code);
  const others: Record<string, ReminderText> = Object.fromEntries(
    store.localization.locales.map((locale) => [locale, current?.content[locale] ?? defaultText(locale, settings.steps.length)]),
  );
  const saved = await saveCartReminderStep(memberOf(ctx), current?.id ?? null, {
    delayMinutes: input.after_hours === undefined ? current?.delayMinutes : Math.round(input.after_hours * 60),
    active: input.on ?? current?.active ?? true,
    discountCodeId: code === undefined ? (current?.discountCodeId ?? null) : code,
    content: { ...others, [main]: { subject: input.subject, heading: input.heading, body: input.body, button: input.button } },
  });
  if (!saved.ok) return fail(saved.problems[0] ?? "The reminder could not be saved.");
  return {
    done: `${current ? "The reminder has new words" : "A reminder is added"} in ${main}.${settings.enabled ? "" : " Cart reminders are off: switch them on with switch_email_automation (cart_reminders)."}`,
    id: saved.id,
    link: adminLink(store, `/cart-reminders/${saved.id}`),
  };
}

async function switchCartReminders(ctx: Ctx, on: boolean) {
  await setCartRemindersEnabled(memberOf(ctx), on);
  const settings = await getCartReminderSettings(ctx.store.id);
  return {
    done: on ? `Cart reminders are on: ${settings.steps.filter((s) => s.active).length} reminders go to shoppers who leave a checkout after typing their email.` : "Cart reminders are off.",
    link: adminLink(ctx.store, "/cart-reminders"),
  };
}

// Text messages (D565) -------------------------------------------------------------------------------

/** A text message by its id or its name (any case); refused when there is none, or more than one by that name. */
async function findTextMessage(store: Store, named: string): Promise<SmsCampaign> {
  const byId = await getSmsCampaign(store.id, named);
  if (byId) return byId;
  const wanted = named.trim().toLowerCase();
  const found = (await listSmsCampaigns(store.id)).filter((c) => c.title.trim().toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  return fail(found.length > 1 ? `Several text messages are called "${named}": give its id from list_text_messages.` : `No text message "${named}". Look with list_text_messages.`);
}

/** The store's text messages: whether 46elks is connected, the month's spend against the cap, who is subscribed, and the latest messages. */
export async function listTextMessagesTool({ store }: Ctx, { limit }: OwnerToolInput<"list_text_messages">) {
  const [settings, counts, campaigns] = await Promise.all([getSmsSettings(store.id), smsSubscriberCounts(store.id), listSmsCampaigns(store.id)]);
  if (!settings.connected) return { connected: false, note: "No 46elks account is connected: the owner connects one under Marketing, Text messages.", link: adminLink(store, "/text-messages") };
  return {
    connected: true,
    currency: settings.currency,
    spent_this_month: settings.spentThisMonth,
    monthly_cap: settings.monthlyCap,
    subscribed: counts.subscribed,
    waiting_for_their_first_order: counts.pending,
    messages: campaigns.slice(0, limit).map((c) => ({
      id: c.id,
      name: c.title,
      status: c.status,
      text: c.text,
      ...(c.status !== "draft" && { delivered: c.counts.delivered, sent: c.counts.sent, failed: c.counts.failed, cost: c.cost }),
      ...(c.startedAt && { started: timeWords(store, new Date(c.startedAt)) }),
    })),
    link: adminLink(store, "/text-messages"),
  };
}

/** Writes a draft text message in the AI manager's words, checked as the store's own writers are (claims and the brand's words to avoid). Nothing is sent. */
export async function draftTextMessageTool(ctx: Ctx, input: OwnerToolInput<"draft_text_message">) {
  const { store } = ctx;
  const brand = await brandOf(store.id);
  const found = [...findClaims(input.text), ...findAvoided(input.text, brand.avoid)];
  if (found.length > 0) {
    const named = [...new Set(found.map((c) => `"${c.phrase}"${c.kind === "avoided" ? " (a word the brand avoids)" : ` (${CLAIM_LABELS[c.kind].toLowerCase()})`}`))].join(", ");
    return fail(`The text makes claims the store does not let AI make: ${named}. Write it without them.`);
  }
  const parts = smsParts(input.text).parts;
  if (parts > SMS_PARTS_MAX) return fail(`The text takes ${parts} messages; shorten it to ${SMS_PARTS_MAX} at most.`);
  const segment = input.segment ? await findSegment(store, input.segment) : null;
  const saved = await saveSmsCampaign(memberOf(ctx), null, { title: input.name, text: input.text, segmentId: segment?.id ?? null });
  if (!saved.ok) return fail(saved.problem);
  return {
    done: `A draft text message "${input.name}" is saved, for ${segment ? `the segment "${segment.name}"` : "everyone subscribed to texts"}. Nothing is sent.`,
    id: saved.id,
    messages_each: parts,
    next: "Ask the owner to read it on its page (the link); it is sent with send_text_message, which always needs their approval.",
    link: adminLink(store, `/text-messages/${saved.id}`),
  };
}

/** Checks a send before it is kept for a yes: a draft that reaches someone within the month's cap, priced by 46elks now. */
export async function preflightSendTextMessage(ctx: Ctx, input: OwnerToolInput<"send_text_message">): Promise<void> {
  const found = await findTextMessage(ctx.store, input.message);
  if (found.status !== "draft") fail(`"${found.title}" has been sent already.`);
  const preview = await previewSmsCampaign(memberOf(ctx), found.id);
  if (!preview.ok) fail(preview.problem);
  if (preview.ok && preview.recipients === 0) fail("No one is subscribed to texts for it yet.");
  if (preview.ok && !preview.withinCap) fail(`It would cost about ${preview.estimate} ${preview.currency}, past this month's cap of ${preview.cap} ${preview.currency}. The owner raises the cap or chooses fewer people.`);
}

/** Starts a draft on the owner's yes, through the screen's own `startSmsCampaign()` (priced again, the cap and quiet hours kept). */
export async function sendTextMessageTool(ctx: Ctx, input: OwnerToolInput<"send_text_message">) {
  const found = await findTextMessage(ctx.store, input.message);
  const started = await startSmsCampaign(memberOf(ctx), found.id);
  if (!started.ok) return fail(started.problem);
  return {
    done: `"${found.title}" is on its way to ${started.recipients} ${started.recipients === 1 ? "number" : "numbers"}, each within its own country's waking hours.`,
    link: adminLink(ctx.store, `/text-messages/${found.id}`),
  };
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
