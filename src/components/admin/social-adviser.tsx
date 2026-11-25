"use client";

import { useState, useTransition } from "react";

import { primary, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { Advice, CalendarSlot, Recommendation } from "@/lib/social-advice";
import { CHANNEL_SPECS, type PostChannel } from "@/lib/social-posts";

/**
 * The social media adviser on the Social posts page (D870 S1.4). Homer sees three verdicts and one button that writes the posts of its main
 * recommendation; Lisa opens every recommendation and the two-week plan, each with its own button, and reads every figure under *What the
 * adviser reads*. Asking and writing go to the page's routes (`/advise`, `/write`); the page is read again after, so the new advice or posts show.
 */

/** The newest advice, with its main recommendation (`mainRecommendation()`, worked out on the server). */
type Kept = { advice: Advice; main: Recommendation | null; createdAt: string } | null;
type WriteBody = { productId: string | null; topic: string; channels: PostChannel[] };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; problem?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await response.json().catch(() => ({ ok: false }))) as { ok: boolean; problem?: string };
}

export function SocialAdviser({
  kept,
  titles,
  base,
  mayWrite,
  hasAi,
  connectHref,
  visitsHref,
  dateLocale,
  timeZone,
  words: w,
}: {
  kept: Kept;
  /** Product titles by id, for the products the advice names. */
  titles: Record<string, string>;
  base: string;
  mayWrite: boolean;
  hasAi: boolean;
  connectHref: string;
  visitsHref: string;
  dateLocale: string;
  timeZone: string;
  words: SocialMessages["adviser"];
}) {
  const main = kept?.main ?? null;
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const act = (key: string, url: string, body: unknown) =>
    start(async () => {
      setBusy(key);
      setMessage(null);
      const result = await postJson(url, body).catch(() => ({ ok: false, problem: undefined }));
      setBusy(null);
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem ?? w.failed });
      setMessage({ tone: "ok", text: url.endsWith("/write") ? w.written : "" });
      window.location.reload();
    });
  const write = (key: string, body: WriteBody) => act(key, `${base}/write`, { ...body, withPrice: true });
  const ask = () => act("ask", `${base}/advise`, {});
  const canAct = mayWrite && hasAi;
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone });
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const subject = (productId: string | null, topic: string) => (productId ? (titles[productId] ?? w.noProduct) : topic);

    const recAction = (r: Recommendation, i: number) => {
    if (r.kind === "write")
      return canAct ? (
        <button type="button" className={secondary} disabled={pending} onClick={() => write(`rec-${i}`, { productId: r.productId, topic: r.topic, channels: r.channels })}>
          {busy === `rec-${i}` ? w.writing : w.write}
        </button>
      ) : null;
    if (r.kind === "connect_instagram") return <a className={secondary} href={connectHref}>{w.connectInstagram}</a>;
    if (r.kind === "count_visits") return <a className={secondary} href={visitsHref}>{w.countVisits}</a>;
    return null;
  };
  const slotWrite = (s: CalendarSlot, i: number) =>
    canAct ? (
      <button type="button" className={secondary} disabled={pending} onClick={() => write(`slot-${i}`, { productId: s.productId, topic: s.productId ? "" : s.idea, channels: [s.channel] })}>
        {busy === `slot-${i}` ? w.writing : w.write}
      </button>
    ) : null;

  return (
    <section aria-labelledby="social-adviser" className="flex flex-col gap-4 rounded-panel border border-line bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="social-adviser" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-caption text-ink-2">{kept ? fillWords(w.writtenAt, { date: date(kept.createdAt) }) : w.lead}</p>
      </div>
      {kept && (
        <ul className="flex flex-col gap-2">
          {kept.advice.verdicts.map((v, i) => (
            <li key={i} className="text-body text-ink">
              {v}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {kept && main && canAct && (
          <button type="button" className={primary} disabled={pending} onClick={() => write("main", { productId: main.productId, topic: main.topic, channels: main.channels })}>
            {busy === "main" ? w.writing : fillWords(w.writeMain, { title: main.title })}
          </button>
        )}
        {canAct && (
          <button type="button" className={kept ? secondary : primary} disabled={pending} onClick={ask}>
            {busy === "ask" ? w.asking : kept ? w.askAgain : w.ask}
          </button>
        )}
        <div role="status" aria-live="polite">
          {message?.text && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
        </div>
      </div>
      {kept && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-medium">{w.more}</summary>
          <h3 className="mt-3 text-body-strong text-ink">{w.recommendations}</h3>
          <ol className="flex flex-col gap-3">
            {kept.advice.recommendations.map((r, i) => (
              <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="flex flex-col">
                  <span className="text-body text-ink">{r.title}</span>
                  <span className="text-caption text-ink-2">{r.why}</span>
                  {r.kind === "write" && (
                    <span className="text-caption text-ink-2">
                      {subject(r.productId, r.topic)} · {r.channels.map((c) => CHANNEL_SPECS[c].label).join(", ")}
                    </span>
                  )}
                </div>
                {recAction(r, i)}
              </li>
            ))}
          </ol>
          <h3 className="mt-3 text-body-strong text-ink">{w.plan}</h3>
          {kept.advice.calendar.length === 0 ? (
            <p className="text-caption text-ink-2">{w.noPlan}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {kept.advice.calendar.map((s, i) => (
                <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex flex-col">
                    <span className="text-body text-ink">
                      {day(s.day)} · {CHANNEL_SPECS[s.channel].label}
                      {s.productId ? ` · ${titles[s.productId] ?? w.noProduct}` : ""}
                    </span>
                    <span className="text-caption text-ink-2">{s.idea}</span>
                  </div>
                  {slotWrite(s, i)}
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </section>
  );
}
