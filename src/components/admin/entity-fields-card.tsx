"use client";

import { useState, useTransition } from "react";

import { EntityFields } from "@/components/admin/entity-fields";
import { fieldFileUploader, type StartFieldFile } from "@/components/admin/field-file-upload";
import { uploadFieldPicture } from "@/components/admin/field-picture-upload";
import { changesFrom, type FieldData, type FieldGroup, type FieldLookups } from "@/lib/custom-fields";

/** What a self-contained editor of custom fields needs from the page that holds it (D120). */
export type EntityFieldsSetup = {
  storeSlug: string;
  locales: string[];
  languageNames: Record<string, string>;
  uploads: boolean;
  startFile: StartFieldFile;
};

/**
 * The custom fields of the store itself, a customer or an order (D120) as a
 * card with its own Save: the groups already chosen by the page, the values as
 * they are, saved through a bound server action that checks everything again.
 * Draws nothing when no group applies.
 */
export function EntityFieldsCard({
  groups,
  data: initial,
  lookups,
  setup,
  save,
  title = "Custom fields",
  intro,
  idPrefix,
}: {
  groups: FieldGroup[];
  data: FieldData;
  lookups: FieldLookups;
  setup: EntityFieldsSetup;
  save: (changes: unknown) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  title?: string;
  intro: string;
  idPrefix: string;
}) {
  const [data, setData] = useState<FieldData>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  if (groups.length === 0) return null;

  const submit = () => {
    setSaved(false);
    start(async () => {
      const result = await save(
        changesFrom(
          groups.flatMap((group) => group.fields),
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
    <div className="flex flex-col gap-3">
      <EntityFields
        groups={groups.map((group) => ({ ...group, position: "main" as const }))}
        data={data}
        onChange={(next) => {
          setData(next);
          setSaved(false);
        }}
        locales={setup.locales}
        main={setup.locales[0]}
        languageNames={setup.languageNames}
        upload={setup.uploads ? (file: File) => uploadFieldPicture(setup.storeSlug, file) : null}
        fileUpload={setup.uploads ? fieldFileUploader(setup.startFile) : null}
        lookups={lookups}
        title={title}
        intro={intro}
        idPrefix={idPrefix}
      />
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problems.join(" ")}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? "Saving …" : "Save fields"}
        </button>
        {saved && (
          <span role="status" className="text-sm">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
