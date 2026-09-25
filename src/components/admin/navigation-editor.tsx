"use client";

import { useId, useState, useTransition } from "react";

import { shrinkImage } from "@/lib/image-resize";
import {
  LABEL_MAX,
  MENU_LIMITS,
  type AnyLinkKind,
  type AnyMenuItem,
  type AnyMenuLink,
  type BusinessDetails,
  type Logo,
  type MenuName,
} from "@/lib/navigation";

type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;
type Navigation = { logo: Logo | null; header: AnyMenuItem[]; footer: AnyMenuItem[] };
type Save = (
  input: Navigation & { business?: BusinessDetails },
) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
/** A language's built-in texts for links to Kaizen's own pages (the front page, the cart, …). */
type Language = { locale: string; name: string; defaults: Partial<Record<AnyLinkKind, string>> };
/** Something a link can point at: a product (by handle) or a page (by id). */
type Target = { value: string; title: string; note?: string };
type Targets = { product?: Target[]; page?: Target[] };

/** Items carry a key while edited, so React keeps each row's inputs as rows move. */
type Row = AnyMenuItem & { key: string };

/** What the page says around the menus: the store's words, or Kaizen's. */
export type NavigationCopy = {
  logo: string;
  header: string;
  footer: string;
  saved: string;
  view: string;
  urlHint: string;
  urlPlaceholder: string;
};

export const STORE_COPY: NavigationCopy = {
  logo: "Shown in the header instead of the store's name, up to 40 pixels high. A wide PNG with a transparent background works best. Without a logo, the header shows the name.",
  header:
    "Across the top on computers, and in the slide-out menu on phones. The cart, My account and the country choice are always there, so they need no link here.",
  footer: "At the bottom of every page, beside your business details, which the law requires and Kaizen always shows.",
  saved: "Saved. Your store shows it now.",
  view: "View the store",
  urlHint: "A full address opens that site; one starting with / is a page in your store.",
  urlPlaceholder: "https://… or /p/product-name",
};

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const small = "min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-40";

/** The link kinds a store's menus offer. */
export const STORE_KINDS: { kind: AnyLinkKind; label: string }[] = [
  { kind: "home", label: "Front page (all products)" },
  { kind: "product", label: "A product" },
  { kind: "account", label: "My account" },
  { kind: "cart", label: "Cart" },
  { kind: "url", label: "Web address" },
];

let counter = 0;
const keyed = (item: AnyMenuItem): Row => ({ ...item, key: `row-${++counter}` });

/** The link a new row, or a row switched to `kind`, starts with. */
function linkFor(kind: AnyLinkKind, targets: Targets): AnyMenuLink {
  switch (kind) {
    case "product":
      return { kind, handle: targets.product?.[0]?.value ?? "" };
    case "page":
      return { kind, pageId: targets.page?.[0]?.value ?? "" };
    case "url":
      return { kind, url: "" };
    default:
      return { kind };
  }
}

/** The page or product a link points at, if the link has one. */
function targetOf(link: AnyMenuLink): { kind: "product" | "page"; value: string } | null {
  if (link.kind === "product") return { kind: "product", value: link.handle };
  if (link.kind === "page") return { kind: "page", value: link.pageId };
  return null;
}

/**
 * A logo and two menus: a store's (D30) or Kaizen's own (D42). Changes stay
 * in the page until saved; every page shows them straight after.
 */
export function NavigationEditor({
  initial,
  languages,
  kinds = STORE_KINDS,
  targets,
  copy = STORE_COPY,
  business,
  upload,
  save,
  previewHref,
}: {
  initial: Navigation;
  languages: Language[];
  kinds?: { kind: AnyLinkKind; label: string }[];
  targets: Targets;
  copy?: NavigationCopy;
  /** Who runs the site, edited with the menus when given (Kaizen's footer). */
  business?: BusinessDetails;
  upload: Upload | null;
  save: Save;
  previewHref: string;
}) {
  const [logo, setLogo] = useState<Logo | null>(initial.logo);
  const [details, setDetails] = useState<BusinessDetails | undefined>(business);
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
      const strip = (rows: Row[]): AnyMenuItem[] => rows.map(({ label, link }) => ({ label, link }));
      const outcome = await save({
        logo,
        header: strip(menus.header),
        footer: strip(menus.footer),
        ...(details && { business: details }),
      });
      setResult(outcome);
      if (outcome.ok) setDirty(false);
    });

  return (
    <div className="flex flex-col gap-6 pb-24">
      <LogoField
        help={copy.logo}
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
        help={copy.header}
        rows={menus.header}
        onChange={(rows) => change("header", rows)}
        languages={languages}
        kinds={kinds}
        targets={targets}
        copy={copy}
      />
      <MenuEditor
        name="footer"
        title="Footer menu"
        help={copy.footer}
        rows={menus.footer}
        onChange={(rows) => change("footer", rows)}
        languages={languages}
        kinds={kinds}
        targets={targets}
        copy={copy}
      />
      {details && (
        <BusinessFields
          value={details}
          onChange={(next) => {
            setDetails(next);
            setDirty(true);
            setResult(null);
          }}
        />
      )}

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
              ? copy.saved
              : dirty
                ? "Unsaved changes."
                : ""}
          </p>
          <a href={previewHref} target="_blank" rel="noopener" className="ml-auto text-sm underline">
            {copy.view}
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

function LogoField({
  help,
  logo,
  upload,
  onChange,
}: {
  help: string;
  logo: Logo | null;
  upload: Upload | null;
  onChange: (logo: Logo | null) => void;
}) {
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
        <p className="text-sm text-muted">{help}</p>
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
  kinds,
  targets,
  copy,
}: {
  name: MenuName;
  title: string;
  help: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  languages: Language[];
  kinds: { kind: AnyLinkKind; label: string }[];
  targets: Targets;
  copy: NavigationCopy;
}) {
  const limit = MENU_LIMITS[name];
  const update = (index: number, row: Row) => onChange(rows.map((r, i) => (i === index ? row : r)));
  const move = (from: number, to: number) => {
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };
  // A new link starts at the first product or page there is, else the front page.
  const first = kinds.find(({ kind }) => (kind === "product" || kind === "page") && (targets[kind]?.length ?? 0) > 0);
  const add = () => onChange([...rows, keyed({ label: {}, link: linkFor(first?.kind ?? "home", targets) })]);

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
                kinds={kinds}
                targets={targets}
                copy={copy}
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
  kinds,
  targets,
  copy,
}: {
  row: Row;
  position: number;
  onChange: (row: Row) => void;
  languages: Language[];
  kinds: { kind: AnyLinkKind; label: string }[];
  targets: Targets;
  copy: NavigationCopy;
}) {
  const setLink = (link: AnyMenuLink) => onChange({ ...row, link });
  const hintId = useId();
  const kind = row.link.kind;
  const target = targetOf(row.link);
  const options = target ? (targets[target.kind] ?? []) : [];
  const chosen = target ? options.find((option) => option.value === target.value) : null;
  const noun = target?.kind === "page" ? "Page" : "Product";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        Link {position} goes to
        <select
          value={kind}
          onChange={(event) => setLink(linkFor(event.target.value as AnyLinkKind, targets))}
          className={input}
        >
          {kinds.map((option) => (
            <option
              key={option.kind}
              value={option.kind}
              disabled={(option.kind === "product" || option.kind === "page") && !targets[option.kind]?.length}
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <label className={label}>
          {noun}
          <select
            value={target.value}
            onChange={(event) =>
              setLink(
                target.kind === "page"
                  ? { kind: "page", pageId: event.target.value }
                  : { kind: "product", handle: event.target.value },
              )
            }
            className={input}
          >
            {!chosen && <option value={target.value}>{noun} not found</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
                {option.note ? ` (${option.note})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {row.link.kind === "url" && (
        <div className="flex flex-col gap-1">
          <label className={label}>
            Web address
            <input
              value={row.link.url}
              onChange={(event) => setLink({ kind: "url", url: event.target.value })}
              placeholder={copy.urlPlaceholder}
              inputMode="url"
              aria-describedby={`${hintId}-url`}
              className={input}
            />
          </label>
          <span id={`${hintId}-url`} className="text-xs text-muted">
            {copy.urlHint}
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
                target
                  ? (chosen?.title ?? `The ${noun.toLowerCase()}'s title`)
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

/** Who runs the site: the footer shows it on every page, as the law asks. */
function BusinessFields({ value, onChange }: { value: BusinessDetails; onChange: (value: BusinessDetails) => void }) {
  const field = (name: keyof BusinessDetails, text: string, props: { type?: string; autoComplete?: string } = {}) => (
    <label className={label}>
      {text}
      <input
        value={value[name]}
        onChange={(event) => onChange({ ...value, [name]: event.target.value })}
        className={input}
        {...props}
      />
    </label>
  );
  return (
    <section aria-labelledby="business-heading" className={card}>
      <div>
        <h2 id="business-heading" className="font-medium">
          Business details
        </h2>
        <p className="text-sm text-muted">
          Who runs the site, in the footer of every page: Norwegian and EU law ask every web service to say who it is and
          how to reach it.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("legalName", "Company name", { autoComplete: "organization" })}
        {field("organisationNumber", "Organisation number")}
        {field("postalAddress", "Address", { autoComplete: "street-address" })}
        {field("contactEmail", "Contact email", { type: "email", autoComplete: "email" })}
      </div>
    </section>
  );
}
