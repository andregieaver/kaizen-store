"use client";

import { useId, useState } from "react";

import type { ProductBlock, ProductFieldNeed } from "@/lib/page-content";
import { questionFieldsOf, questionKindOf } from "@/lib/product-question";

import { useAdminText } from "./admin-text";
import { Check, Choices, TextField } from "./block-fields";

type Patch = Partial<ProductBlock>;

/** Up to five addresses, typed with commas or spaces between them, kept when the field is left (so a half-typed list is not cut). */
function RecipientsField({ label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: (list: string[] | undefined) => void }) {
  const id = useId();
  const [text, setText] = useState(value.join(", "));
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        id={id}
        type="text"
        inputMode="email"
        value={text}
        maxLength={1300}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const list = [...new Set(text.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 5);
          setText(list.join(", "));
          onChange(list.length > 0 ? list : undefined);
        }}
        className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal"
      />
      <span className="text-xs font-normal text-muted">{hint}</span>
    </label>
  );
}

/**
 * The buy part's Request a quote (D431): beside Add to cart, or instead of it, where the store offers quotes (Settings, Orders). Homer's
 * default is beside; a product priced on request offers only the quote whatever this says.
 */
export function QuotePlacementField({ block, onChange }: { block: ProductBlock; onChange: (patch: Patch) => void }) {
  const w = useAdminText("builder").quotePart;
  return (
    <Choices
      legend={w.placement}
      hint={w.placementHint}
      options={[
        { value: "beside", label: w.beside },
        { value: "instead", label: w.instead },
      ]}
      value={block.quote ?? "beside"}
      onChange={(quote) => onChange({ quote: quote === "beside" ? undefined : quote })}
    />
  );
}

/**
 * The product question's settings (D431): its kind first (a question to the inbox, or a request for a quote), then its words; which fields it
 * asks and the copy's addresses are one step away (Fields, Copy by email), as the email form keeps its recipients.
 */
export function QuestionPartFields({ block, onChange }: { block: ProductBlock; onChange: (patch: Patch) => void }) {
  const w = useAdminText("builder").quotePart;
  const kind = questionKindOf(block);
  const fields = questionFieldsOf(block);
  const need = (key: keyof typeof fields, value: ProductFieldNeed) => onChange({ questionFields: { ...block.questionFields, [key]: value } });
  const needs = [
    { value: "hidden" as const, label: w.hidden },
    { value: "optional" as const, label: w.optional },
    { value: "required" as const, label: w.required },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={w.kind}
        options={[
          { value: "question", label: w.kindQuestion },
          { value: "quote", label: w.kindQuote },
        ]}
        value={kind}
        onChange={(next) => onChange({ questionKind: next === "question" ? undefined : next })}
      />
      <p className="text-xs text-muted">{kind === "quote" ? w.kindQuoteHint : w.kindQuestionHint}</p>
      <Check label={w.showHeading} checked={block.showHeading !== false} onChange={(on) => onChange({ showHeading: on ? undefined : false })} />
      {block.showHeading !== false && (
        <TextField label={w.heading} value={block.heading ?? ""} max={120} placeholder={w.languageWords} onChange={(heading) => onChange({ heading: heading || undefined })} />
      )}
      <TextField label={w.intro} value={block.intro ?? ""} max={500} multiline placeholder={w.languageWords} onChange={(intro) => onChange({ intro: intro || undefined })} />
      <TextField label={w.button} value={block.buttonLabel ?? ""} max={100} placeholder={w.languageWords} onChange={(buttonLabel) => onChange({ buttonLabel: buttonLabel || undefined })} />
      <TextField label={w.success} value={block.successMessage ?? ""} max={500} multiline placeholder={w.languageWords} onChange={(successMessage) => onChange({ successMessage: successMessage || undefined })} />
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">{w.fields}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">{w.emailAlways}</p>
          <Choices legend={w.name} options={needs} value={fields.name} onChange={(v) => need("name", v)} />
          <Choices legend={w.phone} options={needs} value={fields.phone} onChange={(v) => need("phone", v)} />
          <Choices legend={w.company} options={needs} value={fields.company} onChange={(v) => need("company", v)} />
          <Choices legend={kind === "quote" ? w.note : w.message} options={needs} value={fields.message} onChange={(v) => need("message", v)} />
        </div>
      </details>
      {kind === "question" && (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">{w.copy}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <RecipientsField label={w.copyTo} hint={w.copyHint} value={block.recipients ?? []} onChange={(recipients) => onChange({ recipients })} />
          </div>
        </details>
      )}
    </div>
  );
}
