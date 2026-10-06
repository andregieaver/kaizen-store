"use client";

import { useId, useState, useTransition } from "react";

import type { ArchiveActionState, TagsActionState } from "@/app/admin/(gated)/[store]/orders/ops-actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { TAGS_PER_ORDER, TAG_MAX_LENGTH, type Tag } from "@/lib/order-tags";

/**
 * The order page's tags (wave 3, D173, `docs/wave-3-orders.md` 2.3): the tags as chips with a remove cross, and a field to add (several with commas), with the store's tags in use as
 * suggestions. Tags are the store's own working labels: never shown to a shopper. A person who may only read sees the chips and nothing to change.
 */
export function TagsCard({
  tags: initial,
  suggestions,
  canWrite,
  change,
}: {
  tags: Tag[];
  suggestions: string[];
  canWrite: boolean;
  change: (change: { add?: string; remove?: string }) => Promise<TagsActionState>;
}) {
  const id = useId();
  const [tags, setTags] = useState(initial);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, startTransition] = useTransition();

  const apply = (request: { add?: string; remove?: string }) => {
    setMessage(null);
    startTransition(async () => {
      const answer = await change(request);
      if (answer.tags) setTags(answer.tags);
      if (answer.message) setMessage({ ok: answer.ok, text: answer.message });
      if (answer.ok && request.add) setText("");
    });
  };

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5 text-sm">
      <h2 id={`${id}-h`} className="font-medium">
        Tags
      </h2>
      {tags.length === 0 ? (
        <p className="text-muted">No tags.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-xs">
              {tag.label}
              {canWrite && (
                <button type="button" disabled={working} onClick={() => apply({ remove: tag.label })} aria-label={`Remove the tag ${tag.label}`} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-background">
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() !== "") apply({ add: text });
          }}
        >
          <label htmlFor={`${id}-add`} className="text-xs font-medium">
            Add tags <span className="font-normal text-muted">(separate with commas)</span>
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-add`}
              list={`${id}-suggestions`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={400}
              autoComplete="off"
              className={`${field} min-w-0 flex-1`}
            />
            <datalist id={`${id}-suggestions`}>
              {suggestions.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
            <button type="submit" disabled={working || text.trim() === ""} className={secondary}>
              Add
            </button>
          </div>
          <p className={hint}>
            Up to {TAG_MAX_LENGTH} characters each, {TAGS_PER_ORDER} on an order. Capital letters do not matter: VIP and vip are one tag. Tags are for you: the customer never sees them, so do not write about a person.
          </p>
        </form>
      )}
      {message && (
        <p role="status" aria-live="polite" className={message.ok ? "" : "text-red-700 dark:text-red-400"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/**
 * *Archive* and *Unarchive* (wave 3, D173). Archiving is a visibility state: the order leaves the default list and the queues, keeps its number and every figure, and a return brings it
 * back. When the order still needs work the button is disabled and the reason is written beside it (`blocked`); the server checks again.
 */
export function ArchiveButton({
  archived: initial,
  blocked,
  archive,
  unarchive,
}: {
  archived: boolean;
  /** Why the order cannot be archived now (in words), or null. */
  blocked: string | null;
  archive: () => Promise<ArchiveActionState>;
  unarchive: () => Promise<ArchiveActionState>;
}) {
  const [archived, setArchived] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      setMessage(null);
      const answer = await (archived ? unarchive() : archive());
      if (answer.archived !== null) setArchived(answer.archived);
      if (answer.message) setMessage({ ok: answer.ok, text: answer.message });
    });
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={run} disabled={working || (!archived && blocked !== null)} className={archived ? secondary : primary} aria-describedby={blocked && !archived ? "archive-blocked" : undefined}>
        {working ? "Working …" : archived ? "Unarchive" : "Archive"}
      </button>
      {blocked && !archived && (
        <p id="archive-blocked" className={hint}>
          Cannot be archived yet: {blocked.charAt(0).toLowerCase()}
          {blocked.slice(1)}
        </p>
      )}
      {message && (
        <p role="status" aria-live="polite" className={`text-xs ${message.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
