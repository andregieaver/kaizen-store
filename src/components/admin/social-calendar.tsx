"use client";

import { useState, useTransition } from "react";

import { primary, secondary } from "@/components/admin/data/ui";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { Field, TextArea } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { CalendarItem, CalendarWeek } from "@/lib/social-calendar";
import { mayCarousel, mayStory } from "@/lib/social-formats";
import { SCENE_TRIES_MAX } from "@/lib/social-scenes";
import { CHANNEL_SPECS } from "@/lib/social-posts";

/**
 * The social calendar on the Social posts page (D870 S2.4): the adviser's plan for this week and next, each planned post with its draft.
 * Homer has one button a week: write the week's posts, then approve the week. Lisa writes, reads, changes and approves each post on its own.
 * Writing goes to `/write` with the day (one post at a time, so a week never waits on one long call); approving and changing to `/calendar`.
 */

type Answer = { ok: boolean; problem?: string; posts?: { id: string }[] };

async function postJson(url: string, body: unknown): Promise<Answer> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return ((await response?.json().catch(() => null)) as Answer | null) ?? { ok: false };
}

const writeBody = (it: CalendarItem) => ({ productId: it.productId, topic: it.productId ? "" : it.idea, channels: [it.channel], withPrice: true, plannedFor: it.day });

export function SocialCalendar({
  weeks,
  titles,
  base,
  mayWrite,
  hasAi,
  makesPictures,
  publishTo,
  timeZone,
  dateLocale,
  words: w,
}: {
  weeks: CalendarWeek[];
  /** Product titles by id, for the products the plan names. */
  titles: Record<string, string>;
  base: string;
  mayWrite: boolean;
  hasAi: boolean;
  /** The store's AI has a picture model, so a post can have a made scene (S2.1). */
  makesPictures: boolean;
  /** The channels whose connection allows publishing from here (S3.1). */
  publishTo: Partial<Record<string, boolean>>;
  /** The store's time zone, for when a queued post goes out. */
  timeZone: string;
  dateLocale: string;
  words: SocialMessages["calendar"];
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const day = (d: string, long = false) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale, { weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", timeZone: "UTC" });

  /** Runs the requests one after another, says how far it got, and reads the page again once all went well. */
  const run = (key: string, requests: (() => Promise<Answer>)[], done?: string) =>
    start(async () => {
      setMessage(null);
      for (const [i, request] of requests.entries()) {
        setBusy(requests.length > 1 ? fillWords(w.writingOf, { n: String(i + 1), count: String(requests.length) }) : key);
        const answer = await request();
        if (!answer.ok) {
          setBusy(null);
          return setMessage({ tone: "problem", text: answer.problem ?? w.failed });
        }
      }
      setBusy(null);
      if (done) setMessage({ tone: "ok", text: done });
      window.location.reload();
    });
  /** Writes one planned post, then has its picture checked (S2.3); a check that cannot run leaves the post unchecked, never unwritten. */
  const writeAndCheck = async (it: CalendarItem): Promise<Answer> => {
    const written = await postJson(`${base}/write`, writeBody(it));
    const ids = written.posts?.map((p) => p.id) ?? [];
    if (written.ok && ids.length > 0) await postJson(`${base}/calendar`, { do: "check", ids });
    return written;
  };
  const write = (items: CalendarItem[], key: string) => run(key, items.map((it) => () => writeAndCheck(it)));
  const check = (id: string) => run(`check-${id}`, [() => postJson(`${base}/calendar`, { do: "check", ids: [id] })]);
  const scene = (id: string) => {
    setMessage({ tone: "ok", text: w.makingScene });
    run(`scene-${id}`, [() => postJson(`${base}/calendar`, { do: "scene", id })]);
  };
  /** Posts one approved post now (S3.1). Its outcome is kept on the post, so the page is read again either way: a refusal shows on the post. */
  const publish = (id: string) =>
    start(async () => {
      setMessage({ tone: "ok", text: w.posting });
      await postJson(`${base}/calendar`, { do: "publish", id });
      window.location.reload();
    });
  const schedule = (id: string, on: boolean) => run(`schedule-${id}`, [() => postJson(`${base}/calendar`, { do: on ? "schedule" : "unschedule", ids: [id] })]);
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  /** A carousel or one picture, a Story too or not (S2.1b): it takes back the post's yes, as new pictures go out with it. */
  const setFormat = (id: string, change: { carousel?: boolean; story?: boolean }) => run(`format-${id}`, [() => postJson(`${base}/calendar`, { do: "format", id, ...change })]);
  const drawn = (id: string) => run(`drawn-${id}`, [() => postJson(`${base}/calendar`, { do: "no_scene", id })]);
  /** The slideshow (S2.5): made in this browser from the post's pictures, uploaded to the library, kept on the post. */
  const video = (id: string) =>
    start(async () => {
      setMessage(null);
      const plan = (await fetch(`${base}/slides/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { photos: string[]; background: string; name: string } | null;
      if (!plan) return setMessage({ tone: "problem", text: w.videoPhotos });
      const { makeSlideshow } = await import("@/lib/social-slideshow-make");
      const made = await makeSlideshow(plan.photos, plan.name, {
        background: plan.background,
        onProgress: (share) => setBusy(fillWords(w.makingVideo, { percent: String(Math.round(share * 100)) })),
      });
      if (!made.ok) {
        setBusy(null);
        return setMessage({ tone: "problem", text: made.why === "browser" ? w.videoBrowser : w.videoPhotos });
      }
      setBusy(w.savingVideo);
      const started = (await postJson(`${base}/calendar`, { do: "video_start", id, size: made.video.size })) as Answer & { path?: string; token?: string; bucket?: string };
      if (!started.ok || !started.path || !started.token || !started.bucket) {
        setBusy(null);
        return setMessage({ tone: "problem", text: started.problem ?? w.failed });
      }
      const { uploadToSignedUrl } = await import("@/lib/supabase/signed-upload");
      const stored = await uploadToSignedUrl(started.bucket, started.path, started.token, made.video, { contentType: "video/mp4", cacheControl: "31536000" });
      const kept = stored.error ? { ok: false } : await postJson(`${base}/calendar`, { do: "video_keep", id, path: started.path });
      setBusy(null);
      if (!kept.ok) return setMessage({ tone: "problem", text: kept.problem ?? w.failed });
      window.location.reload();
    });
  const problemsOf = (problems: string[]) =>
    problems.map((p) => (Object.hasOwn(w.problems, p) ? w.problems[p as keyof typeof w.problems] : p)).join(", ");
  const approve = (ids: string[], key: string, yes = true) => run(key, [() => postJson(`${base}/calendar`, { do: yes ? "approve" : "unapprove", ids })]);
  const save = (id: string, caption: string) => run(`edit-${id}`, [() => postJson(`${base}/calendar`, { do: "edit", id, caption })], w.saved);
  const canWrite = mayWrite && hasAi;
  const planned = weeks.some((week) => week.days.some((d) => d.items.length > 0));

  return (
    <section aria-labelledby="social-calendar" className="flex flex-col gap-4 rounded-panel border border-line bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="social-calendar" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-caption text-ink-2">{w.lead}</p>
      </div>
      <div role="status" aria-live="polite">
        {busy && busy.includes(" ") && <p className="text-sm">{busy}</p>}
        {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
      </div>
      {!planned && <EmptyState compact title={w.empty} />}
      {mayWrite && !hasAi && planned && <p className="text-caption text-ink-2">{w.noAi}</p>}
      {planned &&
        weeks.map((week, wi) => {
          const action = week.action;
          const label = wi === 0 ? w.thisWeek : w.nextWeek;
          return (
            <section key={week.start} aria-label={label} className="flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-body-strong text-ink">
                  {label} <span className="font-normal text-ink-2">{fillWords(w.from, { date: day(week.start, true) })}</span>
                </h3>
                {action?.kind === "write" && canWrite && (
                  <button type="button" className={wi === 0 ? primary : secondary} disabled={pending} onClick={() => write(week.toWrite, `week-${wi}`)}>
                    {fillWords(wi === 0 ? w.writeWeek : w.writeNextWeek, { count: String(action.count) })}
                  </button>
                )}
                {action?.kind === "approve" && mayWrite && (
                  <button type="button" className={wi === 0 ? primary : secondary} disabled={pending} onClick={() => approve(week.toApprove.map((d) => d.id), `week-${wi}`)}>
                    {fillWords(w.approveWeek, { count: String(action.count) })}
                  </button>
                )}
                {action === null && week.days.some((d) => d.items.length > 0) && <p className="text-caption text-ink-2">{w.allApproved}</p>}
              </div>
              {week.days.some((d) => d.items.some((it) => it.draft && !it.draft.approved && (it.draft.check?.problems.length ?? 0) > 0)) && (
                <p className="text-caption text-ink-2">{w.checkWaits}</p>
              )}
              <ol className="flex flex-col gap-3">
                {week.days
                  .filter((d) => d.items.length > 0)
                  .flatMap((d) => d.items)
                  .map((it, i) => (
                    <li key={`${it.day}-${it.channel}-${it.draft?.id ?? i}`} className="flex flex-col gap-2 rounded-card border border-line p-3 sm:flex-row sm:gap-4">
                      {it.draft && (
                        <div className="flex shrink-0 flex-col gap-1 self-start">
                          {/* eslint-disable-next-line @next/next/no-img-element -- the post's own picture, drawn by the page's route on request */}
                          <img
                            src={`${base}/picture/${it.draft.id}?v=${it.draft.editedAt ? Date.parse(it.draft.editedAt) : 0}-${it.draft.scene?.on ? it.draft.scene.tries : 0}`}
                            alt={fillWords(w.picture, { channel: CHANNEL_SPECS[it.channel].label })}
                            className="h-28 w-auto rounded-md border border-line"
                            loading="lazy"
                          />
                          {(it.draft.formats?.carousel || it.draft.formats?.story) && (
                            <div role="group" className="flex max-w-48 flex-wrap gap-1" aria-label={w.morePictures}>
                              {it.draft.formats.carousel &&
                                Array.from({ length: it.draft.formats.slides - 1 }, (_, n) => (
                                  <a key={n} href={`${base}/picture/${it.draft!.id}?slide=${n + 1}&download=1`} className="shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- a carousel slide, drawn by the page's route on request */}
                                    <img src={`${base}/picture/${it.draft!.id}?slide=${n + 1}`} alt={fillWords(w.slide, { n: String(n + 2) })} className="h-12 w-auto rounded-sm border border-line" loading="lazy" />
                                  </a>
                                ))}
                              {it.draft.formats.story && (
                                <a href={`${base}/picture/${it.draft.id}?story=1&download=1`} className="shrink-0">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- the Story frame, drawn by the page's route on request */}
                                  <img src={`${base}/picture/${it.draft.id}?story=1`} alt={w.storyFrame} className="h-12 w-auto rounded-sm border border-line" loading="lazy" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-body-strong text-ink">
                          {day(it.day)} · {CHANNEL_SPECS[it.channel].label}
                          {it.productId && titles[it.productId] ? ` · ${titles[it.productId]}` : ""}
                        </span>
                        <span className="text-caption text-ink-2">{it.idea || w.ownPost}</span>
                        {it.draft ? (
                          <>
                            <p className="line-clamp-3 text-body text-ink whitespace-pre-line">{it.draft.caption}</p>
                            <span className={`text-caption ${it.draft.approved ? "text-success-text" : "text-ink-2"}`}>
                              {it.draft.approved ? (it.draft.byRules ? w.byRules : w.approved) : w.draft}
                              {it.draft.scene?.on ? ` · ${w.sceneUsed}` : ""}
                              {it.draft.video ? ` · ${w.videoMade}` : ""}
                              {it.draft.published ? ` · ${w.posted}` : ""}
                            </span>
                            {!it.draft.published && it.draft.scheduledFor && (
                              <span className="text-caption text-ink">{fillWords(w.goesOut, { when: when(it.draft.scheduledFor) })}</span>
                            )}
                            {it.draft.published?.url && (
                              <a className="text-caption underline" href={it.draft.published.url} target="_blank" rel="noopener noreferrer">
                                {w.viewPost}
                              </a>
                            )}
                            {!it.draft.published && it.draft.publishProblem && (
                              <p className="text-caption text-danger-text">{fillWords(w.postFailed, { problem: it.draft.publishProblem })}</p>
                            )}
                            {it.draft.approved && !it.draft.published && !publishTo[it.channel] && (
                              <span className="text-caption text-ink-2">{fillWords(w.connectToPost, { channel: CHANNEL_SPECS[it.channel].label })}
                            {it.draft.approved && !it.draft.published && it.channel === "tiktok" && publishTo.tiktok && !it.draft.video && (
                              <span className="text-caption text-ink-2">{w.tiktokNeedsVideo}</span>
                            )}</span>
                            )}
                            {makesPictures && !it.draft.scene?.on && (it.draft.scene?.tries ?? 0) >= SCENE_TRIES_MAX && <span className="text-caption text-ink-2">{w.sceneTriesUsed}</span>}
                            {it.draft.check ? (
                              it.draft.check.problems.length > 0 ? (
                                <p className="text-caption text-danger-text">
                                  {fillWords(w.checkFound, { problems: problemsOf(it.draft.check.problems) })}
                                  {it.draft.check.note ? `. ${it.draft.check.note}` : ""}
                                </p>
                              ) : (
                                <span className="text-caption text-ink-2">{w.checked}</span>
                              )
                            ) : (
                              <span className="text-caption text-ink-2">{w.notChecked}</span>
                            )}
                            {mayWrite && (
                              <details className="text-sm">
                                <summary className="cursor-pointer">{w.edit}</summary>
                                <form
                                  className="mt-2 flex flex-col gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const caption = new FormData(e.currentTarget).get("caption");
                                    if (it.draft && typeof caption === "string") save(it.draft.id, caption);
                                  }}
                                >
                                  <Field label={w.words}>
                                    {(control) => (
                                      <TextArea name="caption" defaultValue={it.draft?.caption} rows={6} maxLength={CHANNEL_SPECS[it.channel].maxChars} full {...control} />
                                    )}
                                  </Field>
                                  <button type="submit" className={`${secondary} self-start`} disabled={pending}>
                                    {w.save}
                                  </button>
                                </form>
                              </details>
                            )}
                          </>
                        ) : (
                          <span className="text-caption text-ink-2">{w.notWritten}</span>
                        )}
                      </div>
                      {mayWrite && (
                        <div className="flex shrink-0 flex-wrap items-start gap-2">
                          {!it.draft && canWrite && it.idea && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => write([it], `write-${it.day}-${it.channel}`)}>
                              {w.write}
                            </button>
                          )}
                          {it.draft && !it.draft.approved && hasAi && (!it.draft.check || it.draft.check.problems.length > 0) ? (
                            <button type="button" className={secondary} disabled={pending} onClick={() => check(it.draft!.id)}>
                              {w.checkPicture}
                            </button>
                          ) : null}
                          {it.draft?.approved && !it.draft.published && publishTo[it.channel] && (it.channel !== "tiktok" || it.draft.video) && (
                            <button type="button" className={primary} disabled={pending} onClick={() => publish(it.draft!.id)}>
                              {w.postNow}
                            </button>
                          )}
                          {it.draft?.approved && !it.draft.published && publishTo[it.channel] && (it.channel !== "tiktok" || it.draft.video) && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => schedule(it.draft!.id, !it.draft!.scheduledFor)}>
                              {it.draft.scheduledFor ? w.dontPostOnItsDay : w.postOnItsDay}
                            </button>
                          )}
                          {it.draft && !it.draft.published && mayCarousel(it.channel, Boolean(it.draft.productId)) && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => setFormat(it.draft!.id, { carousel: !it.draft!.formats?.carousel })}>
                              {it.draft.formats?.carousel ? w.onePicture : w.makeCarousel}
                            </button>
                          )}
                          {it.draft && !it.draft.published && mayStory(it.channel) && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => setFormat(it.draft!.id, { story: !it.draft!.formats?.story })}>
                              {it.draft.formats?.story ? w.noStory : w.alsoStory}
                            </button>
                          )}
                          {it.draft && !it.draft.published && makesPictures && (it.draft.scene?.tries ?? 0) < SCENE_TRIES_MAX ? (
                            <button type="button" className={secondary} disabled={pending} onClick={() => scene(it.draft!.id)}>
                              {it.draft.scene?.on ? w.makeSceneAgain : w.makeScene}
                            </button>
                          ) : null}
                          {it.draft && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => video(it.draft!.id)}>
                              {it.draft.video ? w.makeVideoAgain : w.makeVideo}
                            </button>
                          )}
                          {it.draft?.video && (
                            <a className={secondary} href={it.draft.video} download>
                              {w.downloadVideo}
                            </a>
                          )}
                          {it.draft?.scene?.on && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => drawn(it.draft!.id)}>
                              {w.drawnPicture}
                            </button>
                          )}
                          {it.draft && !it.draft.approved && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => approve([it.draft!.id], `approve-${it.draft!.id}`)}>
                              {w.approve}
                            </button>
                          )}
                          {it.draft?.approved && !it.draft.published && (
                            <button type="button" className={secondary} disabled={pending} onClick={() => approve([it.draft!.id], `back-${it.draft!.id}`, false)}>
                              {w.unapprove}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
              </ol>
            </section>
          );
        })}
    </section>
  );
}
