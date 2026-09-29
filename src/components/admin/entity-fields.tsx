"use client";

import { useState } from "react";

import { FieldsForm, type PictureUpload } from "@/components/admin/fields-form";
import { groupApplies, isTranslatable, type Facts, type FieldData, type FieldGroup } from "@/lib/custom-fields";

const card = "rounded-lg border border-border bg-background p-5";

/** The groups of a store's custom fields (D118) that apply to what is being edited, as it is now (unsaved changes count). */
export const applicableGroups = (groups: FieldGroup[], facts: Facts): FieldGroup[] =>
  groups.filter((group) => groupApplies(group, facts));

/**
 * The custom fields of a product, page or article in its editor: the groups
 * whose rules match what is being edited (they follow its kind, categories and
 * tags as they change), one language at a time for the texts. Draws nothing
 * when no group applies. Values are held by the editor, which sends them with
 * the rest when saving.
 */
export function EntityFields({
  groups,
  data,
  onChange,
  locales,
  main,
  languageNames,
  upload,
  side = false,
  locale: chosen,
}: {
  /** The groups that apply (see `applicableGroups`). */
  groups: FieldGroup[];
  data: FieldData;
  onChange: (next: FieldData) => void;
  /** The store's languages, main first. */
  locales: string[];
  main: string;
  languageNames: Record<string, string>;
  upload: PictureUpload | null;
  /** Only the groups meant for the side column, or those meant for the main one. */
  side?: boolean;
  /** The language being written when the editor has its own switch (a page's); else this panel has one. */
  locale?: string;
}) {
  const [own, setLocale] = useState(main);
  const locale = chosen ?? own;
  const shown = groups.filter((group) => (group.position === "side") === side);
  if (shown.length === 0) return null;
  const texts = shown.some((group) => group.fields.some((field) => isTranslatable(field.type)));
  const name = (l: string) => languageNames[l] ?? l;

  return (
    <section aria-labelledby={`fields-heading-${side ? "side" : "main"}`} className={card}>
      <h2 id={`fields-heading-${side ? "side" : "main"}`} className="mb-1 font-medium">
        Custom fields
      </h2>
      <p className="mb-4 text-sm text-muted">
        Extra information about it, from the field groups you made under Custom fields.
      </p>
      {texts && locales.length > 1 && chosen === undefined && (
        <div role="tablist" aria-label="Language of the texts" className="mb-4 flex flex-wrap gap-2">
          {locales.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === locale}
              onClick={() => setLocale(l)}
              className="min-h-9 rounded-md border border-border px-3 text-sm aria-selected:border-foreground aria-selected:bg-foreground aria-selected:text-background"
            >
              {name(l)}
            </button>
          ))}
        </div>
      )}
      <FieldsForm
        groups={shown}
        data={data}
        onChange={onChange}
        locale={locale}
        main={main}
        upload={upload}
        languageName={name}
      />
    </section>
  );
}
