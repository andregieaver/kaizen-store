import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { alertsFor, type Alert, type AlertSnapshot } from "@/lib/analytics-alerts";
import { analyticsWordsIn } from "@/lib/analytics-words";
import { checkedNote } from "@/lib/autopilot-report";
import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";

import { aiFor, AiError, completeText, type AiConnection } from "./ai";
import { alertSnapshotFor, runningTargets, type TargetCard } from "./analytics-insights";
import { log } from "./log";
import { checkupFindings, type CheckupFinding } from "./store-checkup";
import type { Store } from "./stores";

/**
 * The briefing's facts (wave 8 unit D, D348, `docs/wave-8-analytics-ai.md` D, detail 4): what the staff summary of D238 grew into. Everything here is
 * counted in code from the store's own rows: the alerts of `alertsFor()` over one snapshot (worded again in each recipient's language), the store
 * checkup's findings (`checkupFindings()`), and the targets running (`runningTargets()`). The optional note is a model's few sentences from those facts,
 * kept only through `checkedNote()` (no digit, no claim); the model never makes a figure. Nothing here names a customer.
 */

/** How many alerts the briefing lists; the rest are one press away on the Analytics page. */
export const BRIEFING_ALERTS = 5;

/** The approvals a person waits on are their own (the checkup counts them for one account); the briefing goes to several, so it leaves them out. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

export type BriefingFacts = {
  /** The alert engine's input, kept to word the alerts in each language; null when it could not be read (no alerts then). */
  snapshot: AlertSnapshot | null;
  /** The alerts in English, most pressing first: what decides whether the period is quiet. */
  alerts: Alert[];
  checkup: CheckupFinding[];
  targets: TargetCard[];
};

async function safe<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    log("warn", "briefing.read_failed", { part: label }, error);
    return fallback;
  }
}

/** The briefing's facts for a store, read once for all its recipients. A part that cannot be read is left out, never guessed. */
export async function briefingFacts(store: Store, now: Date): Promise<BriefingFacts> {
  const [snapshot, checkup, targets] = await Promise.all([
    safe("alerts", () => alertSnapshotFor(store, now), null as AlertSnapshot | null),
    safe("checkup", () => checkupFindings(store, NOBODY), [] as CheckupFinding[]),
    safe("targets", () => runningTargets(store, now, { withMonth: true }), [] as TargetCard[]),
  ]);
  const alerts = snapshot ? await safe("alert rules", async () => alertsFor(snapshot), [] as Alert[]) : [];
  return { snapshot, alerts, checkup: checkup.filter((f) => f.key !== "approvals"), targets };
}

/** The alerts worded in a language, at most `BRIEFING_ALERTS`. */
export function briefingAlerts(facts: BriefingFacts, lang: AdminLang): Alert[] {
  if (!facts.snapshot) return [];
  try {
    return alertsFor(facts.snapshot, analyticsWordsIn(lang).alertText).slice(0, BRIEFING_ALERTS);
  } catch {
    return facts.alerts.slice(0, BRIEFING_ALERTS);
  }
}

/** A quiet period, which sends no briefing: no paid order and no alert (D348). */
export const quietPeriod = (orders: number, facts: Pick<BriefingFacts, "alerts">): boolean => orders === 0 && facts.alerts.length === 0;

export type NoteDeps = { connection?: AiConnection | null };

/**
 * A few sentences on what stands out and what would be sensible to look at, from the briefing's own words (`lines`, the email's items as written), in
 * the recipient's language; null without a text model, when it fails, or when it states a number or a claim. Feature `analytics_briefing`.
 */
export async function briefingNote(store: Store, lang: AdminLang, lines: readonly string[], deps: NoteDeps = {}): Promise<string | null> {
  if (lines.length === 0) return null;
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(store.id, { feature: "analytics_briefing" });
  if (!connection?.textModel) return null;
  try {
    const answer = await completeText(
      connection,
      [
        {
          role: "system",
          content: [
            "You write the closing note of a shop owner's briefing email: two or three short, plain sentences on what stands out in the items you are given and what would be sensible to look at first.",
            UNTRUSTED_TEXT,
            "Use only the items you are given. Write no numbers, amounts, dates or percentages at all, and promise nothing.",
            `Write in ${ADMIN_LANG_FACTS[lang].name}.`,
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify({ items: lines }) },
      ],
      { maxTokens: 250, timeoutMs: 30_000 },
    );
    return checkedNote(answer.text);
  } catch (error) {
    if (!(error instanceof AiError)) log("error", "briefing.note_failed", { store: store.id }, error);
    return null;
  }
}
