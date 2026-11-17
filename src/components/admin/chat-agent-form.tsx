"use client";

import { useState, useTransition } from "react";

import { avatarFrameStyle } from "@/lib/chat-avatar";
import { AGENT_NAME_MAX, GREETING_MAX, INSTRUCTIONS_MAX, OCCUPATION_MAX } from "@/lib/chat";
import { type ChatAgentInput } from "@/lib/chat-schema";

import { useAdminText } from "./admin-text";
import { ChatAvatarFields } from "./chat-avatar-fields";
import { ImageUploadButton, type Upload } from "./image-upload";
import { PhoneRow, PhoneRows } from "./phone-row";

export type SaveChatAgent = (json: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 py-2";

/**
 * A site's chat agent (D81): whether it is on, who it is (a name, an
 * occupation and a picture, so visitors know whom they talk to), how it
 * greets in each of the site's languages, the site's own guidance, voice,
 * and how many messages a day it answers.
 */
export function ChatAgentForm({
  agent,
  languages,
  voiceReady,
  upload,
  save,
}: {
  agent: ChatAgentInput;
  /** The site's languages, by locale, for the greetings. */
  languages: { locale: string; name: string; greeting: string }[];
  /** Whether the site's AI has speech models and a voice. */
  voiceReady: boolean;
  upload: Upload | null;
  save: SaveChatAgent;
}) {
  const w = useAdminText("platformTools").chat.form;
  const [value, setValue] = useState(agent);
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const set = (patch: Partial<ChatAgentInput>) => setValue((current) => ({ ...current, ...patch }));
  // Round 32 (D706): on a phone each part is a row saying what is set; from the small breakpoint up the form is as before.
  const p = w.phone;
  const row = { change: p.change, done: p.done };
  const agentSub = [value.enabled ? p.on : p.off, value.name.trim() || p.noName, value.avatar ? p.picture : p.noPicture].join(" · ");
  const ownGreeting = Object.values(value.greeting).some((text) => text?.trim());
  const guidance = value.instructions.trim();

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save(JSON.stringify(value));
          setOutcome(result.ok ? { ok: true, messages: [w.saved] } : { ok: false, messages: result.problems });
        });
      }}
    >
      <PhoneRows className="sm:gap-5">
      <PhoneRow title={w.agentRow} sub={agentSub} {...row}>
      <div className="flex flex-col gap-5">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="size-4" />
        <span className="font-medium">{w.show}</span>
      </label>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-col items-center gap-2">
          {value.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded picture as the site shows it
            <img
              src={value.avatar.url}
              alt=""
              width={96}
              height={96}
              style={value.avatarStyle ? avatarFrameStyle(value.avatarStyle) : undefined}
              className={`box-border size-24 rounded-full object-cover ${value.avatarStyle ? "" : "border border-line"}`}
            />
          ) : (
            <span
              aria-hidden
              style={value.avatarStyle ? avatarFrameStyle(value.avatarStyle) : undefined}
              className={`box-border flex size-24 items-center justify-center rounded-full text-sm text-muted ${value.avatarStyle ? "" : "border border-dashed border-line"}`}
            >
              {w.noPicture}
            </span>
          )}
          <ImageUploadButton upload={upload} label={value.avatar ? w.changePicture : w.uploadPicture} onUploaded={(avatar) => set({ avatar })} />
          {value.avatar && (
            <button type="button" onClick={() => set({ avatar: null })} className="text-sm text-muted underline">
              {w.removePicture}
            </button>
          )}
        </div>
        <div className="flex min-w-60 flex-1 flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{w.name}</span>
            <input value={value.name} maxLength={AGENT_NAME_MAX} onChange={(event) => set({ name: event.target.value })} className={field} placeholder={"Ingrid"} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{w.occupation}</span>
            <input
              value={value.occupation}
              maxLength={OCCUPATION_MAX}
              onChange={(event) => set({ occupation: event.target.value })}
              className={field}
              placeholder={w.occupationHint}
            />
          </label>
        </div>
      </div>

      <ChatAvatarFields value={value.avatarStyle} onChange={(avatarStyle) => set({ avatarStyle })} />
      </div>
      </PhoneRow>

      <PhoneRow title={w.greeting} sub={ownGreeting ? p.greetingOwn : p.greetingDefault} {...row}>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.greeting}</legend>
        <p className="text-sm text-muted">{w.greetingText}</p>
        {languages.map((language) => (
          <label key={language.locale} className="flex flex-col gap-1">
            <span className="text-sm">{language.name}</span>
            <textarea
              rows={2}
              maxLength={GREETING_MAX}
              value={value.greeting[language.locale] ?? ""}
              placeholder={language.greeting}
              onChange={(event) => set({ greeting: { ...value.greeting, [language.locale]: event.target.value } })}
              className={field}
            />
          </label>
        ))}
      </fieldset>
      </PhoneRow>

      <PhoneRow title={w.guidance} sub={guidance ? (guidance.length > 48 ? `${guidance.slice(0, 47)}…` : guidance) : p.guidanceNone} {...row}>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{w.guidance}</span>
        <span className="text-sm text-muted">{w.guidanceText}</span>
        <textarea
          rows={5}
          maxLength={INSTRUCTIONS_MAX}
          value={value.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
          className={field}
          placeholder={w.guidanceHint}
        />
      </label>
      </PhoneRow>

      <PhoneRow title={w.talk} sub={value.voice ? p.talkOn : p.talkOff} {...row}>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={value.voice} onChange={(event) => set({ voice: event.target.checked })} className="mt-1 size-4" />
        <span>
          <span className="font-medium">{w.talk}</span>
          <span className="block text-sm text-muted">
            {w.talkText}
            {!voiceReady && w.talkNeeds}
          </span>
        </span>
      </label>
      </PhoneRow>

      <PhoneRow last title={w.perDay} sub={p.perDay.replace("{n}", String(value.dailyLimit))} {...row}>

      <label className="flex max-w-60 flex-col gap-1">
        <span className="text-sm font-medium">{w.perDay}</span>
        <span className="text-sm text-muted">{w.perDayText}</span>
        <input
          type="number"
          min={1}
          max={100_000}
          value={value.dailyLimit}
          onChange={(event) => set({ dailyLimit: Number(event.target.value) })}
          className={field}
        />
      </label>
      </PhoneRow>
      </PhoneRows>

      <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
        <button type="submit" disabled={pending} className="min-h-10 max-sm:min-h-11 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40">
          {pending ? w.saving : w.save}
        </button>
        <div role="status" aria-live="polite" className="text-sm">
          {outcome?.ok && <p>{outcome.messages[0]}</p>}
          {outcome && !outcome.ok && (
            <ul className="list-disc pl-5 text-danger-text">
              {outcome.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </form>
  );
}
