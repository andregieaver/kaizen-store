"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { PLACEHOLDERS, REPLY_BODY_MAX, REPLY_SHORTCUT_MAX, REPLY_TITLE_MAX, shortcutFrom, unknownPlaceholders, type SavedReply } from "@/lib/support-replies";

type Save = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * A desk's saved replies (D216, 2.4, step 13): each with its title, its /shortcut, the language it is for (or any) and its text,
 * changed or deleted in place, and a new one at the top. Those who only read the desk see the list without the forms.
 */
export function RepliesManager({ replies, languages, save, remove }: { replies: SavedReply[]; languages: { code: string; name: string }[]; save: Save | null; remove: Save | null }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p>
          Type <kbd className="rounded border border-border px-1 font-mono">/</kbd> at the start of a line in the inbox&apos;s composer to pick a reply by its
          shortcut or title. These are filled in for the conversation:
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {Object.entries(PLACEHOLDERS).map(([name, words]) => (
            <li key={name}>
              <code className="font-mono">{`{${name}}`}</code> <span className="text-muted">{words}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">A name that is not known is left out (&ldquo;Hi {"{customer_first_name}"},&rdquo; becomes &ldquo;Hi,&rdquo;). Nothing is sent until you press Send.</p>
      </section>
      {save && (
        <section aria-labelledby="new-reply" className="flex flex-col gap-2">
          <h2 id="new-reply" className="text-lg font-semibold">
            New saved reply
          </h2>
          <ReplyForm languages={languages} save={save} />
        </section>
      )}
      <section aria-labelledby="all-replies" className="flex flex-col gap-3">
        <h2 id="all-replies" className="text-lg font-semibold">
          Saved replies ({replies.length})
        </h2>
        {replies.length === 0 ? (
          <p className="text-muted">No saved replies yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {replies.map((reply) => (
              <li key={reply.id} className="rounded-lg border border-border p-4">
                {save ? (
                  <details>
                    <summary className="cursor-pointer">
                      <ReplyHeading reply={reply} languages={languages} />
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <ReplyForm languages={languages} save={save} reply={reply} />
                      {remove && (
                        <ActionForm action={remove} successMessage="Deleted.">
                          <input type="hidden" name="id" value={reply.id} />
                          <SubmitButton variant="secondary" skipValidation>
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </details>
                ) : (
                  <ReplyHeading reply={reply} languages={languages} />
                )}
                <p className="mt-2 text-sm whitespace-pre-line text-muted">{reply.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReplyHeading({ reply, languages }: { reply: SavedReply; languages: { code: string; name: string }[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-sm text-muted">/{reply.shortcut}</span>
      <span className="font-medium">{reply.title}</span>
      <span className="text-xs text-muted">{reply.locale ? (languages.find((l) => l.code === reply.locale)?.name ?? reply.locale) : "Any language"}</span>
    </span>
  );
}

function ReplyForm({ languages, save, reply }: { languages: { code: string; name: string }[]; save: Save; reply?: SavedReply }) {
  const [title, setTitle] = useState(reply?.title ?? "");
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "");
  const [touched, setTouched] = useState(Boolean(reply));
  const [body, setBody] = useState(reply?.body ?? "");
  const unknown = unknownPlaceholders(body);
  const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  const id = reply?.id ?? "new";
  return (
    <ActionForm action={save} className="flex flex-col gap-3" successMessage={reply ? "Saved." : "Added."}>
      {reply && <input type="hidden" name="id" value={reply.id} />}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1 text-sm" htmlFor={`title-${id}`}>
          Title
          <input
            id={`title-${id}`}
            name="title"
            required
            maxLength={REPLY_TITLE_MAX}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (!touched) setShortcut(shortcutFrom(event.target.value));
            }}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`shortcut-${id}`}>
          Shortcut
          <span className="flex items-center gap-1">
            <span aria-hidden className="font-mono text-muted">
              /
            </span>
            <input
              id={`shortcut-${id}`}
              name="shortcut"
              required
              maxLength={REPLY_SHORTCUT_MAX}
              pattern="[a-z0-9][a-z0-9\-]*"
              value={shortcut}
              onChange={(event) => {
                setTouched(true);
                setShortcut(event.target.value.toLowerCase());
              }}
              className={`${field} font-mono`}
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`locale-${id}`}>
          Language
          <select id={`locale-${id}`} name="locale" defaultValue={reply?.locale ?? ""} className={field}>
            <option value="">Any language</option>
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`body-${id}`}>
        Text
        <textarea id={`body-${id}`} name="body" required maxLength={REPLY_BODY_MAX} rows={4} value={body} onChange={(event) => setBody(event.target.value)} className={field} />
      </label>
      {unknown.length > 0 && (
        <p className="text-sm" role="status">
          Not a placeholder, so it stays as written: {unknown.map((name) => `{${name}}`).join(", ")}
        </p>
      )}
      <div>
        <SubmitButton>{reply ? "Save" : "Add saved reply"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
