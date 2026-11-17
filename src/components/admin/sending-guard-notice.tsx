import { fillWords } from "@/lib/admin-fill";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { shareText, type GuardCounts, type GuardReason } from "@/lib/sending-guard";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card } from "./ui";

/** What the notice needs of `sendingHealth()` (D730). */
export type GuardNoticeState = { kind: "paused"; reason: GuardReason; counts: GuardCounts; pausedAt: string } | { kind: "warn"; reason: GuardReason; counts: GuardCounts } | null;

/**
 * The sending guard on the Marketing pages (D730, step M1.6 of the email plan): while marketing email is held, what was counted, what goes
 * on, and one button to resume; near the line, a quiet warning. Nothing at all while sending is healthy.
 */
export function SendingGuardNotice({
  state,
  words: w,
  locale,
  timeZone,
  resume,
}: {
  state: GuardNoticeState;
  words: MarketingMessages["sendingGuard"];
  /** The number and date locale of the person's language. */
  locale: string;
  timeZone: string;
  /** Null for someone who may not change marketing. */
  resume: ((state: FormState, form: FormData) => Promise<FormState>) | null;
}) {
  if (!state) return null;
  const c = state.counts;
  const values = {
    sent: c.sent.toLocaleString(locale),
    bounced: c.bounced.toLocaleString(locale),
    complained: c.complained.toLocaleString(locale),
    rate: shareText(state.reason === "bounces" ? c.bounced : c.complained, c.sent, locale),
  };
  if (state.kind === "warn") {
    return (
      <Card title={w.warnTitle} description={fillWords(state.reason === "bounces" ? w.warnBounces : w.warnComplaints, values)} className="border border-warning-line" />
    );
  }
  const date = new Date(state.pausedAt).toLocaleDateString(locale, { dateStyle: "long", timeZone });
  return (
    <Card title={w.pausedTitle} description={fillWords(state.reason === "bounces" ? w.pausedBounces : w.pausedComplaints, { ...values, date })} className="border border-danger-line">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">{w.advice}</p>
        {resume ? (
          <ActionForm action={resume} successMessage={w.resumed}>
            <SubmitButton>{w.resume}</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-muted">{w.ownerOnly}</p>
        )}
      </div>
    </Card>
  );
}

/** The notice's state from the guard's health: the pause if one holds, else a warning near the line, else nothing. */
export function noticeState(health: { verdict: { level: string; reason?: GuardReason }; counts: GuardCounts; pause: { reason: GuardReason; counts: GuardCounts; pausedAt: string } | null }): GuardNoticeState {
  if (health.pause) return { kind: "paused", reason: health.pause.reason, counts: health.pause.counts, pausedAt: health.pause.pausedAt };
  if (health.verdict.level === "warn" && health.verdict.reason) return { kind: "warn", reason: health.verdict.reason, counts: health.counts };
  return null;
}
