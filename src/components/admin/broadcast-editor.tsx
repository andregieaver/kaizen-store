"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  BLOCKS_MAX,
  emptyContent,
  suggestionBlocks,
  type BroadcastAudience,
  type BroadcastBlock,
  type BroadcastContent,
  type BroadcastSuggestion,
  type LanguageContent,
} from "@/lib/broadcasts";
import { compressPicture, extensionOf } from "@/lib/image-compress";

import { Button, CARD_CLASS } from "./ui";

type Problem = { ok: false; problem: string };

type Props = {
  storeSlug: string;
  broadcastId: string | null;
  initial: { title: string; audience: BroadcastAudience; segmentId: string | null; content: BroadcastContent };
  /** The store's languages, main first. */
  locales: { code: string; name: string }[];
  segments: { id: string; name: string }[];
  /** The site's AI has a text model, so *Write with AI* is offered. */
  aiReady: boolean;
  save: (storeSlug: string, id: string | null, input: unknown) => Promise<Problem | { ok: true }>;
  count: (storeSlug: string, audience: string, segmentId: string | null) => Promise<Problem | { ok: true; people: number }>;
  suggest: (storeSlug: string, brief: string, locale: string) => Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }>;
  upload: ((storeSlug: string, data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>) | null;
};

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3";

const ADD: { type: BroadcastBlock["type"]; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "paragraph", label: "Text" },
  { type: "button", label: "Button" },
  { type: "image", label: "Picture" },
  { type: "divider", label: "Line" },
];

function newBlock(type: BroadcastBlock["type"]): BroadcastBlock {
  switch (type) {
    case "heading":
      return { type, text: "" };
    case "paragraph":
      return { type, text: "" };
    case "button":
      return { type, text: "", url: "/" };
    case "image":
      return { type, url: "", alt: "", href: null };
    case "divider":
      return { type };
  }
}

/**
 * A broadcast's words (D297, docs/wave-5-marketing.md 5.1): its name, who it is for (counted as it changes, numbers only), and per language a
 * subject, a preview line and blocks. *Write with AI* suggests words for one language, which the person reads before saving. Saving sends the
 * whole broadcast, which the server checks again.
 */
export function BroadcastEditor(props: Props) {
  const { storeSlug } = props;
  const main = props.locales[0]?.code ?? "nb-NO";
  const [title, setTitle] = useState(props.initial.title);
  const [audience, setAudience] = useState<BroadcastAudience>(props.initial.audience);
  const [segmentId, setSegmentId] = useState<string | null>(props.initial.segmentId ?? props.segments[0]?.id ?? null);
  const [content, setContent] = useState<BroadcastContent>(props.initial.content);
  const [locale, setLocale] = useState(main);
  const [people, setPeople] = useState<string>("Counting…");
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = props.count;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      count(storeSlug, audience, audience === "segment" ? segmentId : null).then(
        (r) => setPeople(r.ok ? `It goes to ${r.people.toLocaleString("en-GB")} ${r.people === 1 ? "person" : "people"} who want your emails, as of now.` : r.problem),
        () => setPeople("The count could not be made."),
      );
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [audience, segmentId, count, storeSlug]);

  const current: LanguageContent = content[locale] ?? emptyContent();
  const setCurrent = (next: LanguageContent) => {
    setSaved(false);
    setContent((c) => ({ ...c, [locale]: next }));
  };
  const setBlock = (index: number, block: BroadcastBlock) => setCurrent({ ...current, blocks: current.blocks.map((b, i) => (i === index ? block : b)) });
  const move = (index: number, by: number) => {
    const blocks = [...current.blocks];
    const [b] = blocks.splice(index, 1);
    blocks.splice(index + by, 0, b);
    setCurrent({ ...current, blocks });
  };

  const submit = () =>
    startSave(async () => {
      setProblem(null);
      // A language left empty is not kept.
      const written = Object.fromEntries(Object.entries(content).filter(([, c]) => c.subject.trim() || c.preview.trim() || c.blocks.length > 0));
      const result = await props.save(storeSlug, props.broadcastId, { title, audience, segmentId: audience === "segment" ? segmentId : null, content: written });
      if (result && !result.ok) setProblem(result.problem);
      else setSaved(true);
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="broadcast-title" className="text-body-strong text-ink">
          Name
        </label>
        <span className="text-caption text-muted">For you only: subscribers see the subject.</span>
        <input id="broadcast-title" value={title} maxLength={80} onChange={(e) => (setSaved(false), setTitle(e.target.value))} className={`${field} max-w-md`} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body-strong text-ink">Who gets it</legend>
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="radio" name="audience" checked={audience === "everyone"} onChange={() => (setSaved(false), setAudience("everyone"))} />
          Everyone who wants your emails
        </label>
        <label className="flex flex-wrap items-center gap-2 text-body text-ink">
          <input type="radio" name="audience" checked={audience === "segment"} disabled={props.segments.length === 0} onChange={() => (setSaved(false), setAudience("segment"))} />
          The people in a segment who want your emails
          {audience === "segment" && (
            <select aria-label="Segment" value={segmentId ?? ""} onChange={(e) => (setSaved(false), setSegmentId(e.target.value || null))} className="min-h-10 rounded-md border border-line bg-card px-3">
              {props.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </label>
        {props.segments.length === 0 && <p className="text-caption text-muted">Make a segment under Marketing → Segments to send to some of them only.</p>}
        <p role="status" aria-live="polite" className="text-body text-ink-2">
          {people}
        </p>
      </fieldset>

      {props.locales.length > 1 && (
        <div role="tablist" aria-label="Language" className="flex flex-wrap gap-2">
          {props.locales.map((l, i) => (
            <button
              key={l.code}
              role="tab"
              type="button"
              aria-selected={l.code === locale}
              onClick={() => setLocale(l.code)}
              className={`rounded-pill border px-3 py-1 text-body ${l.code === locale ? "border-edge bg-sunken text-ink" : "border-line text-ink-2 hover:bg-sunken"}`}
            >
              {l.name}
              {i === 0 ? " (main)" : content[l.code]?.subject ? "" : " · not written"}
            </button>
          ))}
        </div>
      )}

      {props.aiReady && <AiWriter storeSlug={storeSlug} locale={locale} suggest={props.suggest} onUse={(s) => setCurrent({ subject: s.subject, preview: s.preview, blocks: suggestionBlocks(s) })} />}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="broadcast-subject" className="text-body-strong text-ink">
            Subject
          </label>
          <input id="broadcast-subject" value={current.subject} maxLength={150} onChange={(e) => setCurrent({ ...current, subject: e.target.value })} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="broadcast-preview" className="text-body-strong text-ink">
            Preview line
          </label>
          <span className="text-caption text-muted">Shown beside the subject in most mail apps. Optional.</span>
          <input id="broadcast-preview" value={current.preview} maxLength={200} onChange={(e) => setCurrent({ ...current, preview: e.target.value })} className={field} />
        </div>

        <ol className="flex flex-col gap-3" aria-label="What the email says">
          {current.blocks.map((block, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-panel border border-line bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-strong text-ink">{ADD.find((a) => a.type === block.type)?.label}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="dense" kind="quiet" disabled={i === 0} onClick={() => move(i, -1)}>
                    Up
                  </Button>
                  <Button size="dense" kind="quiet" disabled={i === current.blocks.length - 1} onClick={() => move(i, 1)}>
                    Down
                  </Button>
                  <Button size="dense" kind="quiet" onClick={() => setCurrent({ ...current, blocks: current.blocks.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                </span>
              </div>
              <BlockFields block={block} index={i} onChange={(b) => setBlock(i, b)} storeSlug={storeSlug} upload={props.upload} />
            </li>
          ))}
        </ol>
        {current.blocks.length === 0 && <p className="text-body text-muted">Nothing here yet. Add a heading and some text.</p>}
        {current.blocks.length < BLOCKS_MAX && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-ink-2">Add</span>
            {ADD.filter((a) => a.type !== "image" || props.upload).map((a) => (
              <Button key={a.type} size="dense" onClick={() => setCurrent({ ...current, blocks: [...current.blocks, newBlock(a.type)] })}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button kind="main" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : props.broadcastId ? "Save" : "Save draft"}
        </Button>
        {saved && (
          <span role="status" className="text-body text-positive-text">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}

function BlockFields({
  block,
  index,
  onChange,
  storeSlug,
  upload,
}: {
  block: BroadcastBlock;
  index: number;
  onChange: (b: BroadcastBlock) => void;
  storeSlug: string;
  upload: Props["upload"];
}) {
  const id = (name: string) => `block-${index}-${name}`;
  switch (block.type) {
    case "heading":
      return <input aria-label="Heading" value={block.text} maxLength={150} onChange={(e) => onChange({ ...block, text: e.target.value })} className={field} />;
    case "paragraph":
      return <textarea aria-label="Text" value={block.text} maxLength={3000} rows={4} onChange={(e) => onChange({ ...block, text: e.target.value })} className={`${field} py-2`} />;
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <label htmlFor={id("words")} className="flex flex-col gap-1 text-caption text-ink-2">
            Words on the button
            <input id={id("words")} value={block.text} maxLength={60} onChange={(e) => onChange({ ...block, text: e.target.value })} className={field} />
          </label>
          <label htmlFor={id("url")} className="flex flex-col gap-1 text-caption text-ink-2">
            Where it goes (a page of your store such as /products, or https://…)
            <input id={id("url")} value={block.url} maxLength={500} onChange={(e) => onChange({ ...block, url: e.target.value })} className={field} />
          </label>
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-2">
          {block.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- the email's own picture, shown as it will be sent
            <img src={block.url} alt="" className="max-h-48 w-auto self-start rounded-panel" />
          ) : null}
          <PictureUpload storeSlug={storeSlug} upload={upload} onUploaded={(url) => onChange({ ...block, url })} has={Boolean(block.url)} />
          <label htmlFor={id("alt")} className="flex flex-col gap-1 text-caption text-ink-2">
            What the picture shows (for people who cannot see it)
            <input id={id("alt")} value={block.alt} maxLength={200} onChange={(e) => onChange({ ...block, alt: e.target.value })} className={field} />
          </label>
          <label htmlFor={id("href")} className="flex flex-col gap-1 text-caption text-ink-2">
            Where pressing it goes (optional)
            <input id={id("href")} value={block.href ?? ""} maxLength={500} onChange={(e) => onChange({ ...block, href: e.target.value.trim() ? e.target.value : null })} className={field} />
          </label>
        </div>
      );
    case "divider":
      return <hr className="border-line" />;
  }
}

/** A picture for an email: made a JPEG in the browser (mail apps show no WebP or AVIF) and kept in the store's media library. */
function PictureUpload({ storeSlug, upload, onUploaded, has }: { storeSlug: string; upload: Props["upload"]; onUploaded: (url: string) => void; has: boolean }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!upload) return null;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const [image, thumbnail] = await Promise.all([compressPicture(file, 1200, { jpeg: true }), compressPicture(file, 480, { jpeg: true })]);
      const data = new FormData();
      data.set("image", new File([image.blob], `picture.${extensionOf(image.type)}`, { type: image.type }));
      data.set("name", file.name);
      data.set("thumbnail", new File([thumbnail.blob], `picture-480.${extensionOf(thumbnail.type)}`, { type: thumbnail.type }));
      data.set("compressed", "1");
      const result = await upload(storeSlug, data);
      if (result.ok) onUploaded(result.url);
      else setProblem(result.problem);
    } catch {
      setProblem("The picture could not be read. Try another.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex w-fit cursor-pointer items-center rounded-pill border border-line px-4 py-2 text-body text-ink hover:bg-sunken">
        {busy ? "Uploading…" : has ? "Choose another picture" : "Choose a picture"}
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}

function AiWriter({ storeSlug, locale, suggest, onUse }: { storeSlug: string; locale: string; suggest: Props["suggest"]; onUse: (s: BroadcastSuggestion) => void }) {
  const [brief, setBrief] = useState("");
  const [suggestion, setSuggestion] = useState<BroadcastSuggestion | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <details className={`${CARD_CLASS} p-4`}>
      <summary className="cursor-pointer text-body-strong text-ink">Write with AI</summary>
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="broadcast-brief" className="text-caption text-ink-2">
          In a few words, what is the email about? The AI writes from these words only, never prices or stock.
        </label>
        <textarea id="broadcast-brief" value={brief} maxLength={1000} rows={2} onChange={(e) => setBrief(e.target.value)} className={`${field} py-2`} />
        <div>
          <Button
            disabled={busy || brief.trim().length < 5}
            onClick={() =>
              start(async () => {
                setProblem(null);
                const r = await suggest(storeSlug, brief, locale);
                if (r.ok) setSuggestion(r.suggestion);
                else setProblem(r.problem);
              })
            }
          >
            {busy ? "Writing…" : "Suggest"}
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-body text-danger-text">
            {problem}
          </p>
        )}
        {suggestion && (
          <div className="flex flex-col gap-2 rounded-panel border border-line p-3">
            <p className="text-body-strong text-ink">{suggestion.subject}</p>
            <p className="text-body text-ink-2">{suggestion.heading}</p>
            {suggestion.paragraphs.map((p, i) => (
              <p key={i} className="text-body text-ink-2">
                {p}
              </p>
            ))}
            <p className="text-caption text-muted">Read it and change what you like. It replaces what this language says now; add the button&apos;s address before you save.</p>
            <div>
              <Button onClick={() => (onUse(suggestion), setSuggestion(null))}>Use this</Button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
