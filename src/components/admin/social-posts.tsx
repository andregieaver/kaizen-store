"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/admin/ui/empty-state";
import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { hint, label, primary, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import { CHANNEL_SPECS, PICTURE_SIZES, POST_CHANNELS, type PostChannel } from "@/lib/social-posts";

/**
 * The social post creator's screen (D870 C1). Homer chooses a product (or writes what the posts are about), keeps the channels ticked and
 * presses Write posts; each post comes back as a card with Copy text, and Copy link where the channel opens no link in a post. Lisa's theme
 * and the price line are under Customise. The posts written before are below, newest first, grouped as they were written.
 */

type Post = {
  id: string;
  channel: PostChannel;
  ref: string;
  productId: string | null;
  pageId: string | null;
  topic: string;
  text: string;
  link: string;
  copiedAt: string | null;
  createdAt: string;
};

type Result = { ok: true; posts: Post[] } | { ok: false; problem: string };

/** A JSON POST to one of the screen's routes, its answer read as JSON. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await response.json()) as T;
}

export function SocialPostCreator({
  products,
  pages,
  posts: initial,
  mayWrite,
  hasAi,
  timeZone,
  dateLocale,
  base,
  words: w,
}: {
  products: { id: string; title: string }[];
  /** The site's published pages (C1b): what Kaizena Flow's own site, which has no products, writes about. */
  pages: { id: string; title: string }[];
  posts: Post[];
  mayWrite: boolean;
  hasAi: boolean;
  timeZone: string;
  dateLocale: string;
  /** The screen's address: posts are written at `{base}/write`, a copy noted at `{base}/copied/{id}`, a picture drawn at `{base}/picture/{id}`. */
  base: string;
  /** The screen's words in the admin's language (`SOCIAL_WORDS`, a server-only area). */
  words: SocialMessages;
}) {
  // What the posts are about, as `product:{id}`, `page:{id}`, or empty for the owner's own words: a product first, else a page.
  const [subject, setSubject] = useState(products[0] ? `product:${products[0].id}` : pages[0] ? `page:${pages[0].id}` : "");
  const productId = subject.startsWith("product:") ? subject.slice(8) : null;
  const pageId = subject.startsWith("page:") ? subject.slice(5) : null;
  const [topic, setTopic] = useState("");
  const [channels, setChannels] = useState<PostChannel[]>(["instagram", "facebook"]);
  const [campaign, setCampaign] = useState("");
  const [withPrice, setWithPrice] = useState(true);
  const [posts, setPosts] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (c: PostChannel) => setChannels((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const submit = () =>
    start(async () => {
      setMessage(null);
      const result = await postJson<Result>(`${base}/write`, { productId, pageId, topic, campaign, channels, withPrice }).catch(() => null);
      if (!result) return setMessage({ tone: "problem", text: w.failed });
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      setPosts((list) => [...result.posts, ...list]);
      setMessage({ tone: "ok", text: w.written });
    });

  const batches: Post[][] = [];
  for (const post of posts) {
    const last = batches.at(-1);
    if (last && last[0].ref === post.ref) last.push(post);
    else batches.push([post]);
  }
  const titleOf = new Map([...products, ...pages].map((p) => [p.id, p.title]));
  const date = (iso: string) => new Date(iso).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone });

  return (
    <div className="flex flex-col gap-6">
      {!hasAi && <p className="text-body text-muted">{w.noAi}</p>}
      {mayWrite && hasAi ? (
        <form
          className="flex flex-col gap-4 rounded-panel bg-sunken p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={w.subject} hint={productId ? w.productHint : pageId ? w.pageHint : w.subjectHint}>
            {(control) => (
              <Select {...control} value={subject} onChange={(e) => setSubject(e.target.value)}>
                {products.length > 0 && (
                  <optgroup label={w.productsGroup}>
                    {products.map((p) => (
                      <option key={p.id} value={`product:${p.id}`}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                )}
                {pages.length > 0 && (
                  <optgroup label={w.pagesGroup}>
                    {pages.map((p) => (
                      <option key={p.id} value={`page:${p.id}`}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="">{w.noProduct}</option>
              </Select>
            )}
          </Field>
          <Field label={subject ? w.topic : w.topicAlone} hint={subject ? w.topicHintProduct : w.topicHint}>
            {(control) => <TextInput {...control} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} />}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>{w.channels}</legend>
            <div className="flex flex-wrap gap-2">
              {POST_CHANNELS.map((c) => (
                <label key={c} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-pill border border-edge bg-card px-4 text-sm has-[:checked]:border-brand">
                  <input type="checkbox" checked={channels.includes(c)} onChange={() => toggle(c)} />
                  {CHANNEL_SPECS[c].label}
                </label>
              ))}
            </div>
          </fieldset>
          <details className="flex flex-col gap-3">
            <summary className="cursor-pointer text-sm font-medium">{w.customise}</summary>
            <div className="mt-3">
              <Field label={w.theme} hint={w.themeHint}>
                {(control) => <TextInput {...control} value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={80} />}
              </Field>
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withPrice} onChange={(e) => setWithPrice(e.target.checked)} />
              {w.withPrice}
            </label>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primary} disabled={pending || channels.length === 0}>
              {pending ? w.writing : w.write}
            </button>
            <div role="status" aria-live="polite">
              {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
            </div>
          </div>
        </form>
      ) : (
        !mayWrite && <p className="text-body text-muted">{w.readOnly}</p>
      )}

      <section aria-labelledby="social-recent" className="flex flex-col gap-4">
        <h2 id="social-recent" className="text-title text-ink">
          {w.recent}
        </h2>
        {batches.length === 0 ? (
          <EmptyState compact title={w.none} />
        ) : (
          batches.map((batch) => {
            const first = batch[0];
            const what = (first.productId && titleOf.get(first.productId)) || (first.pageId && titleOf.get(first.pageId)) || first.topic;
            return (
              <div key={first.ref} className="flex flex-col gap-3">
                <p className="text-caption text-ink-2">
                  {fillWords(w.madeAt, { date: date(first.createdAt) })}
                  {what ? ` · ${fillWords(w.about, { what })}` : ""}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {batch.map((post) => (
                    <PostCard key={post.id} words={w} post={post} copied={() => postJson(`${base}/copied/${post.id}`, {}).catch(() => null)} date={date} picture={`${base}/picture/${post.id}`} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function PostCard({ words: w, post, copied, date, picture }: { words: SocialMessages; post: Post; copied: () => Promise<unknown>; date: (iso: string) => string; picture: string }) {
  const [done, setDone] = useState<"text" | "link" | null>(null);
  const [copiedAt, setCopiedAt] = useState(post.copiedAt);
  const spec = CHANNEL_SPECS[post.channel];
  const copy = async (what: "text" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "text" ? post.text : post.link);
    } catch {
      return;
    }
    setDone(what);
    if (!copiedAt) {
      setCopiedAt(new Date().toISOString());
      void copied();
    }
  };
  return (
    <article className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4" aria-label={spec.label}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body-strong text-ink">{spec.label}</h3>
        <span className="text-caption text-ink-2">{copiedAt ? fillWords(w.copiedAt, { date: date(copiedAt) }) : w.notCopied}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the server for this post, private to the admin */}
      <img
        src={picture}
        alt={fillWords(w.pictureAlt, { channel: spec.label, shape: PICTURE_SIZES[post.channel].shape })}
        width={PICTURE_SIZES[post.channel].width}
        height={PICTURE_SIZES[post.channel].height}
        loading="lazy"
        className="h-auto max-h-80 w-auto self-start rounded-md border border-line"
      />
      <p className="whitespace-pre-line text-body text-ink [overflow-wrap:anywhere]">{post.text}</p>
      {!spec.linkInCaption && (
        <p className={hint}>
          {fillWords(w.linkNote, { channel: spec.label })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => copy("text")}>
          {done === "text" ? w.copied : w.copy}
        </button>
        {!spec.linkInCaption && (
          <button type="button" className={secondary} onClick={() => copy("link")}>
            {done === "link" ? w.copied : w.copyLink}
          </button>
        )}
        <a href={`${picture}?download=1`} download className={secondary}>
          {w.downloadPicture}
        </a>
      </div>
    </article>
  );
}
