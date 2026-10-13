"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { ACTION_KIND_WORDS, CUSTOMER_ACTION_KINDS } from "@/lib/support-action-words";
import { HoursEditor } from "@/components/admin/hours-editor";
import { END_AFTER_MINUTES, NOTIFY_AFTER_MINUTES, TRANSCRIPT_DAYS, type SupportMode } from "@/lib/support-rules";
import type { DeskSettingsView } from "@/server/support-settings";

/** Who answers, as the settings page offers it (2.10). */
export const MODE_CHOICES: { mode: SupportMode; title: string; description: string }[] = [
  { mode: "off", title: "Support off — the chat assistant alone", description: "The chat assistant answers by itself, as before. Nobody takes over, and conversations are kept for a day after they end." },
  { mode: "ai_first", title: "The AI first, then your team", description: "The assistant answers first; a customer can ask for a person at any time, and the assistant hands over when it cannot help." },
  { mode: "people", title: "Your team only", description: "Your people answer every conversation. The AI never writes to your customers." },
];

const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

/**
 * A desk's support settings (D216, `docs/support.md` 2.10, step 5): who answers first, email follow-up, opening hours, when quiet
 * conversations end, when people are emailed, how people are named and (the owner's alone) how long transcripts are kept.
 */
export function SupportSettingsForm({
  settings,
  save,
  canWrite,
  owner,
  deskName,
  aiSettingsHref,
  chatHref,
  openCount,
}: {
  settings: DeskSettingsView;
  save: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  canWrite: boolean;
  /** May change how long transcripts are kept. */
  owner: boolean;
  deskName: string;
  aiSettingsHref: string;
  chatHref: string;
  /** Open conversations now, for the note on changing who answers. */
  openCount: number;
}) {
  const [mode, setMode] = useState<SupportMode>(settings.mode);
  const disabled = !canWrite || !save;
  const body = (
    <fieldset disabled={disabled} className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Who answers your customers</h2>
        <div role="radiogroup" aria-label="Who answers your customers" className="flex flex-col gap-2">
          {MODE_CHOICES.map((choice) => (
            <label key={choice.mode} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
              <input type="radio" name="mode" value={choice.mode} checked={mode === choice.mode} onChange={() => setMode(choice.mode)} className="mt-1 size-4" />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{choice.title}</span>
                <span className="text-sm text-muted">{choice.description}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === "ai_first" && !settings.aiReady && (
          <p role="note" className="rounded-md border border-border p-3 text-sm">
            No AI is connected: your customers will reach your team only, until you connect one in the{" "}
            <Link href={aiSettingsHref} className="underline">
              AI settings
            </Link>{" "}
            and save the{" "}
            <Link href={chatHref} className="underline">
              chat assistant
            </Link>
            .
          </p>
        )}
        {mode !== settings.mode && openCount > 0 && (
          <p role="note" className="text-sm text-muted">
            {mode === "ai_first"
              ? "Open conversations go on as they are."
              : `Changing this ends the open conversations the new choice cannot answer (${openCount} open now); a customer who writes again within a day opens theirs again.`}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">When nobody is there</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="emailFollowup" defaultChecked={settings.emailFollowup} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">Answer by email.</span> A customer waiting while nobody is online may leave their email; your answers in the
            conversation reach them there, with a link back to it. Signed-in customers get them at their account&apos;s address.
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Email your people when a customer has waited
          <input type="number" name="notifyAfterMinutes" min={NOTIFY_AFTER_MINUTES.min} max={NOTIFY_AFTER_MINUTES.max} defaultValue={settings.notifyAfterMinutes} className={`${field} w-20`} />
          minutes (everyone who may answer and is not online, once each time a conversation waits).
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Opening hours</h2>
        <p className="text-sm text-muted">
          Outside these hours customers are told nobody can answer now (and may leave their email). Without hours, someone can answer whenever one of your
          people is online. In {deskName}&apos;s time zone.
        </p>
        <HoursEditor name="hours" initial={settings.hours} optional />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What the AI may do for customers</h2>
        <p className="text-sm text-muted">
          With the AI first, the assistant may propose these to a signed-in customer. Nothing happens until the customer presses Confirm in the chat, and it runs
          with the same checks as on their own pages. Anything else (a refund, cancelling a paid order, a new address) it passes to your team as a request.
          {owner ? "" : " Only the owner changes this."}
        </p>
        {owner && <input type="hidden" name="aiActionsShown" value="1" />}
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {CUSTOMER_ACTION_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`aiAction.${kind}`}
                defaultChecked={settings.aiActions === null || settings.aiActions.includes(kind)}
                disabled={!owner}
                className="size-4"
              />
              {ACTION_KIND_WORDS[kind]}
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Silent partner</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="partner" defaultChecked={settings.partner} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">Let the AI help your people as a silent partner.</span> Beside a conversation someone has, it looks up facts
            with that person&apos;s own permissions, recommends what to do and drafts a reply they may use. It never writes to the customer or acts, and
            each person can switch it off for themselves. Needs a text model{settings.aiReady ? "" : " (none is connected)"}.
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">The customer&apos;s tone</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="toneOn" defaultChecked={settings.toneOn} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">Read the tone of customers&apos; messages.</span> The AI scores each message from very bad to very good, only
            for your team; the customer never sees it and nothing is decided about them from it. Needs a text model{settings.aiReady ? "" : " (none is connected)"}.
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Alert the inbox when a conversation&apos;s tone reaches
          <ToneLine name="toneAlert" value={settings.toneAlert} />
          (or falls by 40 within three messages).
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          With the AI first, hand a conversation from the AI to your team when its tone reaches
          <ToneLine name="toneHandoff" value={settings.toneHandoff} />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Summaries</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="summariesOn" defaultChecked={settings.summariesOn} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">Summarise ended conversations, and brief whoever takes one over.</span> Written by the AI from the
            conversation, in English, for your team only; you can correct a summary. Needs a text model{settings.aiReady ? "" : " (none is connected)"}.
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Conversations</h2>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          End a conversation with the assistant after
          <input type="number" name="endAfterMinutes" min={END_AFTER_MINUTES.min} max={END_AFTER_MINUTES.max} defaultValue={settings.endAfterMinutes} className={`${field} w-20`} />
          quiet minutes. Conversations with a person end after a day without a message; nobody taking one from the queue for 14 days ends it.
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">How your people are named to customers</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="agentNaming" value="first_name" defaultChecked={settings.agentNaming === "first_name"} className="size-4" />
            Their first name (or the name they set for support) and their own picture
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="agentNaming" value="desk" defaultChecked={settings.agentNaming === "desk"} className="size-4" />
            {deskName}, for everyone
          </label>
        </fieldset>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Keep transcripts for
          <select name="transcriptDays" defaultValue={settings.transcriptDays} disabled={!owner} className={field}>
            {TRANSCRIPT_DAYS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
          after a conversation ends{owner ? "" : " (only the owner changes this)"}. Then the words are deleted and only counts are kept.
        </label>
      </section>

      {!disabled && (
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      )}
    </fieldset>
  );
  return save ? (
    <ActionForm action={save} className="flex flex-col gap-4">
      {body}
    </ActionForm>
  ) : (
    body
  );
}

/** A tone line: off, or a score from the bands' edges (the band is named beside the number). */
function ToneLine({ name, value }: { name: string; value: number | null }) {
  const choices = [-20, -40, -60, -80];
  const options = value !== null && !choices.includes(value) ? [...choices, value].sort((a, b) => b - a) : choices;
  return (
    <select name={name} defaultValue={value === null ? "off" : String(value)} className={field}>
      <option value="off">Off</option>
      {options.map((score) => (
        <option key={score} value={score}>
          {score} ({score <= -60 ? "very bad" : "bad"})
        </option>
      ))}
    </select>
  );
}
