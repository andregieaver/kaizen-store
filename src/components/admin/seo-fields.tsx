"use client";

import { useId, useState } from "react";

import { shrinkImage } from "@/lib/image-resize";
import { DESCRIPTION_ADVICE, DESCRIPTION_MAX, TITLE_ADVICE, TITLE_MAX, summarize } from "@/lib/seo";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";

/** The snippet fields' words (D312 A5): English unless a page hands in the admin's catalogue (the product editor's `product.seo`). */
const SNIPPET_EN = {
  count: "{length} of about {advice} characters",
  cut: ": search engines may cut the end",
  title: "Title in search results",
  description: "Description in search results",
  preview: "Preview in search results",
};

export type SnippetWords = typeof SNIPPET_EN;

/** "42 of 60 characters", and a word when search engines are likely to cut the text. */
function Count({ id, length, advice, words }: { id: string; length: number; advice: number; words: SnippetWords }) {
  return (
    <span id={id} className={`text-xs font-normal ${length > advice ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}>
      {words.count.replace("{length}", String(length)).replace("{advice}", String(advice))}
      {length > advice ? words.cut : ""}
    </span>
  );
}

type Texts = { title: string; description: string };

/**
 * A search result's title and description, with how Google would show them.
 * Controlled: the product editor keeps the text in its own state.
 */
export function SearchSnippetFields({
  value,
  onChange,
  fallback,
  url,
  lang,
  names,
  words = SNIPPET_EN,
}: {
  value: Texts;
  onChange: (value: Texts) => void;
  /** Shown when a field is empty, and used by the page instead. */
  fallback: Texts;
  url: string;
  lang: string;
  /** Form field names, when the fields post with a form. */
  names?: { title: string; description: string };
  words?: SnippetWords;
}) {
  const id = useId();
  const title = value.title || fallback.title;
  const description = value.description || fallback.description;
  return (
    <div className="flex flex-col gap-4">
      <label className={label}>
        {words.title}
        <input
          name={names?.title}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          maxLength={TITLE_MAX}
          placeholder={fallback.title}
          lang={lang}
          aria-describedby={`${id}-title`}
          className={input}
        />
        <Count id={`${id}-title`} length={title.length} advice={TITLE_ADVICE} words={words} />
      </label>
      <label className={label}>
        {words.description}
        <textarea
          name={names?.description}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          maxLength={DESCRIPTION_MAX}
          placeholder={fallback.description}
          rows={3}
          lang={lang}
          aria-describedby={`${id}-description`}
          className={`${input} py-2`}
        />
        <Count id={`${id}-description`} length={description.length} advice={DESCRIPTION_ADVICE} words={words} />
      </label>
      <figure className="min-w-0 rounded-md border border-border p-3">
        <figcaption className="mb-2 text-xs text-muted">{words.preview}</figcaption>
        <div lang={lang}>
          <p className="truncate text-xs text-muted">{url.replace(/^https?:\/\//, "").replace(/\//g, " › ")}</p>
          <p className="truncate text-lg text-blue-800 dark:text-blue-300">{summarize(title, TITLE_ADVICE)}</p>
          <p className="text-sm">{summarize(description, DESCRIPTION_ADVICE)}</p>
        </div>
      </figure>
    </div>
  );
}

/** The same fields for a plain form: the text posts as `title:{locale}` and `description:{locale}`. */
export function SearchTextFields({
  locale,
  initial,
  fallback,
  url,
  words,
}: {
  locale: string;
  initial: Texts;
  fallback: Texts;
  url: string;
  words?: SnippetWords;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SearchSnippetFields
      value={value}
      onChange={setValue}
      fallback={fallback}
      url={url}
      words={words}
      lang={locale}
      names={{ title: `title:${locale}`, description: `description:${locale}` }}
    />
  );
}

type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;

/**
 * The picture shown when a page is shared (1200 × 630 is best), with its
 * description per language. Posts as `imageUrl` and `imageAlt:{locale}`.
 */
/** The share picture field's words (D312 A8): English unless a page hands in the admin's catalogue (`settings.seo.shareField`). */
const SHARE_EN = {
  yours: "Your picture.",
  none: "No picture chosen: Kaizena Flow draws one with the name, as shown.",
  best: "Best at 1200 × 630 pixels.",
  uploading: "Uploading …",
  another: "Choose another picture",
  choose: "Choose a picture",
  address: "Picture address",
  use: "Use",
  remove: "Remove picture",
  describe: "Describe the picture (for people who cannot see it)",
};

export type ShareWords = typeof SHARE_EN;

export function ShareImageField({
  upload,
  initial,
  locales,
  languageNames,
  generated,
  words = SHARE_EN,
}: {
  upload: Upload | null;
  initial: { url: string; alt: Record<string, string> } | null;
  locales: string[];
  languageNames: Record<string, string>;
  /** The picture Kaizen draws when none is chosen. */
  generated: string;
  words?: ShareWords;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    try {
      const [image, thumbnail] = await Promise.all([shrinkImage(file, 1200), shrinkImage(file, 480)]);
      const ext = image.type === "image/webp" ? "webp" : "jpg";
      const data = new FormData();
      data.set("image", new File([image], `share.${ext}`, { type: image.type }));
      // Its name as it was on the owner's computer, for the media library (D88).
      data.set("name", file.name);
      data.set("thumbnail", new File([thumbnail], `share-480.${ext}`, { type: thumbnail.type }));
      // Compressed until it was as small as it could be while it looked the same (D213).
      data.set("compressed", "1");
      const outcome = await upload(data);
      if (outcome.ok) setUrl(outcome.url);
      else setProblem(outcome.problem);
    } catch {
      setProblem(`${file.name} could not be read as a picture.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="imageUrl" value={url} />
      <div className="flex flex-wrap items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of the chosen or drawn picture */}
        <img
          src={url || generated}
          alt=""
          className="aspect-[1200/630] w-72 rounded-md border border-border bg-surface object-cover"
        />
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted">
            {url ? words.yours : words.none} {words.best}
          </p>
          {upload ? (
            <label className="w-fit cursor-pointer rounded-md border border-border px-3 py-2 focus-within:outline-2">
              {busy ? words.uploading : url ? words.another : words.choose}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
          ) : (
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="share-image-link">
                {words.address}
              </label>
              <input
                id="share-image-link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…"
                className={`${input} w-full max-w-64`}
              />
              <button type="button" onClick={() => setUrl(link.trim())} className="rounded-pill border border-border px-3">
                {words.use}
              </button>
            </div>
          )}
          {url && (
            <button type="button" onClick={() => setUrl("")} className="w-fit underline">
              {words.remove}
            </button>
          )}
          {problem && (
            <p role="alert" className="text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
        </div>
      </div>
      {url && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{words.describe}</legend>
          {locales.map((locale) => (
            <label key={locale} className="flex flex-col gap-1 text-sm">
              {languageNames[locale] ?? locale}
              <input
                name={`imageAlt:${locale}`}
                defaultValue={initial?.alt[locale] ?? ""}
                maxLength={300}
                lang={locale}
                className={input}
              />
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
