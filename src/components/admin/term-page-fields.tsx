"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { ImageUploadButton, type Upload } from "@/components/admin/image-upload";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { fillWords } from "@/lib/admin-fill";
import { EMPTY_DOC, richTextIsEmpty, type RichTextDoc } from "@/lib/page-content";
import { TERM_NAME_MAX } from "@/lib/taxonomy";
import type { TermTexts } from "@/lib/term-texts";
import type { TermOrderActions, TermProduct } from "@/server/taxonomy";

/**
 * A store's product category's or tag's own page in the admin (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.1, 3.2): its picture, its
 * description, its name and description in the store's other languages, and the owner's order of its products. Plain data and server actions
 * come from the categories page.
 */
export type TermPageSetup = {
  /** The store's languages, main first. */
  locales: string[];
  languageNames: Record<string, string>;
  /** Uploads a picture into the store's media library. */
  upload: Upload;
} & TermOrderActions;

/** A term's page as its editor holds it. */
export type TermPageDraft = { description: RichTextDoc | null; image: { url: string; thumbnailUrl: string | null } | null; texts: TermTexts };

const button = "min-h-10 rounded-pill border border-edge px-3 text-sm disabled:opacity-50";
const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/** The picture, and the name and description per language: the main language's description here, its name in the row's own field above. */
export function TermPageFields({ setup, value, onChange }: { setup: TermPageSetup; value: TermPageDraft; onChange: (value: TermPageDraft) => void }) {
  const w = useAdminText("products").termPage;
  const main = setup.locales[0] ?? "";
  const [locale, setLocale] = useState(main);
  const own = locale === main ? null : (value.texts[locale] ?? {});
  const setOwn = (next: { name?: string; description?: RichTextDoc }) => onChange({ ...value, texts: { ...value.texts, [locale]: { ...own, ...next } } });
  const filled = (l: string) => (l === main ? value.description !== null : Boolean(value.texts[l]?.name || value.texts[l]?.description));
  const description = locale === main ? value.description : (own?.description ?? null);
  const setDescription = (doc: RichTextDoc) => {
    const next = richTextIsEmpty(doc) ? null : doc;
    if (locale === main) onChange({ ...value, description: next });
    else setOwn({ description: next ?? undefined });
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line bg-sunken p-3">
      <legend className="px-1 text-xs font-medium">{w.legend}</legend>
      <div className="flex flex-wrap items-center gap-3">
        {value.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.image.thumbnailUrl ?? value.image.url} alt="" className="h-20 w-32 rounded-panel object-cover" />
        ) : (
          <span className="text-xs text-muted">{w.noPicture}</span>
        )}
        <ImageUploadButton upload={setup.upload} label={value.image ? w.replacePicture : w.addPicture} onUploaded={(image) => onChange({ ...value, image: { url: image.url, thumbnailUrl: null } })} />
        {value.image && (
          <button type="button" onClick={() => onChange({ ...value, image: null })} className={button}>
            {w.removePicture}
          </button>
        )}
      </div>
      {setup.locales.length > 1 && (
        <div role="group" aria-label={w.language} className="flex flex-wrap gap-1">
          {setup.locales.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === locale}
              onClick={() => setLocale(l)}
              className="min-h-9 rounded-pill border border-line px-3 text-sm aria-pressed:border-ink aria-pressed:bg-card aria-pressed:font-medium"
            >
              {setup.languageNames[l] ?? l}
              {filled(l) ? <span aria-hidden="true"> ·</span> : null}
              {filled(l) ? <span className="sr-only">{w.hasText}</span> : null}
            </button>
          ))}
        </div>
      )}
      {own && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          {fillWords(w.nameIn, { language: setup.languageNames[locale] ?? locale })}
          <input
            value={own.name ?? ""}
            maxLength={TERM_NAME_MAX}
            placeholder={w.nameFallback}
            onChange={(event) => setOwn({ name: event.target.value })}
            className={input}
          />
        </label>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium">{fillWords(w.descriptionIn, { language: setup.languageNames[locale] ?? locale })}</span>
        <RichTextEditor key={locale} value={description ?? EMPTY_DOC} onChange={setDescription} label={w.description} />
        <span className="text-xs text-muted">{locale === main ? w.descriptionHint : w.otherHint}</span>
      </div>
    </fieldset>
  );
}

/** The owner's order of a term's own products (3.2): a list with buttons to move each, saved in one press. Products added later come last. */
export function TermProductOrder({ termId, setup }: { termId: string; setup: TermPageSetup }) {
  const w = useAdminText("products").termPage;
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<TermProduct[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const load = () =>
    start(async () => {
      setProducts(await setup.products(termId));
      setOpen(true);
    });
  const move = (from: number, to: number) => {
    if (!products || to < 0 || to >= products.length) return;
    const next = [...products];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setProducts(next);
    setSaved(false);
  };
  if (!open) {
    return (
      <button type="button" onClick={load} disabled={busy} className={button}>
        {w.order}
      </button>
    );
  }
  return (
    <section aria-label={w.orderTitle} className="flex w-full flex-col gap-2 rounded-md border border-line bg-sunken p-3">
      <p className="text-xs text-muted">{w.orderHint}</p>
      {!products || products.length === 0 ? (
        <p className="text-sm text-muted">{w.orderEmpty}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {products.map((product, index) => (
            <li key={product.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-6 text-right text-xs text-muted">{index + 1}</span>
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt="" className="size-8 rounded object-cover" />
              ) : (
                <span className="size-8 rounded bg-card" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {product.title}
                {product.status !== "active" && <span className="text-xs text-muted"> · {w.notLive}</span>}
              </span>
              <button type="button" onClick={() => move(index, 0)} disabled={index === 0} className={button} aria-label={fillWords(w.toTop, { name: product.title })}>
                ⤒
              </button>
              <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} className={button} aria-label={fillWords(w.up, { name: product.title })}>
                ↑
              </button>
              <button type="button" onClick={() => move(index, index + 1)} disabled={index === products.length - 1} className={button} aria-label={fillWords(w.down, { name: product.title })}>
                ↓
              </button>
              <button
                type="button"
                onClick={() => move(index, products.length - 1)}
                disabled={index === products.length - 1}
                className={button}
                aria-label={fillWords(w.toBottom, { name: product.title })}
              >
                ⤓
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {products && products.length > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const result = await setup.saveOrder(termId, products.map((p) => p.id));
                if (!result.ok) return setProblems(result.problems);
                setProblems([]);
                setSaved(true);
              })
            }
            className={`${button} bg-brand font-medium text-brand-ink`}
          >
            {w.saveOrder}
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className={button}>
          {w.close}
        </button>
        {saved && (
          <span role="status" className="text-sm">
            {w.orderSaved}
          </span>
        )}
      </div>
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-danger-text">
          {problems.join(" ")}
        </p>
      )}
    </section>
  );
}
