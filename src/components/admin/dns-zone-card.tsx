"use client";

import { useState, useTransition } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import { RECIPES, RECIPE_IDS, type RecipeId } from "@/lib/dns-recipes";

import { ActionForm, SubmitButton } from "./action-form";
import type { DnsApply, DnsCheckFn, DnsDraftShape, DnsCheckShape, DomainAction } from "./domain-types";
import { Button, Card, Chip } from "./ui";

export type ZoneRecordRow = { id: string; type: string; name: string; value: string; priority: number | null; kept: boolean };
export type ZoneHistoryRow = { id: string; summary: string; by: string; when: string; automatic: boolean; undone: boolean; isUndo: boolean };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * One domain whose DNS Kaizena Flow keeps (D315 5): Homer sees one line and the ready-made set-ups; *Records* opens the editor for Lisa. Every
 * change is checked first and says what it does in words, then made; the history keeps every change with Undo.
 */
export function DnsZoneCard({
  apex,
  records,
  history,
  words,
  owner,
  auto,
  locale,
  actions,
}: {
  apex: string;
  records: ZoneRecordRow[];
  history: ZoneHistoryRow[];
  words: DomainsMessages["dns"];
  owner: boolean;
  auto: boolean;
  locale: string;
  actions: { check: DnsCheckFn; apply: DnsApply; undo: DomainAction; auto: DomainAction };
}) {
  const [draft, setDraft] = useState<DnsDraftShape | null>(null);
  const [checked, setChecked] = useState<DnsCheckShape | null>(null);
  const [added, setAdded] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [recipe, setRecipe] = useState<RecipeId | "">("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [pending, start] = useTransition();
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(iso));

  const check = (next: DnsDraftShape) => {
    setDraft(next);
    setResult(null);
    start(async () => setChecked(await actions.check(apex, next)));
  };
  const apply = () => {
    if (!draft || !checked?.ok) return;
    start(async () => {
      const state = await actions.apply(apex, draft, checked.rev);
      setResult({ ok: state.status === "ok", messages: state.messages });
      if (state.status === "ok") {
        setChecked(null);
        setDraft(null);
        setAdded("");
        setRemoved([]);
        setValues({});
      }
    });
  };

  return (
    <Card title={`${words.title}: ${apex}`} description={words.intro}>
      <div className="flex flex-col gap-5">
        {owner && (
          <ActionForm action={actions.auto} className="flex flex-wrap items-center gap-3">
            <span className="text-body text-ink-2">{auto ? words.autoOn : words.autoOff}</span>
            {!auto && <input type="hidden" name="on" value="on" />}
            <SubmitButton variant="secondary">{auto ? words.autoTurnOff : words.autoTurnOn}</SubmitButton>
          </ActionForm>
        )}

        {owner && (
          <section className="flex flex-col gap-3" aria-label={words.recipes.title}>
            <h3 className="text-body-strong text-ink">{words.recipes.title}</h3>
            <p className="text-caption text-muted">{words.recipes.intro}</p>
            <select
              value={recipe}
              onChange={(e) => {
                setRecipe(e.target.value as RecipeId | "");
                setValues({});
                setChecked(null);
              }}
              className={input}
              aria-label={words.recipes.title}
            >
              <option value="">…</option>
              {RECIPE_IDS.map((id) => (
                <option key={id} value={id}>
                  {words.recipes[id]}
                </option>
              ))}
            </select>
            {recipe && (
              <div className="flex flex-col gap-2">
                {RECIPES[recipe].inputs.map((field) => (
                  <label key={field.key} className="flex flex-col gap-1 text-sm">
                    {words.recipes.inputs[field.key as keyof typeof words.recipes.inputs] ?? field.key}
                    {field.key === "records" ? (
                      <textarea rows={5} value={values[field.key] ?? ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className={`${input} py-2 font-mono`} />
                    ) : (
                      <input value={values[field.key] ?? ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className={input} spellCheck={false} />
                    )}
                  </label>
                ))}
                {RECIPES[recipe].source && (
                  <p className="text-caption text-muted">
                    {words.recipes.source.replace("{provider}", words.recipes[recipe]).replace("{date}", RECIPES[recipe].source!.read)}
                  </p>
                )}
                <div>
                  <Button kind="strong" disabled={pending} onClick={() => check({ kind: "recipe", recipe, values })}>
                    {words.recipes.use}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        <details className="rounded-panel border border-line p-4">
          <summary className="cursor-pointer text-body-strong text-ink">{words.title}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-normal">{words.type}</th>
                  <th className="py-2 pr-3 font-normal">{words.name}</th>
                  <th className="py-2 pr-3 font-normal">{words.value}</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3 font-mono">{r.type}</td>
                    <td className="py-2 pr-3 font-mono break-all">{r.name || "@"}</td>
                    <td className="py-2 pr-3 font-mono break-all">
                      {r.priority !== null ? `${r.priority} ` : ""}
                      {r.value}
                    </td>
                    <td className="py-2">
                      {r.kept ? (
                        <Chip>{words.kept}</Chip>
                      ) : (
                        owner && (
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={removed.includes(r.id)} onChange={(e) => setRemoved(e.target.checked ? [...removed, r.id] : removed.filter((x) => x !== r.id))} />
                            {words.remove}
                          </label>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {owner && (
            <div className="mt-4 flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                {words.add}
                <textarea rows={3} value={added} onChange={(e) => setAdded(e.target.value)} className={`${input} py-2 font-mono`} spellCheck={false} />
                <span className="text-caption text-muted">{words.addHint}</span>
              </label>
              <div>
                <Button kind="secondary" disabled={pending || (!added.trim() && removed.length === 0)} onClick={() => check({ kind: "records", add: added, remove: removed })}>
                  {words.check}
                </Button>
              </div>
            </div>
          )}
        </details>

        {checked && (
          <div className="flex flex-col gap-2 rounded-panel border border-line bg-sunken p-4" role="status">
            {checked.ok ? (
              <>
                <ul className="flex flex-col gap-1 text-body text-ink">
                  {checked.effects.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <pre className="whitespace-pre-wrap break-all font-mono text-caption text-ink-2">{checked.lines.join("\n")}</pre>
                <div>
                  <Button kind="main" disabled={pending} onClick={apply}>
                    {words.apply}
                  </Button>
                </div>
              </>
            ) : (
              <ul className="text-body text-danger-text">
                {checked.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result && (
          <p role="status" className={result.ok ? "text-body text-positive-text" : "text-body text-danger-text"}>
            {result.messages.join(" ")}
          </p>
        )}

        {history.length > 0 && (
          <details className="rounded-panel border border-line p-4">
            <summary className="cursor-pointer text-body-strong text-ink">{words.history}</summary>
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
                    <span>{date(h.when)}</span>
                    <span>{h.by}</span>
                    {h.automatic && <Chip signal="insight">{words.automatic}</Chip>}
                    {h.undone && <Chip>{words.undone}</Chip>}
                  </div>
                  <pre className="whitespace-pre-wrap break-all font-mono text-caption text-ink-2">{h.summary}</pre>
                  {owner && !h.undone && !h.isUndo && (
                    <ActionForm action={actions.undo}>
                      <input type="hidden" name="change" value={h.id} />
                      <SubmitButton variant="secondary">{words.undo}</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
