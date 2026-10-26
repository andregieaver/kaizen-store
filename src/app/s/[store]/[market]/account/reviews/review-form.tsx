"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { REVIEW_BODY_MAX, REVIEW_NAME_MAX, REVIEW_PICTURE_BYTES, REVIEW_PICTURES_MAX, REVIEW_THUMB_BYTES, REVIEW_THUMB_SIZE, REVIEW_TITLE_MAX } from "@/lib/review-status";

import type { ReviewFormState } from "./actions";

/** The words the form draws, in the market's language, given by the page (D301). */
export type ReviewFormWords = {
  rating: string;
  stars: string[];
  titleLabel: string;
  bodyLabel: string;
  nameLabel: string;
  nameHint: string;
  submit: string;
  problems: Record<NonNullable<ReviewFormState["problem"]>, string>;
  pictures: { label: string; hint: string; add: string; remove: string; preparing: string; unreadable: string; hidden: string; alt: string };
};

/** The review's own pictures as the form shows them: `url` its small copy for the author, or null where it cannot be shown here. */
export type FormPicture = { id: string; url: string | null; hidden: boolean };

type Added = { key: string; full: Blob; thumb: Blob; preview: string };

/** The long sides tried for a picture, largest first, until it is small enough to send (9.7). */
const SIDES = [1600, 1280, 1024];

/** A chosen photo made smaller in the browser (D213's compressor, no AVIF): the picture within its byte limit, and its small copy. */
async function prepare(file: File): Promise<Omit<Added, "key" | "preview">> {
  const { compressPicture } = await import("@/lib/image-compress");
  const thumb = await compressPicture(file, REVIEW_THUMB_SIZE);
  for (const side of SIDES) {
    const full = await compressPicture(file, side);
    if (full.blob.size <= REVIEW_PICTURE_BYTES && thumb.blob.size <= REVIEW_THUMB_BYTES && full.type === thumb.type) return { full: full.blob, thumb: thumb.blob };
  }
  throw new Error("The picture stays too large.");
}

/**
 * A buyer's review (D301 9.3): stars as a radio group (required), a title, the text, the name to show and (G4) up to three pictures, made smaller
 * here before they are sent with the review. The words typed stay in the fields when the server refuses them (the fields are uncontrolled and the
 * form is not reset on an error), and so do the pictures chosen.
 */
export function ReviewForm({
  action,
  words,
  initial,
  pictures,
}: {
  action: (state: ReviewFormState, form: FormData) => Promise<ReviewFormState>;
  words: ReviewFormWords;
  initial: { rating: number | null; title: string; body: string; name: string };
  /** Null where pictures cannot be added (the store has no place for them); else the review's own. */
  pictures: FormPicture[] | null;
}) {
  const [state, formAction, pending] = useActionState(action, { problem: null });
  const [kept, setKept] = useState<FormPicture[]>(pictures ?? []);
  const [added, setAdded] = useState<Added[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const room = REVIEW_PICTURES_MAX - kept.length - added.length;

  async function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPreparing(true);
    setUnreadable(false);
    const made: Added[] = [];
    for (const file of [...files].slice(0, room)) {
      try {
        const done = await prepare(file);
        const preview = URL.createObjectURL(done.thumb);
        previews.current.push(preview);
        made.push({ ...done, key: crypto.randomUUID(), preview });
      } catch {
        setUnreadable(true);
      }
    }
    setAdded((a) => [...a, ...made].slice(0, REVIEW_PICTURES_MAX - kept.length));
    setPreparing(false);
    if (input.current) input.current.value = "";
  }

  // The chosen file input is left out; the prepared pictures go in its place, each with its small copy.
  const send = (form: FormData) => {
    form.delete("choose");
    for (const a of added) {
      form.append("picture", a.full, `picture.${a.full.type === "image/webp" ? "webp" : "jpg"}`);
      form.append("thumb", a.thumb, `thumb.${a.thumb.type === "image/webp" ? "webp" : "jpg"}`);
    }
    formAction(form);
  };

  return (
    <form action={send} aria-busy={pending} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{words.rating}</legend>
        <div className="flex flex-row-reverse justify-end gap-1">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="kz-star-choice cursor-pointer">
              <input type="radio" name="rating" value={n} defaultChecked={initial.rating === n} required className="peer sr-only" />
              <span aria-hidden="true" className="block text-3xl leading-none text-muted peer-focus-visible:outline peer-focus-visible:outline-2">
                ★
              </span>
              <span className="sr-only">{words.stars[n - 1]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.titleLabel}</span>
        <input name="title" defaultValue={initial.title} maxLength={REVIEW_TITLE_MAX} className="min-h-11 rounded-lg border border-border px-3" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.bodyLabel}</span>
        <textarea name="body" defaultValue={initial.body} maxLength={REVIEW_BODY_MAX} rows={6} className="rounded-lg border border-border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.nameLabel}</span>
        <input name="name" defaultValue={initial.name} required maxLength={REVIEW_NAME_MAX} autoComplete="off" className="min-h-11 rounded-lg border border-border px-3" />
        <span className="text-sm text-muted">{words.nameHint}</span>
      </label>
      {pictures !== null && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{words.pictures.label}</legend>
          <p className="text-sm text-muted">{words.pictures.hint}</p>
          <input type="hidden" name="pictures" value="shown" />
          {(kept.length > 0 || added.length > 0) && (
            <ul className="flex flex-wrap gap-3" data-review-form-pictures>
              {kept.map((p, i) => (
                <li key={p.id} className="flex flex-col items-start gap-1">
                  <input type="hidden" name="keep" value={p.id} />
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the author's own small copy, served by its route
                    <img src={p.url} alt={words.pictures.alt.replace("{0}", String(i + 1))} className="h-24 w-auto rounded-lg border border-border object-cover" />
                  ) : (
                    <span className="flex h-24 w-24 items-center justify-center rounded-lg border border-border text-sm text-muted">{words.pictures.alt.replace("{0}", String(i + 1))}</span>
                  )}
                  {p.hidden && <span className="text-xs text-muted">{words.pictures.hidden}</span>}
                  <button type="button" onClick={() => setKept((k) => k.filter((x) => x.id !== p.id))} className="text-sm underline">
                    {words.pictures.remove}
                  </button>
                </li>
              ))}
              {added.map((a, i) => (
                <li key={a.key} className="flex flex-col items-start gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a picture chosen on this device, shown before it is sent */}
                  <img src={a.preview} alt={words.pictures.alt.replace("{0}", String(kept.length + i + 1))} className="h-24 w-auto rounded-lg border border-border object-cover" />
                  <button type="button" onClick={() => setAdded((list) => list.filter((x) => x.key !== a.key))} className="text-sm underline">
                    {words.pictures.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {room > 0 && (
            <label className="min-h-11 cursor-pointer self-start rounded-button border border-border px-4 py-2 font-medium">
              {words.pictures.add}
              <input
                ref={input}
                type="file"
                name="choose"
                accept="image/*"
                multiple
                disabled={preparing}
                onChange={(e) => void choose(e.currentTarget.files)}
                className="sr-only"
              />
            </label>
          )}
          {preparing && (
            <p role="status" className="text-sm text-muted">
              {words.pictures.preparing}
            </p>
          )}
          {unreadable && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {words.pictures.unreadable}
            </p>
          )}
        </fieldset>
      )}
      {state.problem && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {words.problems[state.problem]}
        </p>
      )}
      <button type="submit" disabled={pending || preparing} className="min-h-11 self-start button-primary px-5 font-medium">
        {words.submit}
      </button>
    </form>
  );
}
