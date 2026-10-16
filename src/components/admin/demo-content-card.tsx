"use client";

import { useActionState } from "react";

import { idle, type FormState } from "./action-form";
import { Button, Card } from "./ui";

/** A demo item as the card lists it: what it is, by the word the owner knows ("Product"), and its name. */
export type DemoCardItem = { noun: string; title: string };

export type DemoCardSummary = {
  /** "6 products, 2 pages and 3 categories". */
  words: string;
  items: DemoCardItem[];
  /** What the owner changed, which stays. */
  changed: DemoCardItem[];
};

const NOUN: Record<string, string> = { product: "Product", page: "Page", article: "Article", category: "Category", tag: "Tag" };

function Items({ items }: { items: DemoCardItem[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => (
        <li key={`${item.noun}-${index}`} className="flex gap-2">
          <span className="w-20 shrink-0 text-muted">{NOUN[item.noun] ?? item.noun}</span>
          <span>{item.title}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * *Remove demo content* on a store's Home (`docs/theme-showcase-phase-1.md` step 4b), for owners: one sentence and one press for Homer,
 * the list of what goes and what stays one step away. It stays on the page after the press (the page drawn again has no demo content and
 * passes `summary` null) to say what was removed and what was kept.
 */
export function DemoContentCard({
  summary,
  action,
}: {
  summary: DemoCardSummary | null;
  action: (state: FormState, data: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  if (state.status === "ok") {
    return (
      <Card title="Demo content removed">
        <div role="status" className="flex flex-col gap-1 text-body">
          {state.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      </Card>
    );
  }
  if (!summary) return null;
  return (
    <Card
      title="Demo content"
      description={`Your store came with demo content to show how it looks: ${summary.words}. Remove it when your own is in. Anything you changed stays.`}
    >
      <form action={formAction} aria-busy={pending} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="strong" type="submit" disabled={pending}>
            Remove demo content
          </Button>
        </div>
        <details className="text-body">
          <summary className="cursor-pointer text-ink-2">What it removes</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Items items={summary.items} />
            <p className="text-muted">Products are archived, so past orders keep them. Pages, categories and tags are deleted, and their links leave your menus.</p>
            {summary.changed.length > 0 && (
              <>
                <p>You changed these, so they stay:</p>
                <Items items={summary.changed} />
              </>
            )}
          </div>
        </details>
        <div role="status" aria-live="polite" className="text-sm">
          {state.status === "error" && (
            <ul className="list-disc pl-5 text-danger-text">
              {state.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Card>
  );
}
