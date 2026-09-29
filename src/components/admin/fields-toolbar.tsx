"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { FIELD_ENTITIES, FIELD_PRESETS } from "@/lib/custom-fields";

import { Modal } from "./modal";

type Result = { ok: true; id?: string; ids?: string[] } | { ok: false; problems: string[] };

const button =
  "flex min-h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-surface disabled:opacity-50";
/** The biggest file of groups read; a store has at most 50 groups of at most 60 fields. */
const IMPORT_MAX_BYTES = 2_000_000;

/**
 * The buttons over the list of groups (D118): a new group, one made from a
 * preset, one read from a file exported earlier, and the export of them all.
 */
export function FieldsToolbar({
  base,
  createFromPreset,
  importGroups,
  hasGroups,
}: {
  /** `/admin/{store}/fields` */
  base: string;
  createFromPreset: (key: string) => Promise<Result>;
  importGroups: (raw: unknown) => Promise<Result>;
  hasGroups: boolean;
}) {
  const router = useRouter();
  const [presets, setPresets] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const startFromPreset = (key: string) =>
    start(async () => {
      setProblems([]);
      const result = await createFromPreset(key);
      if (result.ok && result.id) router.push(`${base}/${result.id}`);
      else if (!result.ok) setProblems(result.problems);
    });

  const readFile = (chosen: File | undefined) => {
    if (!chosen) return;
    setProblems([]);
    setNotice("");
    if (chosen.size > IMPORT_MAX_BYTES) {
      setProblems(["That file is too big to be a set of field groups."]);
      return;
    }
    start(async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(await chosen.text());
      } catch {
        setProblems(["That file is not readable. Choose a file exported from Custom fields."]);
        return;
      }
      const result = await importGroups(raw);
      if (result.ok) {
        setNotice(
          `Imported ${result.ids?.length ?? 0} ${result.ids?.length === 1 ? "group" : "groups"}. Rules about categories and tags are left out: they are the other store's own. Add them again where they apply.`,
        );
        router.refresh();
      } else setProblems(result.problems);
      if (file.current) file.current.value = "";
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`${base}/new`}
          className="flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          New group
        </Link>
        <button type="button" onClick={() => setPresets(true)} className={button}>
          Start from a preset
        </button>
        <label className={`${button} cursor-pointer has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2`}>
          {pending ? "Working …" : "Import"}
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            disabled={pending}
            onChange={(event) => readFile(event.target.files?.[0])}
            className="sr-only"
          />
        </label>
        {hasGroups && (
          <a href={`${base}/export`} download className={button}>
            Export all
          </a>
        )}
      </div>
      {problems.length > 0 && !presets && (
        <div role="alert" className="rounded-lg border border-red-700 p-3 text-sm">
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <Modal open={presets} onClose={() => setPresets(false)} title="Start from a preset" wide>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            A preset makes a group with fields to change as you like. It is saved at once (private, like every new
            field) and opened for you. Legal texts such as the safety information, the right of withdrawal and the terms
            have their own places: do not keep them in custom fields.
          </p>
          {problems.length > 0 && (
            <p role="alert" className="text-sm text-red-700">
              {problems.join(" ")}
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {FIELD_PRESETS.map((preset) => (
              <li key={preset.key} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{preset.name}</p>
                  <p className="text-xs text-muted">{preset.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    For {FIELD_ENTITIES[preset.entity].toLowerCase()}: {preset.fields.map((f) => f.label).join(", ")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startFromPreset(preset.key)}
                  className="min-h-10 self-start rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-50"
                >
                  Use {preset.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
