"use client";

import { useState } from "react";

import { FieldsForm, type FieldFileUploader, type PictureUpload } from "@/components/admin/fields-form";
import {
  groupApplies,
  hasTranslations,
  type Facts,
  type FieldData,
  type FieldGroup,
  type FieldLookups,
} from "@/lib/custom-fields";

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
  fileUpload,
  lookups,
  side = false,
  locale: chosen,
  title = "Custom fields",
  intro = "Extra information about it, from the field groups you made under Custom fields.",
  idPrefix = "fields-heading",
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
  /** Uploads a file for a file field; null where uploads are not set up. */
  fileUpload: FieldFileUploader | null;
  /** The store's products, pages, categories and tags, for the fields that point at them. */
  lookups: FieldLookups;
  /** Only the groups meant for the side column, or those meant for the main one. */
  side?: boolean;
  /** The language being written when the editor has its own switch (a page's); else this panel has one. */
  locale?: string;
  /** The panel's heading and words, and a prefix for its ids when several are on one page (a variant's). */
  title?: string;
  intro?: string;
  idPrefix?: string;
}) {
  const [own, setLocale] = useState(main);
  const locale = chosen ?? own;
  const shown = groups.filter((group) => (group.position === "side") === side);
  if (shown.length === 0) return null;
  const texts = shown.some((group) => group.fields.some(hasTranslations));
  const name = (l: string) => languageNames[l] ?? l;

  return (
    <section aria-labelledby={`${idPrefix}-${side ? "side" : "main"}`} className={card}>
      <h2 id={`${idPrefix}-${side ? "side" : "main"}`} className="mb-1 font-medium">
        {title}
      </h2>
      <p className="mb-4 text-sm text-muted">{intro}</p>
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
        fileUpload={fileUpload}
        lookups={lookups}
        languageName={name}
      />
    </section>
  );
}
