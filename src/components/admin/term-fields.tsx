"use client";

import { useState, useTransition } from "react";

import { EntityFields } from "@/components/admin/entity-fields";
import { fieldFileUploader } from "@/components/admin/field-file-upload";
import { uploadFieldPicture } from "@/components/admin/field-picture-upload";
import { Modal } from "@/components/admin/modal";
import { changesFrom, type FieldData, type FieldGroup, type FieldLookups } from "@/lib/custom-fields";

/** What a category's or tag's fields need from the page that lists them (D118, phase 2). */
export type TermFieldsSetup = {
  storeSlug: string;
  locales: string[];
  languageNames: Record<string, string>;
  uploads: boolean;
  open: (termId: string) => Promise<{ groups: FieldGroup[]; data: FieldData; lookups: FieldLookups } | null>;
  save: (termId: string, changes: unknown) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  startFile: Parameters<typeof fieldFileUploader>[0];
};

const button = "min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50";

/**
 * The button and dialog for the custom fields of one category or tag: the
 * fields are read when it opens (only the groups that apply to it), and saved
 * on their own, apart from renaming or moving it.
 */
export function TermFieldsButton({
  term,
  setup,
}: {
  term: { id: string; name: string; kind: string };
  setup: TermFieldsSetup;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ groups: FieldGroup[]; data: FieldData; lookups: FieldLookups } | null>(null);
  const [data, setData] = useState<FieldData | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const main = setup.locales[0];

  const show = () => {
    setOpen(true);
    setProblems([]);
    setSaved(false);
    start(async () => {
      const editor = await setup.open(term.id);
      if (!editor) return setProblems(["The fields could not be read."]);
      setLoaded(editor);
      setData(editor.data);
    });
  };

  const save = () => {
    if (!loaded || !data) return;
    setSaved(false);
    start(async () => {
      const result = await setup.save(
        term.id,
        changesFrom(
          loaded.groups.flatMap((g) => g.fields),
          data,
          setup.locales,
        ),
      );
      if (!result.ok) return setProblems(result.problems);
      setProblems([]);
      setSaved(true);
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={button} aria-label={`Custom fields of ${term.kind} ${term.name}`}>
        Fields
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Custom fields: ${term.name}`}
        wide
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !loaded || loaded.groups.length === 0}
              className={`${button} bg-foreground font-medium text-background`}
            >
              {busy ? "Saving …" : "Save fields"}
            </button>
            {saved && (
              <span role="status" className="text-sm">
                Saved.
              </span>
            )}
          </div>
        }
      >
        {problems.length > 0 && (
          <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-400">
            {problems.join(" ")}
          </p>
        )}
        {loaded && loaded.groups.length === 0 && (
          <p className="text-sm text-muted">
            No group of custom fields applies to this {term.kind}. Make one under Custom fields.
          </p>
        )}
        {loaded && data && loaded.groups.length > 0 && (
          <EntityFields
            groups={loaded.groups.map((group) => ({ ...group, position: "main" as const }))}
            data={data}
            onChange={(next) => {
              setData(next);
              setSaved(false);
            }}
            locales={setup.locales}
            main={main}
            languageNames={setup.languageNames}
            upload={setup.uploads ? (file: File) => uploadFieldPicture(setup.storeSlug, file) : null}
            fileUpload={setup.uploads ? fieldFileUploader(setup.startFile) : null}
            lookups={loaded.lookups}
            title="Custom fields"
            intro={`Shown on the ${term.kind}'s page when a field is public.`}
            idPrefix={`term-fields-${term.id}`}
          />
        )}
        {!loaded && problems.length === 0 && <p className="text-sm text-muted">Reading the fields …</p>}
      </Modal>
    </>
  );
}
