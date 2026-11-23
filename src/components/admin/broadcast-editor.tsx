"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { SOCIAL_NETWORKS, socialPlaceholder, type SocialNetwork } from "@/lib/social-links";
import {
  BLOCKS_MAX,
  SOCIAL_MAX,
  emptyContent,
  suggestionBlocks,
  type BroadcastAudience,
  type BroadcastBlock,
  type BroadcastContent,
  type BroadcastSuggestion,
  type SavedBlock,
  type FindFacts,
  type LanguageContent,
} from "@/lib/broadcasts";
import { countWords, fillWords } from "@/lib/admin-fill";
import { audienceNeeded, testedOf, TEST_HOURS, TEST_SHARE } from "@/lib/broadcast-test-sizes";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { compressPicture, extensionOf } from "@/lib/image-compress";

import { useAdminLang, useAdminText } from "./admin-text";
import { Button } from "./ui/button";
import { CARD_CLASS } from "./ui/card";
import { Select } from "./ui/field";
import { ColumnsFields, emptyCell } from "./broadcast-columns";
import { KeepBlock, SavedBlockList, type SavedBlocksProps } from "./broadcast-saved-blocks";
import { HtmlFields, type CleanHtml } from "./broadcast-html";

type Problem = { ok: false; problem: string };

type Props = {
  storeSlug: string;
  broadcastId: string | null;
  initial: { title: string; audience: BroadcastAudience; segmentId: string | null; content: BroadcastContent; test?: BroadcastTestDraft | null; bestTime?: boolean; topicId?: string | null };
  /** The store's languages, main first. */
  locales: { code: string; name: string }[];
  segments: { id: string; name: string }[];
  /** The site's AI has a text model, so *Write with AI* is offered. */
  aiReady: boolean;
  save: (storeSlug: string, id: string | null, input: unknown) => Promise<Problem | { ok: true }>;
  count: (storeSlug: string, audience: string, segmentId: string | null, topicId?: string | null) => Promise<Problem | { ok: true; people: number }>;
  /** The store's topics (M4.2), by name in the admin's main language; none, and no *About* is asked. */
  topics?: { id: string; name: string }[];
  suggest: (storeSlug: string, brief: string, locale: string, segmentId?: string | null) => Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }>;
  upload: ((storeSlug: string, data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>) | null;
  /** Saved blocks (M4.1): the store's list (from `broadcastChoices()`) and the actions that keep and delete one. */
  savedBlocks?: SavedBlock[];
  savedBlock?: SavedBlocksProps["act"];
  cleanHtml?: CleanHtml;
  /** The store's products and running campaigns to put in (D352); none, the finder is not offered. */
  facts?: FindFacts;
  /** Three subject lines for a split test's version B (M2.5 slice 3), while the store has AI. */
  subjects?: (storeSlug: string, locale: string, subject: string, words: string[], segmentId: string | null) => Promise<Problem | { ok: true; subjects: string[] }>;
};

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3";

/** A split test as the editor holds it (M2.5, D868): version B's subject and preview per language, the share and the hours. */
type BroadcastTestDraft = { b: Record<string, { subject: string; preview: string }>; share: number; hours: number };

type Addable = "heading" | "paragraph" | "button" | "image" | "columns" | "divider" | "social" | "html";
const ADD: Addable[] = ["heading", "paragraph", "button", "image", "columns", "divider", "social"];

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
    case "social":
      return { type, links: [{ network: "instagram", url: "" }] };
    case "columns":
      return { type, cells: [emptyCell(), emptyCell()] };
    case "html":
      return { type, html: "" };
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
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [test, setTest] = useState<BroadcastTestDraft | null>(props.initial.test ?? null);
  const [bestTime, setBestTime] = useState(props.initial.bestTime === true);
  const [topicId, setTopicId] = useState<string | null>(props.initial.topicId ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = props.count;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      count(storeSlug, audience, audience === "segment" ? segmentId : null, topicId).then(
        (r) => {
          setPeople(r.ok ? fillWords(we.goesTo, { people: countWords(r.people, w.common.people, { n: r.people.toLocaleString(numbers) }) }) : r.problem);
          setPeopleCount(r.ok ? r.people : null);
        },
        () => (setPeople(w.common.countFailed), setPeopleCount(null)),
      );
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [audience, segmentId, topicId, count, storeSlug, w, we, numbers]);


  const submit = () =>
    startSave(async () => {
      setProblem(null);
      // A language left empty is not kept.
      const written = Object.fromEntries(Object.entries(content).filter(([, c]) => c.subject.trim() || c.preview.trim() || c.blocks.length > 0));
      const result = await props.save(storeSlug, props.broadcastId, { title, audience, segmentId: audience === "segment" ? segmentId : null, content: written, test, bestTime: bestTime && !test, topicId });
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
        {/* The store's topics (M4.2, D882): only where it has some, Everything unless one is chosen. */}
        {(props.topics?.length ?? 0) > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-body text-ink">
            {we.about}
            <Select value={topicId ?? ""} onChange={(e) => (setSaved(false), setTopicId(e.target.value || null))} data-topic>
              <option value="">{we.aboutEverything}</option>
              {props.topics?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
        )}
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
        cleanHtml={props.cleanHtml}
        saved={props.savedBlock ? { list: props.savedBlocks ?? [], act: props.savedBlock } : undefined}
      />

      <SplitTestFields
        test={test}
        content={content}
        locales={props.locales}
        people={peopleCount}
        onChange={(next) => {
          setSaved(false);
          setTest(next);
        }}
        suggest={
          props.aiReady && props.subjects
            ? (locale) => {
                const words = (content[locale]?.blocks ?? []).flatMap((b) => ("text" in b && typeof b.text === "string" ? [b.text] : []));
                return props.subjects!(storeSlug, locale, content[locale]?.subject ?? "", words, audience === "segment" ? segmentId : null);
              }
            : undefined
        }
      />

      {/* Send time per person (M4.4): each reader at the hour they usually press links, within a day; not with a split test. */}
      <label className="flex items-start gap-2 text-body text-ink" data-best-time>
        <input
          type="checkbox"
          className="mt-1"
          checked={bestTime && !test}
          disabled={test !== null}
          onChange={(e) => (setSaved(false), setBestTime(e.target.checked))}
        />
        <span className="flex flex-col">
          {we.bestTime.label}
          <span className="text-caption text-muted">{test ? we.bestTime.notWithTest : we.bestTime.hint}</span>
        </span>
      </label>

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

/**
 * A broadcast's split test (email plan M2.5, D868, `docs/split-tests.md`): Homer presses *Try another subject* and writes subject B; one
 * line says what happens with his own numbers. Lisa's share and hours are under *Customise*. The engine chooses the winner after the wait.
 */
function SplitTestFields(props: {
  test: BroadcastTestDraft | null;
  content: BroadcastContent;
  locales: { code: string; name: string }[];
  people: number | null;
  onChange: (test: BroadcastTestDraft | null) => void;
  /** The AI's three subject lines for one language (M2.5 slice 3); one press makes a line subject B. */
  suggest?: (locale: string) => Promise<Problem | { ok: true; subjects: string[] }>;
}) {
  const w = useAdminText("marketing");
  const wt = w.email.test;
  const numbers = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const { test } = props;
  const written = props.locales.filter((l) => props.content[l.code]?.subject?.trim());
  if (!test) {
    return (
      <div>
        <Button onClick={() => props.onChange({ b: {}, share: TEST_SHARE.start, hours: TEST_HOURS.start })} disabled={written.length === 0}>
          {wt.add}
        </Button>
      </div>
    );
  }
  const n = (x: number) => x.toLocaleString(numbers);
  const hours = countWords(test.hours, wt.hours);
  const needed = audienceNeeded(test.share);
  const tested = props.people === null ? 0 : testedOf(props.people, test.share);
  const line =
    props.people === null
      ? fillWords(wt.planLater, { share: test.share, hours })
      : props.people < needed
        ? fillWords(wt.tooFew, { needed: n(needed), share: test.share, people: n(props.people) })
        : fillWords(wt.plan, { share: test.share, people: n(props.people), tested: n(tested), hours, rest: n(props.people - tested) });
  const setB = (locale: string, part: { subject?: string; preview?: string }) =>
    props.onChange({ ...test, b: { ...test.b, [locale]: { ...(test.b[locale] ?? { subject: "", preview: "" }), ...part } } });
  return (
    <section aria-label={wt.title} className={`${CARD_CLASS} flex flex-col gap-3 p-4`} data-split-test>
      <h3 className="text-body-strong text-ink">{wt.title}</h3>
      {written.map((l) => (
        <div key={l.code} className="flex flex-col gap-2">
          {written.length > 1 && <span className="text-caption text-muted">{l.name}</span>}
          <span className="text-caption text-muted">{fillWords(wt.yours, { subject: props.content[l.code]?.subject ?? "" })}</span>
          <label className="flex flex-col gap-1 text-body text-ink">
            {wt.subjectB}
            <input value={test.b[l.code]?.subject ?? ""} maxLength={150} onChange={(e) => setB(l.code, { subject: e.target.value })} className={field} />
          </label>
          {props.suggest && <TestSubjects suggest={() => props.suggest!(l.code)} onPick={(subject) => setB(l.code, { subject })} />}
          <label className="flex flex-col gap-1 text-body text-ink">
            {wt.previewB}
            <input value={test.b[l.code]?.preview ?? ""} maxLength={200} onChange={(e) => setB(l.code, { preview: e.target.value })} className={field} />
          </label>
        </div>
      ))}
      <p role="status" aria-live="polite" className="text-body text-ink-2" data-split-plan>
        {line}
      </p>
      <details>
        <summary className="cursor-pointer text-body text-ink-2">{wt.customise}</summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-body text-ink">
            {wt.share}
            <input
              type="number"
              min={TEST_SHARE.min}
              max={TEST_SHARE.max}
              value={test.share}
              onChange={(e) => props.onChange({ ...test, share: Math.min(TEST_SHARE.max, Math.max(TEST_SHARE.min, Number(e.target.value) || TEST_SHARE.start)) })}
              className={`${field} w-28`}
            />
          </label>
          <label className="flex flex-col gap-1 text-body text-ink">
            {wt.wait}
            <input
              type="number"
              min={TEST_HOURS.min}
              max={TEST_HOURS.max}
              value={test.hours}
              onChange={(e) => props.onChange({ ...test, hours: Math.min(TEST_HOURS.max, Math.max(TEST_HOURS.min, Number(e.target.value) || TEST_HOURS.start)) })}
              className={`${field} w-28`}
            />
          </label>
        </div>
      </details>
      <div>
        <Button kind="quiet" onClick={() => props.onChange(null)}>
          {wt.remove}
        </Button>
      </div>
    </section>
  );
}

/** The AI's three subject lines as buttons (M2.5 slice 3, M3.7): one press makes it subject B; nothing is saved until the broadcast is. */
function TestSubjects({ suggest, onPick }: { suggest: () => Promise<Problem | { ok: true; subjects: string[] }>; onPick: (subject: string) => void }) {
  const wt = useAdminText("marketing").email.test;
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, start] = useTransition();
  return (
    <div className="flex flex-col gap-1" data-test-subjects>
      <button
        type="button"
        disabled={asking}
        onClick={() =>
          start(async () => {
            setProblem(null);
            const result = await suggest();
            if (result.ok) setSubjects(result.subjects);
            else setProblem(result.problem);
          })
        }
        className="self-start text-caption text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {asking ? wt.asking : wt.ask}
      </button>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
      {subjects && (
        <div role="group" aria-label={wt.choose} className="flex flex-col gap-1">
          {subjects.map((subject) => (
            <button
              key={subject}
              type="button"
              onClick={() => (onPick(subject), setSubjects(null))}
              className="rounded border border-line bg-card px-2 py-1 text-left text-sm text-ink hover:border-ink"
            >
              {subject}
            </button>
          ))}
        </div>
      )}
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
  /** The store's saved blocks and their actions (M4.1); none, no saving. */
  saved?: SavedBlocksProps;
  /** Cleans an own HTML block for its preview (M4.1); none, and no HTML block is offered. */
  cleanHtml?: CleanHtml;
}) {
  const { storeSlug, content } = props;
  const [kept, setKept] = useState(props.saved?.list ?? []);
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
          {/* Personal fields (M2.6): said once where Homer writes, with the fallback he must give. */}
          <span className="text-caption text-muted" data-personal-hint>
            {we.personalHint}
          </span>
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
              <BlockFields block={block} index={i} onChange={(b) => setBlock(i, b)} storeSlug={storeSlug} upload={props.upload} clean={props.cleanHtml} />
              {props.saved && (
                <div className="flex justify-end">
                  <KeepBlock block={block} kind={we.blocks[block.type]} storeSlug={storeSlug} act={props.saved.act} onSaved={setKept} />
                </div>
              )}
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
            {props.cleanHtml && (
              <details className="w-full">
                <summary className="cursor-pointer text-caption text-ink-2">{we.moreBlocks}</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="dense" onClick={() => setCurrent({ ...current, blocks: [...current.blocks, newBlock("html")] })}>
                    {we.blocks.html}
                  </Button>
                </div>
              </details>
            )}
          </div>
        )}
        {current.blocks.length < BLOCKS_MAX && props.saved && (
          <SavedBlockList
            list={kept}
            storeSlug={storeSlug}
            act={props.saved.act}
            onAdd={(block) => setCurrent({ ...current, blocks: [...current.blocks, block] })}
            onChange={setKept}
          />
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
  clean,
}: {
  block: BroadcastBlock;
  index: number;
  onChange: (b: BroadcastBlock) => void;
  storeSlug: string;
  upload: Props["upload"];
  clean?: CleanHtml;
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
    case "html":
      return clean ? <HtmlFields html={block.html} storeSlug={storeSlug} field={field} clean={clean} onChange={(html) => onChange({ ...block, html })} /> : null;
    case "columns":
      return (
        <ColumnsFields
          block={block}
          index={index}
          field={field}
          onChange={onChange}
          picture={(has, onUploaded) => <PictureUpload storeSlug={storeSlug} upload={upload} onUploaded={onUploaded} has={has} />}
        />
      );
    case "social": {
      // The store's profiles (M4.1): a network and its address per row; drawn in the email as one row of their names.
      const set = (links: typeof block.links) => onChange({ ...block, links });
      return (
        <div className="flex flex-col gap-2" data-social-block>
          {block.links.map((link, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                aria-label={we.socialNetwork}
                value={link.network}
                onChange={(e) => set(block.links.map((l, j) => (j === i ? { ...l, network: e.target.value as SocialNetwork } : l)))}
              >
                {(Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]).map((n) => (
                  <option key={n} value={n}>
                    {SOCIAL_NETWORKS[n]}
                  </option>
                ))}
              </Select>
              <input
                aria-label={we.socialAddress}
                value={link.url}
                maxLength={500}
                placeholder={socialPlaceholder(link.network)}
                onChange={(e) => set(block.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
                className={`${field} min-w-48 flex-1`}
              />
              {block.links.length > 1 && (
                <Button size="dense" kind="quiet" onClick={() => set(block.links.filter((_, j) => j !== i))}>
                  {we.socialRemove}
                </Button>
              )}
            </div>
          ))}
          {block.links.length < SOCIAL_MAX && (
            <Button size="dense" onClick={() => set([...block.links, { network: "facebook", url: "" }])}>
              {we.socialAdd}
            </Button>
          )}
        </div>
      );
    }
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
