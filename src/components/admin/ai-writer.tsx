"use client";

import { useState, useTransition } from "react";

import type { SuggestResult } from "@/app/admin/(gated)/[store]/products/actions";
import {
  canWrite,
  findingLabel,
  writtenFindings,
  type ProductFacts,
  type WriteKind,
  type WriteRequest,
  type WrittenField,
  type WrittenText,
} from "@/lib/product-writing";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

/**
 * Write with AI (D76), beside a product's texts in one language: asks the
 * store's text model for a description, a better one, search texts, or a
 * translation of the main language's texts. The suggestion is shown here
 * to edit; "Use this" copies it into the fields, and the product is saved
 * as usual. It cannot be used while the claims filter finds something in
 * it: staff take those phrases out (or write their own) first.
 */
export function AiWriter({
  isPrimary,
  language,
  fromLanguage,
  facts,
  sourceFacts,
  suggest,
  onUse,
}: {
  isPrimary: boolean;
  /** The language shown, by name, e.g. "Swedish". */
  language: string;
  /** The main language, by name, to translate from. */
  fromLanguage: string;
  /** This language's texts, with the product's categories, tags and options. */
  facts: ProductFacts;
  /** The main language's texts, to translate. */
  sourceFacts: ProductFacts;
  suggest: (request: WriteRequest) => Promise<SuggestResult>;
  onUse: (written: WrittenText) => void;
}) {
  const w = useAdminText("product").aiWriter;
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ written: WrittenText; model: string; avoid: string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const actions: { kind: WriteKind; label: string; facts: ProductFacts }[] = isPrimary
    ? [
        { kind: "write", label: w.write, facts },
        { kind: "improve", label: w.improve, facts },
        { kind: "seo", label: w.seo, facts },
      ]
    : [
        { kind: "translate", label: fillWords(w.translate, { language: fromLanguage }), facts: sourceFacts },
        { kind: "seo", label: w.seo, facts },
      ];

  const ask = (kind: WriteKind, given: ProductFacts) =>
    start(async () => {
      setProblem(null);
      const result = await suggest({ kind, language, fromLanguage: kind === "translate" ? fromLanguage : "", facts: given });
      if (result.ok) setDraft({ written: result.written, model: result.model, avoid: result.avoid });
      else setProblem(result.problem);
    });

  const findings = draft ? writtenFindings(draft.written, draft.avoid) : {};
  const blocked = Object.keys(findings).length > 0;
  const empty = draft ? Object.values(draft.written).some((text) => !text?.trim()) : true;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{w.title}</span>
        {actions.map((action) => (
          <button
            key={action.kind}
            type="button"
            disabled={pending || !canWrite(action.kind, action.facts)}
            onClick={() => ask(action.kind, action.facts)}
            className="min-h-9 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
        {pending && (
          <span role="status" className="text-sm text-muted">
            {w.writing}
          </span>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      {draft && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{fillWords(w.written, { model: draft.model })}</p>
          {(Object.entries(draft.written) as [WrittenField, string][]).map(([field, text]) => (
            <label key={field} className="flex flex-col gap-1 text-sm font-medium">
              {w.fields[field]}
              <textarea
                value={text}
                onChange={(e) => setDraft({ ...draft, written: { ...draft.written, [field]: e.target.value } })}
                rows={field === "description" ? 6 : 2}
                lang={language}
                aria-invalid={Boolean(findings[field])}
                className="min-h-10 w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
              />
              {findings[field] && (
                <ul className="flex flex-col gap-0.5 font-normal text-danger-text">
                  {findings[field].map((finding) => (
                    <li key={`${finding.index}-${finding.phrase}`}>
                      {w.findings[finding.kind] ?? findingLabel(finding.kind)}: &ldquo;{finding.phrase}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
            </label>
          ))}
          {blocked && (
            <p className="text-sm">{w.blocked}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={blocked || empty}
              onClick={() => {
                onUse(draft.written);
                setDraft(null);
              }}
              className="min-h-10 rounded-pill button-primary px-4 text-sm font-medium disabled:opacity-50"
            >
              {w.use}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-10 rounded-pill border border-edge px-4 text-sm hover:bg-sunken">
              {w.discard}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
