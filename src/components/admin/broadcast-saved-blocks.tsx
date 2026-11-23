"use client";

import { useState, useTransition } from "react";

import type { BroadcastBlock } from "@/lib/broadcasts-schema";
import { SAVED_BLOCK_NAME_MAX, type SavedBlock } from "@/lib/broadcasts";

import { useAdminText } from "./admin-text";
import { Button } from "./ui";

type Problem = { ok: false; problem: string };
type Answer = Promise<Problem | { ok: true; saved: SavedBlock[] }>;

/** What the editor needs for saved blocks (email plan M4.1): the store's list and the two actions, the store bound by the caller. */
export type SavedBlocksProps = {
  list: SavedBlock[];
  act: (storeSlug: string, change: { op: "save"; name: string; block: unknown } | { op: "delete"; id: string }) => Answer;
};

/**
 * *Save for later* on one block: a press opens a name field (filled with the block's kind), a second saves it to the store's saved blocks.
 * Says the server's refusal in place.
 */
export function KeepBlock({ block, kind, storeSlug, act, onSaved }: { block: BroadcastBlock; kind: string; storeSlug: string; act: SavedBlocksProps["act"]; onSaved: (list: SavedBlock[]) => void }) {
  const we = useAdminText("marketing").email;
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (name === null)
    return (
      <Button size="dense" kind="quiet" onClick={() => setName(kind)}>
        {we.keepBlock}
      </Button>
    );
  const keep = () =>
    start(async () => {
      const result = await act(storeSlug, { op: "save", name, block });
      if (!result.ok) return setProblem(result.problem);
      setProblem(null);
      setName(null);
      onSaved(result.saved);
    });
  return (
    <span className="flex w-full flex-wrap items-center gap-2" data-keep-block>
      <input
        aria-label={we.keepBlockName}
        value={name}
        maxLength={SAVED_BLOCK_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        className="min-h-9 flex-1 rounded-md border border-line bg-card px-3"
      />
      <Button size="dense" disabled={busy} onClick={keep}>
        {we.keepBlockDo}
      </Button>
      {problem && (
        <span role="alert" className="w-full text-caption text-danger-text">
          {problem}
        </span>
      )}
    </span>
  );
}

/** The store's saved blocks beside *Add*: a press adds a copy to the email; the small cross deletes the saved one. */
export function SavedBlockList({ list, storeSlug, act, onAdd, onChange }: { list: SavedBlock[]; storeSlug: string; act: SavedBlocksProps["act"]; onAdd: (block: BroadcastBlock) => void; onChange: (list: SavedBlock[]) => void }) {
  const we = useAdminText("marketing").email;
  const [busy, start] = useTransition();
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-saved-blocks>
      <span className="text-body text-ink-2">{we.keptBlocks}</span>
      {list.map((s) => (
        <span key={s.id} className="inline-flex items-center">
          <Button size="dense" onClick={() => onAdd(structuredClone(s.block))}>
            {s.name}
          </Button>
          <Button
            size="dense"
            kind="quiet"
            disabled={busy}
            aria-label={we.keptBlockDelete.replace("{name}", s.name)}
            onClick={() =>
              start(async () => {
                const result = await act(storeSlug, { op: "delete", id: s.id });
                if (result.ok) onChange(result.saved);
              })
            }
          >
            ×
          </Button>
        </span>
      ))}
    </div>
  );
}
