"use client";

import { useState, useTransition } from "react";

import { Button } from "./ui";

type Problem = { ok: false; problem: string };

type Props = {
  storeSlug: string;
  broadcastId: string;
  locales: { code: string; name: string }[];
  /** How many it would go to now, as the page counted them. */
  people: number | null;
  test: (storeSlug: string, id: string, locale: string) => Promise<Problem | { ok: true; to: string }>;
  start: (storeSlug: string, id: string) => Promise<Problem | { ok: true; recipients: number }>;
  schedule: (storeSlug: string, id: string, when: string) => Promise<Problem | { ok: true }>;
};

/**
 * Sending a saved broadcast (D297, 5.3): a test to the staff member's own address first, then *Send now* (asked once more, with how many it goes
 * to) or a time to send it at. The server checks everything again.
 */
export function BroadcastSend(props: Props) {
  const { storeSlug, broadcastId } = props;
  const [locale, setLocale] = useState(props.locales[0]?.code ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, start] = useTransition();

  const run = (work: () => Promise<{ kind: "ok" | "problem"; text: string }>) =>
    start(async () => {
      setMessage(null);
      setMessage(await work());
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-2">
        {props.locales.length > 1 && (
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            Language
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3">
              {props.locales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await props.test(storeSlug, broadcastId, locale);
              return r.ok ? { kind: "ok", text: `A test went to ${r.to}.` } : { kind: "problem", text: r.problem };
            })
          }
        >
          Send a test to yourself
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {!confirming ? (
          <div>
            <Button kind="main" disabled={busy || props.people === 0} onClick={() => setConfirming(true)}>
              Send now
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-panel border border-warning-line bg-warning-soft p-3">
            <p className="text-body text-warning-text">
              {props.people === null
                ? "Send it to everyone it is for? It cannot be taken back."
                : `Send it to ${props.people.toLocaleString("en-GB")} ${props.people === 1 ? "person" : "people"}? It cannot be taken back.`}
            </p>
            <div className="flex gap-2">
              <Button
                kind="main"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await props.start(storeSlug, broadcastId);
                    setConfirming(false);
                    return r.ok ? { kind: "ok", text: `Sending to ${r.recipients.toLocaleString("en-GB")}.` } : { kind: "problem", text: r.problem };
                  })
                }
              >
                {busy ? "Starting…" : "Yes, send it"}
              </Button>
              <Button kind="quiet" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
            </div>
          </div>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-body text-ink-2">Send it later</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            When (your computer&apos;s time)
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3" />
          </label>
          <Button
            disabled={busy || !when}
            onClick={() =>
              run(async () => {
                const r = await props.schedule(storeSlug, broadcastId, new Date(when).toISOString());
                return r.ok ? { kind: "ok", text: "Scheduled." } : { kind: "problem", text: r.problem };
              })
            }
          >
            Schedule
          </Button>
        </div>
      </details>

      {message && (
        <p role={message.kind === "problem" ? "alert" : "status"} className={`text-body ${message.kind === "problem" ? "text-danger-text" : "text-positive-text"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
