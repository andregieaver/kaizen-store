"use client";

import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminAreaMessages } from "@/lib/admin-text";
import { RULES_MAX, type RuleAction, type SearchRule } from "@/lib/search-rules";

import type { FormAction } from "./synonyms-card";

export type RuleWords = AdminAreaMessages["bookings"]["search"]["rules"];

export type RuleLine = SearchRule & { productTitle: string | null; termName: string | null; termKind: string | null; remove: FormAction };

const FIELD = "min-h-10 rounded-panel border border-edge bg-card px-3";

/** A rule in a sentence: what it does, to what, and for which searches. */
function lineOf(rule: RuleLine, w: RuleWords): string {
  const subject = rule.productId
    ? (rule.productTitle ?? w.gone)
    : rule.termName === null
      ? w.gone
      : fillWords(rule.termKind === "tag" ? w.tag : w.category, { name: rule.termName });
  const what =
    rule.action === "pin"
      ? fillWords(w.lines.pin, { product: subject })
      : rule.action === "redirect"
        ? fillWords(w.lines.redirect, { target: rule.target ?? "" })
        : fillWords(w.lines[rule.action], { subject });
  const queries = rule.queries.join(", ");
  const forWhom = rule.queries.length === 0 ? w.every : fillWords(rule.match === "exact" ? w.forExact : w.forSearches, { queries });
  return `${what} · ${forWhom}`;
}

/**
 * The Search page's *Results and pages* card (wave 6 unit F2, D324): the store's pins, boosts, buries and search redirects as sentences, and a
 * form to add one. A search that found nothing can open it ready to send that search to a page (`prefill`). Only members with
 * `settings:write` get the form and the Remove buttons.
 */
export function RulesCard({
  words: w,
  lines,
  products,
  terms,
  pages,
  canWrite,
  save,
  prefill,
}: {
  words: RuleWords;
  lines: RuleLine[];
  products: { id: string; title: string }[];
  terms: { id: string; name: string; kind: string }[];
  /** Addresses of the store a search may be sent to (published pages, categories, tags), offered as the target is typed. */
  pages: { path: string; label: string }[];
  canWrite: boolean;
  save: FormAction;
  /** A search to send to a page, from the zero-result list. */
  prefill: string | null;
}) {
  const [action, setAction] = useState<RuleAction>(prefill ? "redirect" : "pin");
  const subjectOptional = action === "boost" || action === "bury";
  return (
    <Card title={w.title} description={w.description} aside={fillWords(w.count, { n: lines.length, max: RULES_MAX })}>
      <div id="rules" className="flex flex-col gap-5">
        {lines.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <ul className="divide-y divide-line rounded-panel border border-line text-sm">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="break-words">{lineOf(line, w)}</span>
                {canWrite && (
                  <ActionForm action={line.remove} className="flex items-center gap-2" successMessage={w.removed}>
                    <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <ActionForm action={save} className="flex flex-col gap-3 border-t border-line pt-4" successMessage={w.saved}>
            <h3 className="text-body-strong text-ink">{w.add}</h3>
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              {w.action}
              <select name="action" value={action} onChange={(event) => setAction(event.target.value as RuleAction)} className={FIELD}>
                {(["pin", "boost", "bury", "redirect"] as const).map((value) => (
                  <option key={value} value={value}>
                    {w.actions[value]}
                  </option>
                ))}
              </select>
            </label>

            {action !== "redirect" && (
              <label className="flex max-w-md flex-col gap-1 text-sm">
                {w.product}
                <select name="productId" required={action === "pin"} defaultValue="" className={FIELD}>
                  <option value="">{w.chooseProduct}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {subjectOptional && terms.length > 0 && (
              <label className="flex max-w-md flex-col gap-1 text-sm">
                <span>
                  <span className="text-muted">{w.or} </span>
                  {w.term}
                </span>
                <select name="termId" defaultValue="" className={FIELD}>
                  <option value="">{w.chooseTerm}</option>
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {fillWords(term.kind === "tag" ? w.tag : w.category, { name: term.name })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {action === "pin" && (
              <label className="flex max-w-[10rem] flex-col gap-1 text-sm">
                {w.position}
                <input name="position" type="number" min={0} max={1000} defaultValue={0} className={FIELD} />
              </label>
            )}
            {action === "redirect" && (
              <label className="flex max-w-md flex-col gap-1 text-sm">
                {w.target}
                <input name="target" required list="search-rule-pages" maxLength={2000} className={FIELD} aria-describedby="search-rule-target-hint" />
                <datalist id="search-rule-pages">
                  {pages.map((page) => (
                    <option key={page.path} value={page.path}>
                      {page.label}
                    </option>
                  ))}
                </datalist>
                <span id="search-rule-target-hint" className="text-muted">
                  {w.targetHint}
                </span>
              </label>
            )}

            <label className="flex flex-col gap-1 text-sm">
              {w.queries}
              <input
                name="queries"
                required={!subjectOptional}
                defaultValue={prefill ?? ""}
                maxLength={2500}
                className={FIELD}
                aria-describedby="search-rule-queries-hint"
              />
              <span id="search-rule-queries-hint" className="text-muted">
                {w.queriesHint}
              </span>
            </label>
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="mb-1">{w.match}</legend>
              {(
                [
                  ["contains", w.matchContains],
                  ["exact", w.matchExact],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="radio" name="match" value={value} defaultChecked={value === (prefill ? "exact" : "contains")} />
                  {label}
                </label>
              ))}
            </fieldset>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
