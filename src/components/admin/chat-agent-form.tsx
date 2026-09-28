"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AGENT_NAME_MAX, GREETING_MAX, INSTRUCTIONS_MAX, OCCUPATION_MAX, type ChatAgentInput } from "@/lib/chat";

import { ImageUploadButton, type Upload } from "./image-upload";

export type SaveChatAgent = (json: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 py-2";

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
  const router = useRouter();
  const [value, setValue] = useState(agent);
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const set = (patch: Partial<ChatAgentInput>) => setValue((current) => ({ ...current, ...patch }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save(JSON.stringify(value));
          setOutcome(result.ok ? { ok: true, messages: ["Saved."] } : { ok: false, messages: result.problems });
          if (result.ok) router.refresh();
        });
      }}
    >
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="size-4" />
        <span className="font-medium">Show the chat on the site</span>
      </label>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-col items-center gap-2">
          {value.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded picture as the site shows it
            <img src={value.avatar.url} alt="" width={96} height={96} className="size-24 rounded-full border border-border object-cover" />
          ) : (
            <span aria-hidden className="flex size-24 items-center justify-center rounded-full border border-dashed border-border text-sm text-muted">
              No picture
            </span>
          )}
          <ImageUploadButton upload={upload} label={value.avatar ? "Change picture" : "Upload a picture"} onUploaded={(avatar) => set({ avatar })} />
          {value.avatar && (
            <button type="button" onClick={() => set({ avatar: null })} className="text-sm text-muted underline">
              Remove picture
            </button>
          )}
        </div>
        <div className="flex min-w-60 flex-1 flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Name</span>
            <input value={value.name} maxLength={AGENT_NAME_MAX} onChange={(event) => set({ name: event.target.value })} className={field} placeholder="Ingrid" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Occupation</span>
            <input
              value={value.occupation}
              maxLength={OCCUPATION_MAX}
              onChange={(event) => set({ occupation: event.target.value })}
              className={field}
              placeholder="Customer service"
            />
          </label>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Greeting</legend>
        <p className="text-sm text-muted">The first words visitors see. Left empty, the agent introduces itself by name.</p>
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

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Guidance for the agent</span>
        <span className="text-sm text-muted">
          Tone of voice and what to point out, in your own words. The agent follows it within its rules: it only talks about this
          site, and states prices, stock and policies only as the site gives them.
        </span>
        <textarea
          rows={5}
          maxLength={INSTRUCTIONS_MAX}
          value={value.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
          className={field}
          placeholder="Friendly and short. Suggest the gift wrapping for presents."
        />
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={value.voice} onChange={(event) => set({ voice: event.target.checked })} className="mt-1 size-4" />
        <span>
          <span className="font-medium">Let visitors talk</span>
          <span className="block text-sm text-muted">
            Visitors press the microphone and speak; the agent answers aloud as well as in writing.
            {!voiceReady && " It needs speech models and a voice on the AI page first; until then the chat is typed only."}
          </span>
        </span>
      </label>

      <label className="flex max-w-60 flex-col gap-1">
        <span className="text-sm font-medium">Messages a day</span>
        <span className="text-sm text-muted">After this many, the chat rests until tomorrow, which caps what it costs.</span>
        <input
          type="number"
          min={1}
          max={100_000}
          value={value.dailyLimit}
          onChange={(event) => set({ dailyLimit: Number(event.target.value) })}
          className={field}
        />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">
          {pending ? "Saving …" : "Save"}
        </button>
        <div role="status" aria-live="polite" className="text-sm">
          {outcome?.ok && <p>{outcome.messages[0]}</p>}
          {outcome && !outcome.ok && (
            <ul className="list-disc pl-5 text-red-700 dark:text-red-400">
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
