"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ActionForm,
  SubmitButton,
  type FormState,
} from "@/components/admin/action-form";
import {
  ACTION_KIND_WORDS,
  CUSTOMER_ACTION_KINDS,
} from "@/lib/support-action-words";
import { HoursEditor } from "@/components/admin/hours-editor";
import {
  END_AFTER_MINUTES,
  FORM_MESSAGES,
  NOTIFY_AFTER_MINUTES,
  TRANSCRIPT_DAYS,
  type SupportMode,
} from "@/lib/support-rules";
import type { DeskSettingsView } from "@/server/support-settings";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";

/** Who answers, as the settings page offers it (2.10). */
export const MODE_CHOICES: {
  mode: SupportMode;
  title: string;
  description: string;
}[] = [
  {
    mode: "off",
    title: "Support off — the chat assistant alone",
    description:
      "The chat assistant answers by itself, as before. Nobody takes over, and conversations are kept for a day after they end.",
  },
  {
    mode: "ai_first",
    title: "The AI first, then your team",
    description:
      "The assistant answers first; a customer can ask for a person at any time, and the assistant hands over when it cannot help.",
  },
  {
    mode: "people",
    title: "Your team only",
    description:
      "Your people answer every conversation. The AI never writes to your customers.",
  },
];

const field = "rounded-md border border-line bg-card px-2 py-1.5 text-sm";

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
  formChoice = false,
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
  /** A store's desk: where its contact forms' messages go (D382). */
  formChoice?: boolean;
}) {
  const w = useAdminText("support").settings;
  const kindWords = w.actionKinds as Record<string, string>;
  const needsModel = settings.aiReady ? "" : w.noneConnected;
  const [mode, setMode] = useState<SupportMode>(settings.mode);
  const disabled = !canWrite || !save;
  // What an AI does with customers' messages besides answering, as saved (D391): the owner reads that it is on and that customers are told.
  const aiOn = [
    ...(settings.mode !== "off" && settings.toneOn ? [w.aiOnTone] : []),
    ...(settings.mode !== "off" && settings.summariesOn ? [w.aiOnSummaries] : []),
  ];
  const body = (
    <fieldset disabled={disabled} className="flex flex-col gap-8">
      {aiOn.length > 0 && (
        <p role="note" data-ai-use="" className="rounded-panel border border-insight-line bg-insight-soft p-3 text-sm text-ink">
          {fillWords(w.aiOn, { what: aiOn.join(w.aiOnAnd) })}
        </p>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.whoAnswers}</h2>
        <div
          role="radiogroup"
          aria-label={w.whoAnswers}
          className="flex flex-col gap-2"
        >
          {MODE_CHOICES.map((choice) => (
            <label
              key={choice.mode}
              className="flex gap-3 rounded-panel bg-sunken p-3"
            >
              <input
                type="radio"
                name="mode"
                value={choice.mode}
                checked={mode === choice.mode}
                onChange={() => setMode(choice.mode)}
                className="mt-1 size-4"
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium">
                  {w.modes[choice.mode].title}
                </span>
                <span className="text-sm text-muted">
                  {w.modes[choice.mode].description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {mode === "ai_first" && !settings.aiReady && (
          <p role="note" className="rounded-md border border-line p-3 text-sm">
            {w.noAi.before}{" "}
            <Link href={aiSettingsHref} className="underline">
              {w.noAi.aiSettings}
            </Link>{" "}
            {w.noAi.middle}{" "}
            <Link href={chatHref} className="underline">
              {w.noAi.chat}
            </Link>
            {w.noAi.after}
          </p>
        )}
        {mode !== settings.mode && openCount > 0 && (
          <p role="note" className="text-sm text-muted">
            {mode === "ai_first"
              ? w.openGoOn
              : fillWords(w.openEnd, { n: openCount })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.nobody}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="emailFollowup"
            defaultChecked={settings.emailFollowup}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{w.email.title}</span> {w.email.text}
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {w.notify.before}
          <input
            type="number"
            name="notifyAfterMinutes"
            min={NOTIFY_AFTER_MINUTES.min}
            max={NOTIFY_AFTER_MINUTES.max}
            defaultValue={settings.notifyAfterMinutes}
            className={`${field} w-20`}
          />
          {w.notify.after}
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.hoursTitle}</h2>
        <p className="text-sm text-muted">
          {fillWords(w.hoursText, { desk: deskName })}
        </p>
        <HoursEditor name="hours" initial={settings.hours} optional />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.aiActionsTitle}</h2>
        <p className="text-sm text-muted">
          {w.aiActionsText}
          {owner ? "" : ` ${w.ownerOnly}`}
        </p>
        {owner && <input type="hidden" name="aiActionsShown" value="1" />}
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {CUSTOMER_ACTION_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`aiAction.${kind}`}
                defaultChecked={
                  settings.aiActions === null ||
                  settings.aiActions.includes(kind)
                }
                disabled={!owner}
                className="size-4"
              />
              {kindWords[kind] ?? ACTION_KIND_WORDS[kind]}
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.partnerTitle}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="partner"
            defaultChecked={settings.partner}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{w.partner.title}</span>{" "}
            {fillWords(w.partner.text, { none: needsModel })}
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.toneTitle}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="toneOn"
            defaultChecked={settings.toneOn}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{w.tone.title}</span>{" "}
            {fillWords(w.tone.text, { none: needsModel })}{" "}
            <span className="text-muted">{w.tone.toldInChat}</span>
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {w.toneAlert.before}
          <ToneLine name="toneAlert" value={settings.toneAlert} />
          {w.toneAlert.after}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {w.toneHandoff}
          <ToneLine name="toneHandoff" value={settings.toneHandoff} />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.summariesTitle}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="summariesOn"
            defaultChecked={settings.summariesOn}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{w.summaries.title}</span>{" "}
            {fillWords(w.summaries.text, { none: needsModel })}{" "}
            <span className="text-muted">{w.summaries.toldInChat}</span>
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{w.conversationsTitle}</h2>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {w.endAfter.before}
          <input
            type="number"
            name="endAfterMinutes"
            min={END_AFTER_MINUTES.min}
            max={END_AFTER_MINUTES.max}
            defaultValue={settings.endAfterMinutes}
            className={`${field} w-20`}
          />
          {w.endAfter.after}
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">{w.namingTitle}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="agentNaming"
              value="first_name"
              defaultChecked={settings.agentNaming === "first_name"}
              className="size-4"
            />
            {w.namingFirst}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="agentNaming"
              value="desk"
              defaultChecked={settings.agentNaming === "desk"}
              className="size-4"
            />
            {fillWords(w.namingDesk, { desk: deskName })}
          </label>
        </fieldset>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {w.keep.before}
          <select
            name="transcriptDays"
            defaultValue={settings.transcriptDays}
            disabled={!owner}
            className={field}
          >
            {TRANSCRIPT_DAYS.map((days) => (
              <option key={days} value={days}>
                {fillWords(w.keep.days, { n: days })}
              </option>
            ))}
          </select>
          {owner ? w.keep.after : w.keep.afterNotOwner}
        </label>
        {formChoice && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{w.forms.title}</span>
            <select
              name="formMessages"
              defaultValue={settings.formMessages}
              className={field}
            >
              {FORM_MESSAGES.map((choice) => (
                <option key={choice} value={choice}>
                  {w.forms.choices[choice]}
                </option>
              ))}
            </select>
            <span className="text-muted">{w.forms.note}</span>
          </label>
        )}
      </section>

      {!disabled && (
        <div>
          <SubmitButton>{w.save}</SubmitButton>
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
  const w = useAdminText("support").settings.toneLine;
  const choices = [-20, -40, -60, -80];
  const options =
    value !== null && !choices.includes(value)
      ? [...choices, value].sort((a, b) => b - a)
      : choices;
  return (
    <select
      name={name}
      defaultValue={value === null ? "off" : String(value)}
      className={field}
    >
      <option value="off">{w.off}</option>
      {options.map((score) => (
        <option key={score} value={score}>
          {score} ({score <= -60 ? w.veryBad : w.bad})
        </option>
      ))}
    </select>
  );
}
