"use client";

import { useId, useState } from "react";

import type { BrowserMessages } from "@/lib/messages/en-browser";
import { isRequestAddress, type StockRequestReply } from "@/lib/stock-request-check";

export type BackInStockLabels = BrowserMessages["backInStock"];

/**
 * *Email me when it is back* under a sold-out variant (D298, `docs/wave-5-marketing.md` 6.4): an address (a signed-in customer's filled in) and
 * one press. The answer says the request waits, or that an email is on its way to confirm it; nothing more.
 */
export function BackInStock({
  store,
  market,
  variantId,
  email: initial,
  labels,
}: {
  store: string;
  market: string;
  variantId: string;
  email: string;
  labels: BackInStockLabels;
}) {
  const id = useId();
  const [email, setEmail] = useState(initial);
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done" | "problem"; text: string; waiting?: boolean }>({ kind: "idle" });

  const send = async () => {
    if (!isRequestAddress(email)) return setState({ kind: "problem", text: labels.invalid });
    setState({ kind: "busy" });
    try {
      const response = await fetch("/api/stock-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, market, variant: variantId, email: email.trim(), lang: "" }),
      });
      const reply = (await response.json()) as StockRequestReply;
      if (reply.ok) setState({ kind: "done", text: reply.outcome === "waiting" ? labels.waiting : labels.check, waiting: reply.outcome === "waiting" });
      else setState({ kind: "problem", text: reply.error === "invalid" ? labels.invalid : reply.error === "busy" ? labels.busy : labels.failed });
    } catch {
      setState({ kind: "problem", text: labels.failed });
    }
  };

  // A signed-in customer's request waits at once; they can stop it here (D392). A typed address stops it from its email's link.
  const stop = async () => {
    try {
      const response = await fetch("/api/stock-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, market, variant: variantId }),
      });
      const reply = (await response.json()) as StockRequestReply;
      setState(reply.ok ? { kind: "done", text: labels.stopped } : { kind: "problem", text: labels.failed });
    } catch {
      setState({ kind: "problem", text: labels.failed });
    }
  };

  if (state.kind === "done") {
    return (
      <div className="flex flex-wrap items-center gap-3" data-back-in-stock>
        <p role="status" className="text-sm">
          {state.text}
        </p>
        {state.waiting && (
          <button type="button" onClick={() => void stop()} className="min-h-11 text-sm underline">
            {labels.stop}
          </button>
        )}
      </div>
    );
  }
  return (
    <form
      data-back-in-stock
      // The page's own check speaks the shopper's language; the browser's would not match it.
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {labels.prompt}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type="email"
          autoComplete="email"
          placeholder={labels.label}
          aria-label={labels.label}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-button border border-border bg-background px-3"
        />
        <button type="submit" disabled={state.kind === "busy"} className="min-h-11 rounded-button border border-border px-4 text-sm font-medium">
          {state.kind === "busy" ? labels.working : labels.button}
        </button>
      </div>
      <p className="text-xs text-muted">{labels.note}</p>
      {state.kind === "problem" && (
        <p role="alert" className="text-sm">
          {state.text}
        </p>
      )}
    </form>
  );
}
