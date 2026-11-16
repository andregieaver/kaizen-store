"use client";

import { Sparkles } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { ASK_AI_MANAGER_EVENT, type AskDetail } from "@/lib/alert-ask";

function watchMark(changed: () => void): () => void {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ai-manager"] });
  return () => observer.disconnect();
}

const ask = (message: string) => window.dispatchEvent(new CustomEvent<AskDetail>(ASK_AI_MANAGER_EVENT, { detail: { message } }));

/**
 * *Ask your AI manager* on Home (round 1): a question box and three questions to start from, drawn only where the AI manager's launcher is
 * on the page (owners of an open store, the platform's owners). A press opens the panel with the words as the person's message.
 */
export function AskCard({ title, placeholder, asks }: { title: string; placeholder: string; asks: readonly string[] }) {
  const here = useSyncExternalStore(watchMark, () => document.documentElement.dataset.aiManager === "on", () => false);
  const [text, setText] = useState("");
  if (!here) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card bg-insight-soft p-5 dark:border dark:border-insight-line">
      <h2 className="flex items-center gap-2 text-body-strong text-insight-text">
        <Sparkles aria-hidden className="size-[18px]" />
        {title}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          ask(text.trim());
          setText("");
        }}
      >
        <input
          type="text"
          aria-label={title}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-11 w-full rounded-pill border border-insight-line bg-card px-4 text-body text-ink placeholder:text-muted"
        />
      </form>
      <div className="flex flex-wrap gap-1.5">
        {asks.map((question) => (
          <button key={question} type="button" onClick={() => ask(question)} className="min-h-8 rounded-pill bg-card px-3 text-caption text-ink hover:bg-sunken">
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}
