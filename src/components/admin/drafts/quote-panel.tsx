"use client";

import { useId, useState, useTransition } from "react";

import type { DraftActionResponse } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import { field, hint, secondary } from "@/components/admin/data/ui";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/drafts-words";
import { QUOTE_REPLY_MAX } from "@/lib/quotes";

import { ActionMessage } from "./draft-send";

/** What the draft page knows of a shopper's request for a quote (D431). */
export type DraftQuote = {
  /** The note as the shopper wrote it (plain text). */
  note: string | null;
  declinedAt: string | null;
  reply: string | null;
  decline: (reply: string) => Promise<DraftActionResponse>;
};

/**
 * The head of a draft a shopper asked for (D431): that it is a request for a quote, what to do (Homer: price the lines, press Send quote), the
 * shopper's note as text, and one step away *Decline the request* with a short reply emailed to them. A declined request says when and what
 * was replied.
 */
export function QuotePanel({ quote, timeZone }: { quote: DraftQuote; timeZone?: string }) {
  const id = useId();
  const w = useAdminText("drafts").editor.quote;
  const lang = useAdminLang();
  const [reply, setReply] = useState("");
  const [result, setResult] = useState<DraftActionResponse | null>(null);
  const [working, startTransition] = useTransition();
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 text-sm" data-quote-request>
      <h2 id={`${id}-h`} className="text-title text-ink">
        {w.title}
      </h2>
      <p className={hint}>{w.intro}</p>
      <div>
        <p className="font-medium">{w.note}</p>
        <p className="whitespace-pre-line break-words">{quote.note ?? <span className="text-muted">{w.noNote}</span>}</p>
      </div>
      {quote.declinedAt ? (
        <div>
          <p className="font-medium">{fillWords(w.declined, { when: when(quote.declinedAt) })}</p>
          <p className="whitespace-pre-line break-words">{quote.reply}</p>
        </div>
      ) : (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer font-medium">{w.decline}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className={hint}>{w.declineHint}</p>
            <label className="flex flex-col gap-1 font-medium">
              {w.reply}
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={3}
                maxLength={QUOTE_REPLY_MAX}
                placeholder={w.replyPlaceholder}
                className={`${field} py-2`}
              />
            </label>
            <div>
              <button
                type="button"
                disabled={working || reply.trim() === ""}
                onClick={() =>
                  startTransition(async () => {
                    setResult(await quote.decline(reply));
                  })
                }
                className={secondary}
              >
                {w.declineButton}
              </button>
            </div>
          </div>
        </details>
      )}
      {/* Outside the form: once declined, the page shows the declined request in its place, and this still says whether the reply went. */}
      <ActionMessage result={result} />
    </section>
  );
}
