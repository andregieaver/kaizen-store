"use client";

import { useEffect, useId, useState } from "react";

import type { DualChoice, DualKind, DualWith } from "@/lib/dual-page";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * *Open beside* (D412): a document of the site to open next to the one being edited, of any kind the builder edits, or a new one. The
 * list is asked for when the kind is chosen; the document being edited is not offered.
 */
export function DualOpenDialog({
  open,
  onClose,
  kinds,
  choices,
  current,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  kinds: readonly DualKind[];
  choices: (kind: DualKind) => Promise<DualChoice[]>;
  /** The document being edited (and, in a dual page, the other one), never offered. */
  current: readonly (string | null)[];
  onOpen: (doc: DualWith) => void;
}) {
  const dw = useAdminText("builder").dual;
  const [kind, setKind] = useState<DualKind>(kinds[0] ?? "page");
  const [list, setList] = useState<{ kind: DualKind; items: DualChoice[] } | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    choices(kind)
      .then((items) => {
        if (live) setList({ kind, items });
      })
      .catch(() => {
        if (live) setList({ kind, items: [] });
      });
    return () => {
      live = false;
    };
  }, [open, kind, choices]);
  const loaded = list?.kind === kind ? list.items : null;
  const words = query.trim().toLowerCase();
  const shown = (loaded ?? []).filter((item) => !current.includes(item.id) && (!words || item.title.toLowerCase().includes(words)));
  return (
    <Modal open={open} onClose={onClose} title={dw.openTitle}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {dw.kind}
            <select value={kind} onChange={(event) => setKind(event.target.value as DualKind)} className={field} data-dual-kind="">
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {dw.kinds[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {dw.search}
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className={field} />
          </label>
        </div>
        <ul aria-label={dw.kinds[kind]} className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-dual-choices="">
          {kind !== "entry_layout" && (
            <li>
              <button
                type="button"
                onClick={() => onOpen({ kind, id: null })}
                className="flex min-h-11 w-full items-center rounded-md border border-dashed border-edge px-3 text-left text-sm font-medium hover:bg-sunken"
              >
                {fillWords(dw.newOne, { kind: dw.kinds[kind].toLowerCase() })}
              </button>
            </li>
          )}
          {loaded === null ? (
            <li className="px-3 py-2 text-sm text-muted">{dw.loading}</li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{dw.noneYet}</li>
          ) : (
            shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen({ kind, id: item.id })}
                  className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-sunken"
                >
                  {item.title || dw.untitled}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </Modal>
  );
}

/** *Create new* (D412): which kind of document, then side by side with this one or on its own. */
export function DualCreateDialog({
  open,
  onClose,
  kinds,
  onSideBySide,
  onItsOwn,
}: {
  open: boolean;
  onClose: () => void;
  kinds: readonly DualKind[];
  onSideBySide: (kind: DualKind) => void;
  onItsOwn: (kind: DualKind) => void;
}) {
  const dw = useAdminText("builder").dual;
  const name = useId();
  const [kind, setKind] = useState<DualKind>(kinds[0] ?? "page");
  return (
    <Modal open={open} onClose={onClose} title={dw.createTitle}>
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{dw.createKind}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {kinds.map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm has-checked:border-brand has-checked:bg-sunken">
                <input type="radio" name={name} value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4" />
                {dw.kinds[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onSideBySide(kind)}
            className="flex flex-col items-start gap-1 rounded-panel bg-brand p-4 text-left text-brand-ink"
            data-dual-side-by-side=""
          >
            <span className="font-medium">{dw.sideBySide}</span>
            <span className="text-xs opacity-90">{dw.sideBySideHint}</span>
          </button>
          <button
            type="button"
            onClick={() => onItsOwn(kind)}
            className="flex flex-col items-start gap-1 rounded-panel border border-edge p-4 text-left hover:bg-sunken"
            data-dual-on-its-own=""
          >
            <span className="font-medium">{dw.onItsOwn}</span>
            <span className="text-xs text-muted">{dw.onItsOwnHint}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
