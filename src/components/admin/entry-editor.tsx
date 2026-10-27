"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { CARD_CLASS } from "@/components/admin/ui";
import { EntityFields } from "@/components/admin/entity-fields";
import {
  fieldFileUploader,
  type StartFieldFile,
} from "@/components/admin/field-file-upload";
import { uploadFieldPicture } from "@/components/admin/field-picture-upload";
import { fillWords } from "@/lib/admin-fill";
import {
  entrySlugOf,
  entryTitle,
  typeAsGroup,
  type ContentAction,
  type EntryContent,
  type EntrySeo,
  type EntryStatus,
} from "@/lib/content-types";
import {
  changesFrom,
  type FieldData,
  type FieldDef,
  type FieldLookups,
} from "@/lib/custom-fields";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/seo";

/** What the entry editor needs to know of its type. */
export type EditorType = {
  id: string;
  name: string;
  slug: string;
  fields: FieldDef[];
  titleField: string;
  hasPages: boolean;
};

const input =
  "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm";
const hint = "text-xs text-muted";
const card = `flex flex-col gap-4 p-5 ${CARD_CLASS}`;

/**
 * An entry of a content type (D326): its type's fields as one form (the custom fields' own, D118), written in one language at a time,
 * its address and search texts when its type has pages, and Save draft, Publish, Unpublish and Delete. Everything goes to bound server
 * actions that check it again; nothing reaches the site before Publish.
 */
export function EntryEditor({
  type,
  entry,
  locales,
  languageNames,
  lookups,
  storeSlug,
  uploads,
  startFile,
  save,
  publish,
  unpublish,
  remove,
  base,
}: {
  type: EditorType;
  /** The entry as kept; null for a new one. */
  entry: {
    id: string;
    slug: string;
    draft: EntryContent;
    status: EntryStatus;
  } | null;
  /** The site's languages, the main one first. */
  locales: string[];
  languageNames: Record<string, string>;
  lookups: FieldLookups;
  storeSlug: string;
  uploads: boolean;
  startFile: StartFieldFile;
  save: ContentAction<unknown>;
  publish: ContentAction<string>;
  unpublish: ContentAction<string>;
  remove: ContentAction<string>;
  /** The type's entries' address (`/admin/{store}/content/{type}`). */
  base: string;
}) {
  const all = useAdminText("content");
  const w = all.entry;
  const router = useRouter();
  const main = locales[0];
  const [data, setData] = useState<FieldData>(
    entry?.draft.data ?? { values: {}, translations: {} },
  );
  const [seo, setSeo] = useState<EntrySeo>(
    entry?.draft.seo ?? { title: "", description: "" },
  );
  const [seoTranslations, setSeoTranslations] = useState<
    Record<string, EntrySeo>
  >(entry?.draft.seoTranslations ?? {});
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [slugFollows, setSlugFollows] = useState(entry === null);
  const [locale, setLocale] = useState(main);
  const [dirty, setDirty] = useState(false);
  // A new entry once saved keeps its id here, so a Publish that is refused stays on screen with its problems and the next save changes it.
  const [savedId, setSavedId] = useState<string | null>(entry?.id ?? null);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const group = typeAsGroup(type);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touched = () => {
    setDirty(true);
    setNote("");
  };
  const title = entryTitle(type, data, main, main);
  const shownSlug = slugFollows ? entrySlugOf(title) : slug;
  const seoHere: EntrySeo =
    locale === main
      ? seo
      : (seoTranslations[locale] ?? { title: "", description: "" });
  const setSeoHere = (next: EntrySeo) => {
    touched();
    if (locale === main) setSeo(next);
    else setSeoTranslations((current) => ({ ...current, [locale]: next }));
  };

  const payload = () => ({
    id: savedId,
    typeId: type.id,
    slug: shownSlug,
    fields: changesFrom(type.fields, data, locales),
    seo,
    seoTranslations,
  });

  /** Saves the draft; with `then`, runs it on the saved entry (Publish saves first). */
  const run = (then?: ContentAction<string>, done?: string) =>
    start(async () => {
      setProblems([]);
      const saved = await save(payload());
      if (!saved.ok) return setProblems(saved.problems);
      const id = saved.id ?? savedId;
      if (id) setSavedId(id);
      setDirty(false);
      if (then && id) {
        const result = await then(id);
        if (!result.ok) return setProblems(result.problems);
      }
      setNote(done ?? w.saved);
      if (!entry && id) router.replace(`${base}/${id}`);
      else router.refresh();
    });

  const status = entry?.status ?? "draft";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
      className="flex max-w-4xl flex-col gap-6"
    >
      {problems.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-text"
        >
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {locales.length > 1 && (
        <label className={`${label} max-w-xs`}>
          {w.language}
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            className={input}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {languageNames[l] ?? l}
              </option>
            ))}
          </select>
        </label>
      )}

      <EntityFields
        groups={[group]}
        data={data}
        onChange={(next) => {
          setData(next);
          touched();
        }}
        locales={locales}
        main={main}
        locale={locale}
        languageNames={languageNames}
        upload={
          uploads ? (file: File) => uploadFieldPicture(storeSlug, file) : null
        }
        fileUpload={uploads ? fieldFileUploader(startFile) : null}
        lookups={lookups}
        title={w.fields}
        intro={w.fieldsIntro}
        idPrefix="entry-fields"
      />

      {type.hasPages ? (
        <section aria-labelledby="entry-page" className={card}>
          <h2 id="entry-page" className="text-title text-ink">
            {w.seo}
          </h2>
          {locale === main && (
            <div className={label}>
              <label htmlFor="entry-slug">{w.address}</label>
              <span className="flex items-center gap-1 font-mono text-sm text-muted">
                /{type.slug}/
                <input
                  id="entry-slug"
                  aria-describedby="entry-slug-hint"
                  value={shownSlug}
                  onChange={(event) => {
                    setSlugFollows(false);
                    setSlug(event.target.value);
                    touched();
                  }}
                  maxLength={120}
                  className={`${input} font-mono`}
                />
              </span>
              <span id="entry-slug-hint" className={hint}>
                {w.addressHint}
              </span>
            </div>
          )}
          <p className={hint}>{w.seoHint}</p>
          <label className={label}>
            {w.seoTitle}
            <input
              value={seoHere.title}
              onChange={(event) =>
                setSeoHere({ ...seoHere, title: event.target.value })
              }
              maxLength={TITLE_MAX}
              className={input}
            />
          </label>
          <label className={label}>
            {w.seoDescription}
            <textarea
              value={seoHere.description}
              onChange={(event) =>
                setSeoHere({ ...seoHere, description: event.target.value })
              }
              maxLength={DESCRIPTION_MAX}
              rows={3}
              className={`${input} py-2`}
            />
          </label>
        </section>
      ) : (
        <p className={hint}>{w.noPage}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-pill border border-edge bg-card px-5 disabled:opacity-50"
        >
          {busy ? w.saving : w.saveDraft}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(publish, w.published)}
          className="min-h-11 rounded-pill bg-brand px-5 text-brand-ink disabled:opacity-50"
        >
          {busy
            ? w.publishing
            : status === "draft"
              ? w.publish
              : w.publishChanges}
        </button>
        {entry && status !== "draft" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const result = await unpublish(entry.id);
                if (!result.ok) return setProblems(result.problems);
                setNote(w.unpublished);
                router.refresh();
              })
            }
            className="min-h-11 rounded-pill border border-edge px-5 disabled:opacity-50"
          >
            {w.unpublish}
          </button>
        )}
        <span role="status" className="text-sm text-muted">
          {note || (dirty ? w.unsaved : "")}
        </span>
      </div>

      {entry && (
        <div className="border-t border-line pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  fillWords(w.deleteAsk, {
                    title: title || all.entries.untitled,
                  }),
                )
              )
                return;
              start(async () => {
                setDirty(false);
                const result = await remove(entry.id);
                if (result && !result.ok) setProblems(result.problems);
              });
            }}
            className="min-h-10 rounded-pill px-4 text-sm text-danger-text hover:bg-danger-soft disabled:opacity-50"
          >
            {w.delete}
          </button>
        </div>
      )}
    </form>
  );
}
