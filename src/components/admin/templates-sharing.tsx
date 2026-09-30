"use client";

import { useId, useState, useTransition } from "react";

import type { SavedPart } from "@/lib/saved-parts";
import { PART_SHARING, SHARING_LABELS, type PartSharing, type TemplateActions } from "@/lib/templates";

import { Problems } from "./templates-parts";

/** What a shared copy leaves behind, said next to every choice of who can use a part (D125). */
export const SHARING_NOTE =
  "Shared copies keep text and pictures, but not links to this store's pages, products, menus or forms.";

/** Who can use a part being saved, chosen in the dialog that saves it (D125): only this store, its owner's stores or everyone. */
export function SharingChoice({ value, onChange }: { value: PartSharing; onChange: (sharing: PartSharing) => void }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Share</legend>
      {PART_SHARING.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm has-checked:border-foreground has-checked:bg-surface has-focus-visible:outline-2"
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="mt-1 size-4 shrink-0 accent-foreground"
          />
          <span className="flex flex-col">
            <span className="font-medium">{SHARING_LABELS[option].label}</span>
            <span className="text-xs text-muted">{SHARING_LABELS[option].hint}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-muted">{SHARING_NOTE}</p>
    </fieldset>
  );
}

/** A small mark on a saved part that others can use; nothing for one that is private. */
export function SharingBadge({ sharing }: { sharing: PartSharing }) {
  if (sharing === "private") return null;
  return (
    <span className="rounded-full border border-border px-1.5 py-px text-[11px] leading-4 text-muted">
      {SHARING_LABELS[sharing].label}
    </span>
  );
}

/**
 * Changes who can use one of the store's saved parts, from the Saved tab. The list follows once the server has agreed;
 * until then the choice shows what it was.
 */
export function SharingSelect({
  part,
  setSharing,
  onChanged,
}: {
  part: SavedPart;
  setSharing: TemplateActions["setSharing"];
  onChanged: (id: string, sharing: PartSharing) => void;
}) {
  const id = useId();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const change = (sharing: PartSharing) =>
    start(async () => {
      setProblems([]);
      try {
        const result = await setSharing(part.id, sharing);
        if (result.ok) onChanged(part.id, sharing);
        else setProblems(result.problems);
      } catch {
        setProblems(["It could not be changed. Try again."]);
      }
    });
  return (
    <div className="flex flex-col gap-1 px-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs text-muted">
          Shared with
        </label>
        <select
          id={id}
          value={part.sharing}
          disabled={busy}
          aria-label={`Sharing of ${part.name}`}
          onChange={(event) => change(event.target.value as PartSharing)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
        >
          {PART_SHARING.map((option) => (
            <option key={option} value={option}>
              {SHARING_LABELS[option].label}
            </option>
          ))}
        </select>
      </div>
      <Problems problems={problems} />
    </div>
  );
}
