/**
 * What the AI manager's notification tools (wave 3, D238, `docs/wave-3-notifications.md` 5.5) do that needs no database. Three read-only, ungated tools:
 *
 * - `notification_settings` repeats the Notifications page: each customer email's switch and, per language, whether the store wrote its own words and in
 *   which parts (subject, heading, text). **Never the words themselves**: they are the owner's, edited and checked on the page.
 * - `order_rules` repeats the Automation pages: each rule's sentence (written by `describeRule()`, the page's own), whether it is on, its last run, and the
 *   log's latest runs with what each condition and action came to (`OUTCOME_WORDS`).
 * - `parcel_tracking` repeats the order page's tracking from the stored rows (`parcelTrackingFor()`): each parcel's phase, its newest events and why it is
 *   no longer followed. A phase from a code that is not verified is said to be so: Kaizen neither records a delivery nor emails from it (4.4).
 *
 * No tool switches an email, edits a text, changes a rule or holds an order (section 7). Every word here is the store's or Kaizen's, never the model's.
 * Pure, so tests hold it without a database.
 */

import type { NotificationDef } from "./notifications";
import { OUTCOME_WORDS, type OrderRule, type RunOutcome } from "./order-rules";
import type { StoredEvent, TrackingPhase, TrackingStop } from "./tracking-phases";
import type { TemplateSlot } from "./email-template";

export const NOTIFICATION_TOOLS = ["notification_settings", "order_rules", "parcel_tracking"] as const;

/** At most this many of a parcel's events are given to the model (newest first); the order page shows them all. */
export const TOOL_EVENTS_MAX = 5;
/** The log's runs given by default, and at most. */
export const RULE_RUNS_DEFAULT = 10;
export const RULE_RUNS_MAX = 50;

// ---------------------------------------------------------------------------
// notification_settings
// ---------------------------------------------------------------------------

const SLOT_WORDS: Record<TemplateSlot, string> = { subject: "subject", heading: "heading", body: "text" };

const STATUS_WORDS: Record<"on" | "off" | "always" | "fixed", string> = {
  on: "on",
  off: "off",
  always: "always sent (required, cannot be switched off)",
  fixed: "always sent, and its wording cannot be changed",
};

/** A row of the Notifications page as the server lists it (`NotificationListItem`). */
export type ToolNotification = {
  def: Pick<NotificationDef, "id" | "group" | "label" | "when" | "required" | "editable" | "defaultOn" | "why">;
  status: "on" | "off" | "always" | "fixed";
  languages: { lang: string; offered: boolean; own: boolean; slots: TemplateSlot[]; invalid: boolean }[];
};

/** A language code in words (`nb` → `Norwegian Bokmål`), the code itself when the runtime has no name for it. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** One notification as the model reads it: its switch and which languages have the store's own words, never the words. */
export function shapeNotification(n: ToolNotification) {
  return {
    id: n.def.id,
    name: n.def.label,
    when_sent: n.def.when,
    status: STATUS_WORDS[n.status],
    ...(n.status === "off" || n.status === "on" ? { default: n.def.defaultOn ? "on" : "off" } : {}),
    ...(n.def.why ? { why_required: n.def.why } : {}),
    wording: n.def.editable
      ? n.languages.map((l) => ({
          language: languageName(l.lang),
          ...(l.offered ? {} : { note: "The store no longer offers this language; its text is kept and can be deleted on the email's page." }),
          text: l.own ? `the store's own ${l.slots.map((s) => SLOT_WORDS[s]).join(", ")}` : "standard text",
          ...(l.invalid ? { problem: "Its saved words no longer pass the checks, so the standard text is sent until it is corrected." } : {}),
        }))
      : "fixed: Kaizena Flow's legal wording in every language",
  };
}

// ---------------------------------------------------------------------------
// order_rules
// ---------------------------------------------------------------------------

/** A run's outcome in words, as the log writes it: each condition met or not (and why it could not be known), each action done or not and why. */
export function outcomeWords(outcome: RunOutcome, matched: boolean): { conditions: string[]; actions: string[] } {
  const conditions = outcome.conditions.map((c) => `${c.kind.replace(/_/g, " ")}: ${c.met ? "met" : "not met"}${c.why ? ` (${OUTCOME_WORDS[c.why]})` : ""}`);
  const actions = matched
    ? outcome.actions.map((a) => `${a.kind === "tag" ? "tag" : a.kind === "notify" ? "notify staff" : "hold"}: ${a.ok ? "done" : `not done (${a.problem ? OUTCOME_WORDS[a.problem] : OUTCOME_WORDS.failed})`}`)
    : [];
  return { conditions, actions };
}

/** A rule as the model reads it: the page's own sentence, whether it runs, and its last run. */
export function shapeRule(rule: OrderRule & { lastRun: { at: string; matched: boolean } | null }, sentence: string) {
  return {
    id: rule.id,
    name: rule.name,
    rule: sentence,
    on: rule.enabled,
    order: rule.position + 1,
    last_run: rule.lastRun ? { at: rule.lastRun.at, matched: rule.lastRun.matched } : "never run",
  };
}

// ---------------------------------------------------------------------------
// parcel_tracking
// ---------------------------------------------------------------------------

/** Kaizen's phases in staff's words (English; the shopper's words are `m.tracking.phases`). */
export const PHASE_WORDS: Record<TrackingPhase, string> = {
  info_received: "the carrier has been told about the parcel",
  in_transit: "on its way",
  out_for_delivery: "out for delivery",
  ready_for_collection: "ready to collect at a pickup point",
  attempted: "delivery attempted",
  delivered: "delivered",
  returned_to_sender: "on its way back to the store",
  problem: "something has happened to the parcel",
  unknown: "not known from the carrier's latest event",
};

export const STOP_WORDS: Record<TrackingStop, string> = {
  delivered: "no longer followed: the carrier reported it delivered",
  returned: "no longer followed: the carrier reported it on its way back",
  old: "no longer followed: it was sent more than 30 days ago",
  undone: "no longer followed: the parcel was undone",
  carrier_failing: "no longer followed: the carrier did not answer many times in a row (Check now on the order page tries again)",
  no_agreement: "no longer followed: the store's agreement with the carrier is not saved or not complete (Check now on the order page tries again)",
};

export type ToolParcel = {
  carrier: string | null;
  trackingNumber: string | null;
  sentAt: string;
  followed: string | null;
  phase: TrackingPhase | null;
  phaseVerified: boolean;
  events: readonly StoredEvent[];
  checkedAt: string | null;
  lastCheckFailed: boolean;
  stopped: TrackingStop | null;
  outAt: string | null;
  deliveredAt: string | null;
};

/** A parcel as the model reads it: where it is by the stored events, never asked of the carrier here. */
export function shapeParcel(p: ToolParcel) {
  const base = { carrier: p.carrier ?? "not named", tracking_number: p.trackingNumber ?? "none", sent_at: p.sentAt };
  if (!p.followed) {
    return { ...base, followed: false, note: "Kaizena Flow does not follow this parcel (no tracking number, or a carrier the store has not connected): only its link is shown to the customer." };
  }
  if (p.phase === null) {
    return {
      ...base,
      followed: true,
      phase: p.lastCheckFailed ? "not known: the carrier did not answer yet" : "not checked yet (parcels are checked every few minutes)",
      ...(p.stopped ? { following: STOP_WORDS[p.stopped] } : {}),
    };
  }
  return {
    ...base,
    followed: true,
    phase: PHASE_WORDS[p.phase],
    ...(p.phaseVerified
      ? {}
      : { phase_note: "This carrier's codes are not verified against its documentation, so Kaizena Flow shows the events but records no delivery and sends no email from them." }),
    ...(p.outAt ? { out_for_delivery_at: p.outAt } : {}),
    ...(p.deliveredAt ? { delivered_at: p.deliveredAt } : {}),
    last_checked: p.checkedAt,
    ...(p.lastCheckFailed ? { last_check: "failed: the events are what was last seen" } : {}),
    ...(p.stopped ? { following: STOP_WORDS[p.stopped] } : {}),
    newest_events: p.events.slice(0, TOOL_EVENTS_MAX).map((e) => ({
      at: e.at,
      what: e.description || (e.verified ? PHASE_WORDS[e.phase] : e.code),
      ...(e.location ? { where: e.location } : {}),
    })),
    ...(p.events.length > TOOL_EVENTS_MAX ? { more_events: p.events.length - TOOL_EVENTS_MAX } : {}),
  };
}

/** Who recorded the order's delivery (`orders.delivered_source`; a date from before the column is staff's). */
export function deliveredByWords(source: string | null, deliveredAt: string | null): string {
  if (!deliveredAt) return "not recorded";
  if (source === "carrier") return "recorded from the carrier's delivered event";
  if (source === "handover") return "recorded when the order was handed over";
  return "recorded by staff";
}
