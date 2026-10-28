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
  type FindFacts,
  type LanguageContent,
} from "@/lib/broadcasts";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { compressPicture, extensionOf } from "@/lib/image-compress";

import { useAdminLang, useAdminText } from "./admin-text";
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
  suggest: (storeSlug: string, brief: string, locale: string, segmentId?: string | null) => Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }>;
  upload: ((storeSlug: string, data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>) | null;
  /** The store's products and running campaigns to put in (D352); none, the finder is not offered. */
  facts?: FindFacts;
};

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3";

type Addable = "heading" | "paragraph" | "button" | "image" | "divider";
const ADD: Addable[] = ["heading", "paragraph", "button", "image", "divider"];

function newBlock(type: Addable): BroadcastBlock {
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
  const [title, setTitle] = useState(props.initial.title);
  const [audience, setAudience] = useState<BroadcastAudience>(props.initial.audience);
  const [segmentId, setSegmentId] = useState<string | null>(props.initial.segmentId ?? props.segments[0]?.id ?? null);
  const [content, setContent] = useState<BroadcastContent>(props.initial.content);
  const w = useAdminText("marketing");
  const we = w.email;
  const numbers = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [people, setPeople] = useState<string>(w.common.counting);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = props.count;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      count(storeSlug, audience, audience === "segment" ? segmentId : null).then(
        (r) => setPeople(r.ok ? fillWords(we.goesTo, { people: countWords(r.people, w.common.people, { n: r.people.toLocaleString(numbers) }) }) : r.problem),
        () => setPeople(w.common.countFailed),
      );
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [audience, segmentId, count, storeSlug, w, we, numbers]);


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
          {we.name}
        </label>
        <span className="text-caption text-muted">{we.nameHint}</span>
        <input id="broadcast-title" value={title} maxLength={80} onChange={(e) => (setSaved(false), setTitle(e.target.value))} className={`${field} max-w-md`} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body-strong text-ink">{we.whoGetsIt}</legend>
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="radio" name="audience" checked={audience === "everyone"} onChange={() => (setSaved(false), setAudience("everyone"))} />
          {we.everyone}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-body text-ink">
          <input type="radio" name="audience" checked={audience === "segment"} disabled={props.segments.length === 0} onChange={() => (setSaved(false), setAudience("segment"))} />
          {we.segment}
          {audience === "segment" && (
            <select aria-label={we.segmentLabel} value={segmentId ?? ""} onChange={(e) => (setSaved(false), setSegmentId(e.target.value || null))} className="min-h-10 rounded-md border border-line bg-card px-3">
              {props.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </label>
        {props.segments.length === 0 && <p className="text-caption text-muted">{we.noSegments}</p>}
        <p role="status" aria-live="polite" className="text-body text-ink-2">
          {people}
        </p>
      </fieldset>

      <EmailContentFields
        storeSlug={storeSlug}
        locales={props.locales}
        content={content}
        onChange={(next) => {
          setSaved(false);
          setContent(next);
        }}
        aiReady={props.aiReady}
        suggest={props.suggest}
        upload={props.upload}
        facts={props.facts}
        segmentId={audience === "segment" ? segmentId : null}
      />

      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button kind="main" onClick={submit} disabled={saving}>
          {saving ? w.common.saving : props.broadcastId ? w.common.save : we.saveDraft}
        </Button>
        {saved && (
          <span role="status" className="text-body text-positive-text">
            {w.common.saved}
          </span>
        )}
      </div>
    </div>
  );
}

/** The words of an email per language (D297 5.1, reused by D298's automations): a subject, a preview line and blocks, and *Write with AI*. */
export function EmailContentFields(props: {
  storeSlug: string;
  /** The store's languages, main first. */
  locales: { code: string; name: string }[];
  content: BroadcastContent;
  onChange: (content: BroadcastContent) => void;
  aiReady: boolean;
  suggest: Props["suggest"];
  upload: Props["upload"];
  facts?: FindFacts;
  /** The segment the email is for, which shapes the AI's words (D352). */
  segmentId?: string | null;
}) {
  const { storeSlug, content } = props;
  const wm = useAdminText("marketing");
  const we = wm.email;
  const [locale, setLocale] = useState(props.locales[0]?.code ?? "nb-NO");
  const current: LanguageContent = content[locale] ?? emptyContent();
  const setCurrent = (next: LanguageContent) => props.onChange({ ...content, [locale]: next });
  const setBlock = (index: number, block: BroadcastBlock) => setCurrent({ ...current, blocks: current.blocks.map((b, i) => (i === index ? block : b)) });
  const move = (index: number, by: number) => {
    const blocks = [...current.blocks];
    const [b] = blocks.splice(index, 1);
    blocks.splice(index + by, 0, b);
    setCurrent({ ...current, blocks });
  };
  return (
    <>
      {props.locales.length > 1 && (
        <div role="tablist" aria-label={wm.common.language} className="flex flex-wrap gap-2">
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
              {i === 0 ? we.main : content[l.code]?.subject ? "" : we.notWritten}
            </button>
          ))}
        </div>
      )}

      {props.aiReady && <AiWriter storeSlug={storeSlug} locale={locale} segmentId={props.segmentId ?? null} suggest={props.suggest} onUse={(s) => setCurrent({ subject: s.subject, preview: s.preview, blocks: suggestionBlocks(s) })} />}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="broadcast-subject" className="text-body-strong text-ink">
            {we.subject}
          </label>
          <input id="broadcast-subject" value={current.subject} maxLength={150} onChange={(e) => setCurrent({ ...current, subject: e.target.value })} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="broadcast-preview" className="text-body-strong text-ink">
            {we.preview}
          </label>
          <span className="text-caption text-muted">{we.previewHint}</span>
          <input id="broadcast-preview" value={current.preview} maxLength={200} onChange={(e) => setCurrent({ ...current, preview: e.target.value })} className={field} />
        </div>

        <ol className="flex flex-col gap-3" aria-label={we.blocksLabel}>
          {current.blocks.map((block, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-panel border border-line bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-strong text-ink">{we.blocks[block.type]}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="dense" kind="quiet" disabled={i === 0} onClick={() => move(i, -1)}>
                    {we.up}
                  </Button>
                  <Button size="dense" kind="quiet" disabled={i === current.blocks.length - 1} onClick={() => move(i, 1)}>
                    {we.down}
                  </Button>
                  <Button size="dense" kind="quiet" onClick={() => setCurrent({ ...current, blocks: current.blocks.filter((_, j) => j !== i) })}>
                    {wm.common.remove}
                  </Button>
                </span>
              </div>
              <BlockFields block={block} index={i} onChange={(b) => setBlock(i, b)} storeSlug={storeSlug} upload={props.upload} />
            </li>
          ))}
        </ol>
        {current.blocks.length === 0 && <p className="text-body text-muted">{we.nothing}</p>}
        {current.blocks.length < BLOCKS_MAX && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-ink-2">{we.add}</span>
            {ADD.filter((type) => type !== "image" || props.upload).map((type) => (
              <Button key={type} size="dense" onClick={() => setCurrent({ ...current, blocks: [...current.blocks, newBlock(type)] })}>
                {we.blocks[type]}
              </Button>
            ))}
          </div>
        )}
        {current.blocks.length < BLOCKS_MAX && props.facts && (
          <FactFinder storeSlug={storeSlug} find={props.facts} onAdd={(block) => setCurrent({ ...current, blocks: [...current.blocks, block] })} />
        )}
      </div>

    </>
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
  const we = useAdminText("marketing").email;
  switch (block.type) {
    case "heading":
      return <input aria-label={we.blocks.heading} value={block.text} maxLength={150} onChange={(e) => onChange({ ...block, text: e.target.value })} className={field} />;
    case "paragraph":
      return <textarea aria-label={we.blocks.paragraph} value={block.text} maxLength={3000} rows={4} onChange={(e) => onChange({ ...block, text: e.target.value })} className={`${field} py-2`} />;
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <label htmlFor={id("words")} className="flex flex-col gap-1 text-caption text-ink-2">
            {we.buttonWords}
            <input id={id("words")} value={block.text} maxLength={60} onChange={(e) => onChange({ ...block, text: e.target.value })} className={field} />
          </label>
          <label htmlFor={id("url")} className="flex flex-col gap-1 text-caption text-ink-2">
            {we.buttonUrl}
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
            {we.alt}
            <input id={id("alt")} value={block.alt} maxLength={200} onChange={(e) => onChange({ ...block, alt: e.target.value })} className={field} />
          </label>
          <label htmlFor={id("href")} className="flex flex-col gap-1 text-caption text-ink-2">
            {we.href}
            <input id={id("href")} value={block.href ?? ""} maxLength={500} onChange={(e) => onChange({ ...block, href: e.target.value.trim() ? e.target.value : null })} className={field} />
          </label>
        </div>
      );
    case "product":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-body text-ink">{block.label || block.handle}</span>
          <span className="text-caption text-muted">{we.productNote}</span>
        </div>
      );
    case "campaign":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-body text-ink">{block.label}</span>
          <span className="text-caption text-muted">{we.campaignNote}</span>
        </div>
      );
    case "divider":
      return <hr className="border-line" />;
  }
}

/** Finds the store's products by words, with the campaigns running now, to put in the email as blocks code draws when it is sent (D352). */
function FactFinder({ storeSlug, find, onAdd }: { storeSlug: string; find: FindFacts; onAdd: (block: BroadcastBlock) => void }) {
  const we = useAdminText("marketing").email;
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Extract<Awaited<ReturnType<FindFacts>>, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const search = () =>
    start(async () => {
      setProblem(null);
      const result = await find(storeSlug, words);
      if (result.ok) setFound(result);
      else setProblem(result.problem);
    });
  return (
    <details className="rounded-panel border border-line p-3" data-fact-finder="">
      <summary className="cursor-pointer text-body text-ink">{we.findLabel}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={we.findLabel}
            value={words}
            maxLength={120}
            placeholder={we.findPlaceholder}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            className={`${field} max-w-sm`}
          />
          <Button size="dense" disabled={busy} onClick={search}>
            {busy ? we.finding : we.find}
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-caption text-danger-text">
            {problem}
          </p>
        )}
        {found && found.products.length === 0 && found.campaigns.length === 0 && <p className="text-caption text-muted">{we.noneFound}</p>}
        {found && found.products.length > 0 && (
          <ul className="flex flex-col divide-y divide-line" aria-label={we.productsFound}>
            {found.products.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-body text-ink">{p.title}</span>
                <span className="text-caption text-muted">{p.price}</span>
                <Button size="dense" kind="quiet" className="ml-auto" onClick={() => onAdd({ type: "product", product: p.id, handle: p.handle, label: p.title })}>
                  {we.addThis}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {found && found.campaigns.length > 0 && (
          <ul className="flex flex-col divide-y divide-line" aria-label={we.campaignsRunning}>
            {found.campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-body text-ink">{c.name}</span>
                <span className="text-caption text-muted">{c.offer}</span>
                <Button size="dense" kind="quiet" className="ml-auto" onClick={() => onAdd({ type: "campaign", campaign: c.id, label: c.name })}>
                  {we.addThis}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** A picture for an email: made a JPEG in the browser (mail apps show no WebP or AVIF) and kept in the store's media library. */
function PictureUpload({ storeSlug, upload, onUploaded, has }: { storeSlug: string; upload: Props["upload"]; onUploaded: (url: string) => void; has: boolean }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const we = useAdminText("marketing").email;
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
      setProblem(we.unreadablePicture);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex w-fit cursor-pointer items-center rounded-pill border border-line px-4 py-2 text-body text-ink hover:bg-sunken">
        {busy ? we.uploading : has ? we.chooseAnother : we.choosePicture}
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

function AiWriter({
  storeSlug,
  locale,
  segmentId,
  suggest,
  onUse,
}: {
  storeSlug: string;
  locale: string;
  segmentId: string | null;
  suggest: Props["suggest"];
  onUse: (s: BroadcastSuggestion) => void;
}) {
  const [brief, setBrief] = useState("");
  const [suggestion, setSuggestion] = useState<BroadcastSuggestion | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const we = useAdminText("marketing").email;
  return (
    <details className={`${CARD_CLASS} p-4`}>
      <summary className="cursor-pointer text-body-strong text-ink">{we.writeWithAi}</summary>
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="broadcast-brief" className="text-caption text-ink-2">
          {we.brief}
        </label>
        <textarea id="broadcast-brief" value={brief} maxLength={1000} rows={2} onChange={(e) => setBrief(e.target.value)} className={`${field} py-2`} />
        <div>
          <Button
            disabled={busy || brief.trim().length < 5}
            onClick={() =>
              start(async () => {
                setProblem(null);
                const r = await suggest(storeSlug, brief, locale, segmentId);
                if (r.ok) setSuggestion(r.suggestion);
                else setProblem(r.problem);
              })
            }
          >
            {busy ? we.writing : we.suggest}
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
            {[...suggestion.campaigns, ...suggestion.products].length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {[...suggestion.campaigns, ...suggestion.products].map((item) => (
                  <li key={item.id} className="rounded-pill bg-sunken px-3 py-1 text-caption text-ink-2">
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-caption text-muted">{we.readIt}</p>
            <div>
              <Button onClick={() => (onUse(suggestion), setSuggestion(null))}>{we.useThis}</Button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
