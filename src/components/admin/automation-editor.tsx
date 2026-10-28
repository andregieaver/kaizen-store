"use client";

import { useState, useTransition } from "react";

import type { BroadcastContent, BroadcastSuggestion, FindFacts } from "@/lib/broadcasts";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { EmailContentFields } from "./broadcast-editor";
import { Button } from "./ui";

type Problem = { ok: false; problem: string };

/** Switching an automation on or off (D298, 6.1): one press; the server says why it cannot be on. */
export function AutomationSwitch({
  storeSlug,
  kind,
  on,
  label,
  toggle,
}: {
  storeSlug: string;
  kind: string;
  on: boolean;
  /** The words for switching on (*Switch on*, *Turn on back in stock*). */
  label?: string;
  toggle: (storeSlug: string, kind: string, on: boolean) => Promise<Problem | { ok: true }>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const wa = useAdminText("marketing").automations;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        kind={on ? "quiet" : "main"}
        disabled={busy}
        onClick={() =>
          start(async () => {
            setProblem(null);
            const r = await toggle(storeSlug, kind, !on);
            if (!r.ok) setProblem(r.problem);
          })
        }
      >
        {busy ? wa.oneMoment : on ? wa.switchOff : (label ?? wa.switchOn)}
      </Button>
      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}

type Props = {
  storeSlug: string;
  kind: string;
  initial: { delayDays: number; content: BroadcastContent };
  range: { min: number; max: number };
  daysLabel: string;
  locales: { code: string; name: string }[];
  aiReady: boolean;
  save: (storeSlug: string, kind: string, input: unknown) => Promise<Problem | { ok: true }>;
  test: (storeSlug: string, kind: string, locale: string) => Promise<Problem | { ok: true; to: string }>;
  suggest: (storeSlug: string, brief: string, locale: string) => Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }>;
  upload: ((storeSlug: string, data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>) | null;
  /** The store's products and running campaigns to put in (D352). */
  facts?: FindFacts;
};

/**
 * A lifecycle automation's days and words (D298, 6.1 and 6.6): the broadcast editor's fields per language, Save, and a test to the staff member's
 * own address in a language they choose. The server checks everything again.
 */
export function AutomationEditor(props: Props) {
  const { storeSlug, kind } = props;
  const [delayDays, setDelayDays] = useState(String(props.initial.delayDays));
  const [content, setContent] = useState<BroadcastContent>(props.initial.content);
  const [testLocale, setTestLocale] = useState(props.locales[0]?.code ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  const [busy, start] = useTransition();
  const w = useAdminText("marketing");

  const run = (work: () => Promise<{ kind: "ok" | "problem"; text: string }>) =>
    start(async () => {
      setMessage(null);
      setMessage(await work());
    });

  const save = () =>
    run(async () => {
      const written = Object.fromEntries(Object.entries(content).filter(([, c]) => c.subject.trim() || c.preview.trim() || c.blocks.length > 0));
      const r = await props.save(storeSlug, kind, { delayDays: Number(delayDays), content: written });
      return r.ok ? { kind: "ok", text: w.common.saved } : { kind: "problem", text: r.problem };
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="automation-days" className="text-body-strong text-ink">
          {props.daysLabel}
        </label>
        <input
          id="automation-days"
          type="number"
          inputMode="numeric"
          min={props.range.min}
          max={props.range.max}
          step={1}
          value={delayDays}
          onChange={(e) => setDelayDays(e.target.value)}
          className="min-h-10 w-32 rounded-md border border-line bg-card px-3"
        />
      </div>

      <EmailContentFields
        storeSlug={storeSlug}
        locales={props.locales}
        content={content}
        onChange={setContent}
        aiReady={props.aiReady}
        suggest={props.suggest}
        upload={props.upload}
        facts={props.facts}
      />

      {message && (
        <p role={message.kind === "problem" ? "alert" : "status"} className={`text-body ${message.kind === "problem" ? "text-danger-text" : "text-positive-text"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Button kind="main" onClick={save} disabled={busy}>
          {busy ? w.common.saving : w.common.save}
        </Button>
        {props.locales.length > 1 && (
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            {w.automations.testIn}
            <select value={testLocale} onChange={(e) => setTestLocale(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3">
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
              const r = await props.test(storeSlug, kind, testLocale);
              return r.ok ? { kind: "ok", text: fillWords(w.common.testWent, { to: r.to }) } : { kind: "problem", text: r.problem };
            })
          }
        >
          {w.common.sendTest}
        </Button>
      </div>
    </div>
  );
}
