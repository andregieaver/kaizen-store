"use client";

import { useId, useState, useTransition } from "react";

import type { ArchiveActionState, TagsActionState } from "@/app/admin/(gated)/[store]/orders/ops-actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { TAGS_PER_ORDER, TAG_MAX_LENGTH, type Tag } from "@/lib/order-tags";
import { Card } from "@/components/admin/ui";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

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
  const w = useAdminText("order").tags;

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
    <Card title={w.title} className="flex flex-col gap-3 text-sm" compact>
      {tags.length === 0 ? (
        <p className="text-muted">{w.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken py-0.5 pr-1 pl-3 text-xs">
              {tag.label}
              {canWrite && (
                <button type="button" disabled={working} onClick={() => apply({ remove: tag.label })} aria-label={fillWords(w.remove, { tag: tag.label })} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-card">
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
            {w.add} <span className="font-normal text-muted">{w.commas}</span>
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
              {w.addButton}
            </button>
          </div>
          <p className={hint}>
            {fillWords(w.hint, { max: TAG_MAX_LENGTH, perOrder: TAGS_PER_ORDER })}
          </p>
        </form>
      )}
      {message && (
        <p role="status" aria-live="polite" className={message.ok ? "" : "text-danger-text"}>
          {message.text}
        </p>
      )}
    </Card>
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
  const w = useAdminText("order").archive;
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
        {working ? w.working : archived ? w.unarchive : w.archive}
      </button>
      {blocked && !archived && (
        <p id="archive-blocked" className={hint}>
          {fillWords(w.blocked, { reason: `${blocked.charAt(0).toLowerCase()}${blocked.slice(1)}` })}
        </p>
      )}
      {message && (
        <p role="status" aria-live="polite" className={`text-xs ${message.ok ? "" : "text-danger-text "}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
