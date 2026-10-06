"use client";

import { useId, useState, useTransition } from "react";

import type { ViewActionResponse } from "@/app/admin/(gated)/[store]/orders/list-actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { VIEWS_MAX, VIEW_TITLE_MAX } from "@/lib/order-limits";

export type ViewTool = { id: string; title: string };

export type ViewToolActions = {
  save: (request: { title: string; query: string; replaceId?: string | null }) => Promise<ViewActionResponse>;
  update: (viewId: string, request: { title?: string; query?: string }) => Promise<ViewActionResponse>;
  remove: (viewId: string) => Promise<ViewActionResponse>;
  reorder: (ids: string[]) => Promise<ViewActionResponse>;
};

/**
 * *Save as view* and the management of saved views (wave 3, D173, `docs/wave-3-orders.md` 2.2.4). A view is the list's current state (the search, the filters, the sort and the columns) under a
 * name, shared by everyone who can read orders. The state is sent as the list's query and read again by the server's one parser. Staff who may only read see neither. A search is kept in a
 * view if there is one: the screen says not to save a search for a person's name.
 */
export function ViewTools({ views, query, actions }: { views: ViewTool[]; query: string; actions: ViewToolActions }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, startTransition] = useTransition();
  const full = views.length >= VIEWS_MAX;

  const done = (answer: ViewActionResponse) => setMessage({ ok: answer.ok, text: answer.message });

  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Save this list as a view</summary>
        <form
          className="flex flex-col gap-3 border-t border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            startTransition(async () => {
              const answer = await actions.save({ title, query, replaceId: replaceId || null });
              done(answer);
              if (answer.ok) {
                setTitle("");
                setReplaceId("");
              }
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-title`} className="text-sm font-medium">
                Name of the view <span className="font-normal text-muted">(up to {VIEW_TITLE_MAX} characters)</span>
              </label>
              <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={VIEW_TITLE_MAX} required={replaceId === ""} className={`${field} w-64`} />
            </div>
            {views.length > 0 && (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-replace`} className="text-sm font-medium">
                  Or replace a view
                </label>
                <select id={`${id}-replace`} value={replaceId} onChange={(e) => setReplaceId(e.target.value)} className={field}>
                  <option value="">Save as a new view</option>
                  {views.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" disabled={working || (full && replaceId === "")} className={primary}>
              {working ? "Saving …" : replaceId ? "Update view" : "Save view"}
            </button>
          </div>
          <p className={hint}>
            {full && replaceId === ""
              ? `A store has at most ${VIEWS_MAX} saved views. Replace or delete one.`
              : "The view keeps the search, the filters, the sort and the columns as they are now. Everyone who can read orders can open it. Do not save a search for a person’s name: a view is shared."}
          </p>
        </form>
      </details>

      {views.length > 0 && (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Manage saved views</summary>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {views.map((view, index) => (
              <ManageRow
                key={view.id}
                view={view}
                first={index === 0}
                last={index === views.length - 1}
                working={working}
                onRename={(next) => {
                  setMessage(null);
                  startTransition(async () => done(await actions.update(view.id, { title: next })));
                }}
                onUseCurrent={() => {
                  setMessage(null);
                  startTransition(async () => done(await actions.update(view.id, { query })));
                }}
                onDelete={() => {
                  setMessage(null);
                  startTransition(async () => done(await actions.remove(view.id)));
                }}
                onMove={(by) => {
                  const ids = views.map((v) => v.id);
                  const at = ids.indexOf(view.id);
                  const to = at + by;
                  if (to < 0 || to >= ids.length) return;
                  [ids[at], ids[to]] = [ids[to], ids[at]];
                  setMessage(null);
                  startTransition(async () => done(await actions.reorder(ids)));
                }}
              />
            ))}
          </ul>
        </details>
      )}

      {message && (
        <p role="status" aria-live="polite" className={`text-sm ${message.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function ManageRow({
  view,
  first,
  last,
  working,
  onRename,
  onUseCurrent,
  onDelete,
  onMove,
}: {
  view: ViewTool;
  first: boolean;
  last: boolean;
  working: boolean;
  onRename: (title: string) => void;
  onUseCurrent: () => void;
  onDelete: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const id = useId();
  const [name, setName] = useState(view.title);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-end gap-2 p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          Name
        </label>
        <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={VIEW_TITLE_MAX} className={`${field} w-56`} />
      </div>
      <button type="button" disabled={working || name.trim() === "" || name === view.title} onClick={() => onRename(name)} className={secondary}>
        Rename
      </button>
      <button type="button" disabled={working} onClick={onUseCurrent} className={secondary}>
        Use the current list
      </button>
      <button type="button" disabled={working || first} onClick={() => onMove(-1)} className={secondary} aria-label={`Move ${view.title} earlier`}>
        Earlier
      </button>
      <button type="button" disabled={working || last} onClick={() => onMove(1)} className={secondary} aria-label={`Move ${view.title} later`}>
        Later
      </button>
      {confirm ? (
        <span className="flex items-center gap-2 text-sm">
          Delete “{view.title}”?
          <button type="button" disabled={working} onClick={onDelete} className={primary}>
            Delete
          </button>
          <button type="button" onClick={() => setConfirm(false)} className={secondary}>
            Keep
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className={secondary}>
          Delete
        </button>
      )}
    </li>
  );
}
