"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import type { Finding } from "@/lib/data-job";
import { existingWords, hasError, helpLine, splitFindings, type FieldFindings } from "@/lib/redirect-admin";
import { redirectSentences } from "@/lib/redirects";

/** What the form asks the server, as the bound actions of the page give it (`checkRedirectAction`, `saveRedirectAction`). */
export type FormExisting = { kind: "manual"; target: string } | { kind: "automatic" } | null;
export type FormCheck =
  | { ok: true; saveable: boolean; source: string | null; target: string | null; findings: Finding[]; existing: FormExisting }
  | { ok: false; problems: string[] };
export type FormSave =
  | { ok: true; source: string; target: string; created: boolean; unchanged: boolean; replacedAutomatic: boolean; findings: Finding[] }
  | { ok: false; problems: string[]; findings: Finding[] };

export type RedirectFormActions = {
  check: (input: { from: string; to: string }) => Promise<FormCheck>;
  save: (input: { from: string; to: string }, id?: string) => Promise<FormSave>;
};

const SEVERITY_STYLE = { error: "text-red-700 dark:text-red-400", warning: "text-amber-700 dark:text-amber-400", info: "text-muted" } as const;

/** The findings of one field, one sentence each, under it. The sentence names only addresses (`finding()` never quotes another cell). */
export function FindingList({ findings, id }: { findings: readonly Finding[]; id?: string }) {
  if (findings.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-0.5 text-xs">
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className={SEVERITY_STYLE[f.severity]}>
          {f.text}
        </li>
      ))}
    </ul>
  );
}

const EXAMPLE = redirectSentences.fromHelp("/collections/shoes", "/category/shoes");

/**
 * The form that adds a manual redirect or edits one (2.2.2): two fields, *Redirect from* and *Redirect to*, each a path on the store. The server checks the pair
 * when a field is left and again when it is saved (`checkRedirectAction`, `saveRedirectAction`: the same one check as the import's), and its sentences are shown
 * under the field they are about. It refuses and says why (a live page, a loop, another website, the limit), warns and saves (a target that does not exist, a
 * chain collapsed to its final destination, a query cut), and asks before replacing a redirect from the same address. Nothing is saved until the button is
 * pressed; what was typed stays when a check refuses.
 */
export function RedirectForm({
  actions,
  initial = { from: "", to: "" },
  editing = null,
  onDone,
  onCancel,
  submitLabel,
}: {
  actions: RedirectFormActions;
  initial?: { from: string; to: string };
  /** The redirect being edited: its id and the address it goes from now (that address's own redirect is not "an existing one"). */
  editing?: { id: string; source: string } | null;
  onDone?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [checked, setChecked] = useState<{ source: string | null; target: string | null; findings: Finding[]; existing: FormExisting; saveable: boolean } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ text: string; findings: Finding[] } | null>(null);
  const [busy, startBusy] = useTransition();
  const latest = useRef(0);

  const run = (nextFrom: string, nextTo: string) => {
    if (nextFrom.trim() === "") {
      setChecked(null);
      return;
    }
    const ticket = (latest.current += 1);
    startBusy(async () => {
      const result = await actions.check({ from: nextFrom, to: nextTo });
      if (ticket !== latest.current) return;
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      setProblems([]);
      setChecked({ source: result.source, target: result.target, findings: result.findings, existing: result.existing, saveable: result.saveable });
    });
  };

  const submit = () =>
    startBusy(async () => {
      latest.current += 1;
      setSaved(null);
      const result = await actions.save({ from, to }, editing?.id);
      if (!result.ok) {
        setProblems(result.problems);
        setChecked((c) => ({ source: c?.source ?? null, target: c?.target ?? null, existing: c?.existing ?? null, saveable: false, findings: result.findings }));
        return;
      }
      setProblems([]);
      setChecked(null);
      setSaved({
        text: result.unchanged ? `The redirect from ${result.source} to ${result.target} was already there.` : `${result.created ? "Saved" : "Changed"}: ${result.source} now goes to ${result.target}.`,
        findings: result.findings.filter((f) => f.severity !== "error"),
      });
      if (!editing) {
        setFrom("");
        setTo("");
      }
      router.refresh();
      onDone?.();
    });

  const shown: FieldFindings = checked ? splitFindings(checked.findings) : { from: [], to: [], line: [] };
  const existing = editing && checked?.source === editing.source ? null : (checked?.existing ?? null);
  const ask = existingWords(existing, checked?.source ?? null);
  const blocked = checked !== null && (!checked.saveable || hasError(checked.findings));
  const help = checked && !blocked ? helpLine(checked.source, checked.target) : null;
  const label_ = submitLabel ?? (editing ? "Save the change" : existing?.kind === "manual" ? "Replace the redirect" : "Add the redirect");

  return (
    <form
      className={`${card} flex flex-col gap-3`}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-from`} className={label}>
            Redirect from
          </label>
          <input
            id={`${id}-from`}
            name="from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={() => run(from, to)}
            placeholder="/collections/shoes"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-from-findings`}
            aria-invalid={shown.from.some((f) => f.severity === "error") || undefined}
            className={`${field} font-mono`}
          />
          <FindingList id={`${id}-from-findings`} findings={shown.from} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-to`} className={label}>
            Redirect to
          </label>
          <input
            id={`${id}-to`}
            name="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => run(from, to)}
            placeholder="/category/shoes"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-to-findings`}
            aria-invalid={shown.to.some((f) => f.severity === "error") || undefined}
            className={`${field} font-mono`}
          />
          <FindingList id={`${id}-to-findings`} findings={shown.to} />
        </div>
      </div>
      <FindingList findings={shown.line} />
      <p className={hint}>{help ?? EXAMPLE}</p>
      {ask && (
        <p role="note" className="rounded-md border border-border bg-background p-2 text-sm">
          {ask}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || from.trim() === "" || to.trim() === "" || blocked} className={primary}>
          {busy ? "Working …" : label_}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={secondary}>
            Cancel
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
        {saved && <p>{saved.text}</p>}
        {saved && <FindingList findings={saved.findings} />}
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-red-700 dark:text-red-400">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
