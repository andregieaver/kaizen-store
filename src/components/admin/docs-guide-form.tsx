"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { avatarFrameStyle } from "@/lib/chat-avatar";
import { AGENT_NAME_MAX, GREETING_MAX, INSTRUCTIONS_MAX, OCCUPATION_MAX } from "@/lib/chat";
import type { GuideSettingsInput } from "@/lib/docs-guide-schema";
import type { GuideLang } from "@/lib/docs-guide-shape";

import { useAdminText } from "./admin-text";
import { ChatAvatarFields } from "./chat-avatar-fields";
import { ImageUploadButton, type Upload } from "./image-upload";

export type SaveDocsGuide = (json: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 py-2";

/**
 * The docs guide's settings (D444), Homer first: whether it answers, its name and picture, how it greets in English and Norwegian, and how
 * many messages a day it answers. Lisa's depth is one step away under Customise: its occupation, the picture's frame and the platform's own
 * guidance on tone, which comes after the fixed rules and never above them.
 */
export function DocsGuideForm({
  guide,
  greetings,
  upload,
  save,
}: {
  guide: GuideSettingsInput;
  /** The built-in greeting per docs language, shown where none is written. */
  greetings: Record<GuideLang, string>;
  upload: Upload | null;
  save: SaveDocsGuide;
}) {
  const router = useRouter();
  const w = useAdminText("platform").docsGuide.form;
  const [value, setValue] = useState(guide);
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const set = (patch: Partial<GuideSettingsInput>) => setValue((current) => ({ ...current, ...patch }));
  const languages: { lang: GuideLang; name: string }[] = [
    { lang: "en", name: w.english },
    { lang: "nb", name: w.norwegian },
  ];

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save(JSON.stringify(value));
          setOutcome(result.ok ? { ok: true, messages: [w.saved] } : { ok: false, messages: result.problems });
          if (result.ok) router.refresh();
        });
      }}
    >
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="size-4" />
        <span className="font-medium">{w.on}</span>
      </label>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-col items-center gap-2">
          {value.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded picture as the docs show it
            <img
              src={value.avatar.url}
              alt=""
              width={96}
              height={96}
              style={value.avatarStyle ? avatarFrameStyle(value.avatarStyle) : undefined}
              className={`box-border size-24 rounded-full object-cover ${value.avatarStyle ? "" : "border border-line"}`}
            />
          ) : (
            <span aria-hidden className="box-border flex size-24 items-center justify-center rounded-full border border-dashed border-line text-sm text-muted">
              {w.noPicture}
            </span>
          )}
          <ImageUploadButton upload={upload} label={value.avatar ? w.changePicture : w.uploadPicture} onUploaded={(avatar) => set({ avatar })} make={false} />
          {value.avatar && (
            <button type="button" onClick={() => set({ avatar: null })} className="text-sm text-muted underline">
              {w.removePicture}
            </button>
          )}
        </div>
        <label className="flex min-w-60 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{w.name}</span>
          <input value={value.name} maxLength={AGENT_NAME_MAX} onChange={(event) => set({ name: event.target.value })} className={field} placeholder={w.namePlaceholder} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.greeting}</legend>
        <p className="text-sm text-muted">{w.greetingText}</p>
        {languages.map((language) => (
          <label key={language.lang} className="flex flex-col gap-1">
            <span className="text-sm">{language.name}</span>
            <textarea
              rows={2}
              maxLength={GREETING_MAX}
              value={value.greeting[language.lang] ?? ""}
              placeholder={greetings[language.lang]}
              onChange={(event) => set({ greeting: { ...value.greeting, [language.lang]: event.target.value } })}
              className={field}
            />
          </label>
        ))}
      </fieldset>

      <label className="flex max-w-60 flex-col gap-1">
        <span className="text-sm font-medium">{w.perDay}</span>
        <span className="text-sm text-muted">{w.perDayText}</span>
        <input type="number" min={1} max={100_000} value={value.dailyLimit} onChange={(event) => set({ dailyLimit: Number(event.target.value) })} className={field} />
      </label>

      <details data-advanced className="rounded-md border border-line p-4">
        <summary className="cursor-pointer font-medium">{w.customise}</summary>
        <div className="mt-4 flex flex-col gap-5">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{w.occupation}</span>
            <input value={value.occupation} maxLength={OCCUPATION_MAX} onChange={(event) => set({ occupation: event.target.value })} className={field} placeholder={w.occupationPlaceholder} />
          </label>
          <ChatAvatarFields value={value.avatarStyle} onChange={(avatarStyle) => set({ avatarStyle })} />
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{w.guidance}</span>
            <span className="text-sm text-muted">{w.guidanceText}</span>
            <textarea rows={5} maxLength={INSTRUCTIONS_MAX} value={value.instructions} onChange={(event) => set({ instructions: event.target.value })} className={field} placeholder={w.guidancePlaceholder} />
          </label>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40">
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
