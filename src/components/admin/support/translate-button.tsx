"use client";

import { useState } from "react";

import type { ActResult } from "./desk-context";

/**
 * *Translate* under a customer's message (D216, 2.4, step 13): the message in English for the person reading, shown under it and
 * marked as the AI's. It is theirs alone: nothing is written to the conversation and the customer never sees it.
 */
export function TranslateButton({ seq, translate }: { seq: number; translate: (seq: number) => Promise<ActResult> }) {
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "done"; text: string } | { status: "failed"; problem: string }>({ status: "idle" });
  if (state.status === "done")
    return (
      <div className="max-w-[85%] rounded-2xl border border-dashed border-border px-3 py-2 text-sm" data-translation>
        <p className="text-xs text-muted">In English · Translated by AI · only you see this</p>
        <p className="whitespace-pre-line">{state.text}</p>
      </div>
    );
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        disabled={state.status === "busy"}
        onClick={async () => {
          setState({ status: "busy" });
          try {
            const result = await translate(seq);
            setState(result.ok && result.text ? { status: "done", text: result.text } : { status: "failed", problem: result.ok ? "No translation came back." : result.problem });
          } catch {
            setState({ status: "failed", problem: "The message could not be translated just now." });
          }
        }}
        className="text-muted underline disabled:opacity-50"
      >
        {state.status === "busy" ? "Translating…" : "Translate"}
      </button>
      {state.status === "failed" && <span role="alert">{state.problem}</span>}
    </span>
  );
}
