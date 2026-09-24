"use client";

import { useId, useState, useTransition } from "react";

import { shrinkImage } from "@/lib/image-resize";
import {
  LABEL_MAX,
  MENU_LIMITS,
  type LinkKind,
  type Logo,
  type MenuItem,
  type MenuLink,
  type MenuName,
  type StoreNavigation,
} from "@/lib/navigation";

type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;
type Save = (input: StoreNavigation) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
type Language = { locale: string; name: string; defaults: { home: string; account: string; cart: string } };
type Product = { handle: string; title: string; status: string };

/** Items carry a key while edited, so React keeps each row's inputs as rows move. */
type Row = MenuItem & { key: string };

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const small = "min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-40";

const KIND_LABELS: Record<LinkKind, string> = {
  home: "Front page (all products)",
  product: "A product",
  account: "My account",
  cart: "Cart",
  url: "Web address",
};

let counter = 0;
const keyed = (item: MenuItem): Row => ({ ...item, key: `row-${++counter}` });

/**
 * The storefront's logo and its two menus (D30). Changes stay in the page
 * until saved; every storefront page shows them straight after.
 */
export function NavigationEditor({
  initial,
  languages,
  products,
  upload,
  save,
  previewHref,
}: {
  initial: StoreNavigation;
  languages: Language[];
  products: Product[];
  upload: Upload | null;
  save: Save;
  previewHref: string;
}) {
  const [logo, setLogo] = useState<Logo | null>(initial.logo);
  const [menus, setMenus] = useState<Record<MenuName, Row[]>>({
    header: initial.header.map(keyed),
    footer: initial.footer.map(keyed),
  });
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; problems: string[] } | null>(null);
  const [saving, startSaving] = useTransition();

  const change = (menu: MenuName, rows: Row[]) => {
    setMenus((all) => ({ ...all, [menu]: rows }));
    setDirty(true);
    setResult(null);
  };

  const submit = () =>
    startSaving(async () => {
      const strip = (rows: Row[]): MenuItem[] => rows.map(({ label, link }) => ({ label, link }));
      const outcome = await save({ logo, header: strip(menus.header), footer: strip(menus.footer) });
      setResult(outcome);
      if (outcome.ok) setDirty(false);
    });

  return (
    <div className="flex flex-col gap-6 pb-24">
      <LogoField
        logo={logo}
        upload={upload}
        onChange={(next) => {
          setLogo(next);
          setDirty(true);
          setResult(null);
        }}
      />
      <MenuEditor
        name="header"
        title="Header menu"
        help="Across the top on computers, and in the slide-out menu on phones. The cart, My account and the country choice are always there, so they need no link here."
        rows={menus.header}
        onChange={(rows) => change("header", rows)}
        languages={languages}
        products={products}
      />
      <MenuEditor
        name="footer"
        title="Footer menu"
        help="At the bottom of every page, beside your business details, which the law requires and Kaizen always shows."
        rows={menus.footer}
        onChange={(rows) => change("footer", rows)}
        languages={languages}
        products={products}
      />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50"
          >
            {saving ? "Saving …" : "Save"}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {result?.ok
              ? "Saved. Your store shows it now."
              : dirty
                ? "Unsaved changes."
                : ""}
          </p>
          <a href={previewHref} target="_blank" rel="noopener" className="ml-auto text-sm underline">
            View the store
          </a>
        </div>
      </div>
      {result && !result.ok && (
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
          <p className="font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="mt-2 list-disc pl-5">
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LogoField({ logo, upload, onChange }: { logo: Logo | null; upload: Upload | null; onChange: (logo: Logo | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    try {
      const [image, thumbnail] = await Promise.all([shrinkImage(file, 800), shrinkImage(file, 480)]);
      const size = await createImageBitmap(image);
      const ext = image.type === "image/webp" ? "webp" : "jpg";
      const data = new FormData();
      data.set("image", new File([image], `logo.${ext}`, { type: image.type }));
      data.set("thumbnail", new File([thumbnail], `logo-480.${ext}`, { type: thumbnail.type }));
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, width: size.width, height: size.height });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a PNG, JPEG or WebP.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="logo-heading" className={card}>
      <div>
        <h2 id="logo-heading" className="font-medium">
          Logo
        </h2>
        <p className="text-sm text-muted">
          Shown in the header instead of the store&apos;s name, up to 40 pixels high. A wide PNG with a transparent
          background works best. Without a logo, the header shows the name.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 min-w-40 items-center justify-center rounded-md border border-dashed border-border bg-surface px-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded logo
            <img src={logo.url} alt="Your logo" className="max-h-10 w-auto max-w-56 object-contain" />
          ) : (
            <span className="text-sm text-muted">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {upload ? (
            <label className="cursor-pointer rounded-md border border-border px-3 py-2 focus-within:outline-2">
              {busy ? "Uploading …" : logo ? "Replace logo" : "Upload logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="text-muted">Uploads are not set up on this server.</p>
          )}
          {logo && (
            <button type="button" onClick={() => onChange(null)} className="rounded-md px-3 py-2 underline">
              Remove
            </button>
          )}
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
    </section>
  );
}

function MenuEditor({
  name,
  title,
  help,
  rows,
  onChange,
  languages,
  products,
}: {
  name: MenuName;
  title: string;
  help: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  languages: Language[];
  products: Product[];
}) {
  const limit = MENU_LIMITS[name];
  const update = (index: number, row: Row) => onChange(rows.map((r, i) => (i === index ? row : r)));
  const move = (from: number, to: number) => {
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };
  const add = () =>
    onChange([
      ...rows,
      keyed(
        products[0]
          ? { label: {}, link: { kind: "product", handle: products[0].handle } }
          : { label: {}, link: { kind: "home" } },
      ),
    ]);

  return (
    <section aria-labelledby={`${name}-heading`} className={card}>
      <div>
        <h2 id={`${name}-heading`} className="font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted">{help}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No links yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-col gap-3 rounded-md border border-border p-4">
              <MenuRow
                row={row}
                position={index + 1}
                onChange={(next) => update(index, next)}
                languages={languages}
                products={products}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move link ${index + 1} up`}
                  className={small}
                >
                  ↑ Up
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === rows.length - 1}
                  aria-label={`Move link ${index + 1} down`}
                  className={small}
                >
                  ↓ Down
                </button>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  aria-label={`Remove link ${index + 1}`}
                  className={`${small} ml-auto`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <button type="button" onClick={add} disabled={rows.length >= limit} className={`${small} w-fit`}>
        {rows.length >= limit ? `At most ${limit} links` : "+ Add a link"}
      </button>
    </section>
  );
}

function MenuRow({
  row,
  position,
  onChange,
  languages,
  products,
}: {
  row: Row;
  position: number;
  onChange: (row: Row) => void;
  languages: Language[];
  products: Product[];
}) {
  const setLink = (link: MenuLink) => onChange({ ...row, link });
  const hintId = useId();
  const kind = row.link.kind;
  const product = kind === "product" ? products.find((p) => p.handle === (row.link as { handle: string }).handle) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        Link {position} goes to
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value as LinkKind;
            setLink(
              next === "product"
                ? { kind: "product", handle: products[0]?.handle ?? "" }
                : next === "url"
                  ? { kind: "url", url: "" }
                  : { kind: next },
            );
          }}
          className={input}
        >
          {Object.entries(KIND_LABELS).map(([value, text]) => (
            <option key={value} value={value} disabled={value === "product" && products.length === 0}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {kind === "product" && (
        <label className={label}>
          Product
          <select
            value={(row.link as { handle: string }).handle}
            onChange={(event) => setLink({ kind: "product", handle: event.target.value })}
            className={input}
          >
            {!product && <option value={(row.link as { handle: string }).handle}>Product not found</option>}
            {products.map((p) => (
              <option key={p.handle} value={p.handle}>
                {p.title}
                {p.status === "draft" ? " (draft)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "url" && (
        <div className="flex flex-col gap-1">
          <label className={label}>
            Web address
            <input
              value={(row.link as { url: string }).url}
              onChange={(event) => setLink({ kind: "url", url: event.target.value })}
              placeholder="https://… or /p/product-name"
              inputMode="url"
              aria-describedby={`${hintId}-url`}
              className={input}
            />
          </label>
          <span id={`${hintId}-url`} className="text-xs text-muted">
            A full address opens that site; one starting with / is a page in your store.
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        {languages.map((language) => (
          <label key={language.locale} className={label}>
            Text in {language.name}
            <input
              value={row.label[language.locale] ?? ""}
              maxLength={LABEL_MAX}
              onChange={(event) => onChange({ ...row, label: { ...row.label, [language.locale]: event.target.value } })}
              placeholder={
                kind === "product"
                  ? (product?.title ?? "The product's title")
                  : kind === "url"
                    ? "Required"
                    : language.defaults[kind]
              }
              lang={language.locale}
              className={input}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
