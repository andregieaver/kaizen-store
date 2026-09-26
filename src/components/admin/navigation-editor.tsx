"use client";

import { useId, useState, useTransition } from "react";

import { shrinkImage, squareIcon } from "@/lib/image-resize";
import {
  LABEL_MAX,
  MENU_LIMITS,
  type AnyLinkKind,
  type AnyMenuItem,
  type AnyMenuLink,
  type BusinessDetails,
  type Favicon,
  type Logo,
  type MenuName,
} from "@/lib/navigation";

type Upload = (data: FormData) => Promise<{ ok: true; url: string; thumbnailUrl?: string } | { ok: false; problem: string }>;
type Navigation = {
  logo: Logo | null;
  logoDark: Logo | null;
  favicon: Favicon | null;
  header: AnyMenuItem[];
  footer: AnyMenuItem[];
};
type Save = (
  input: Navigation & { business?: BusinessDetails },
) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
/** A language's built-in texts for links to Kaizen's own pages (the front page, the cart, …). */
type Language = { locale: string; name: string; defaults: Partial<Record<AnyLinkKind, string>> };
/** Something a link can point at: a product (by handle), a page (by id), a category or tag (by address). */
type Target = { value: string; title: string; note?: string };
type TargetKind = "product" | "page" | "category" | "tag" | "article" | "blogCategory";
type Targets = Partial<Record<TargetKind, Target[]>>;
const TARGET_NOUNS: Record<TargetKind, string> = {
  product: "Product",
  page: "Page",
  category: "Category",
  tag: "Tag",
  article: "Article",
  blogCategory: "Blog category",
};
const isTargetKind = (kind: AnyLinkKind): kind is TargetKind => kind in TARGET_NOUNS;

/**
 * A link kind the menus offer. Kaizen's page links name the page by id; a
 * store's (D54) by its address, which a store copied from the template keeps.
 */
type KindOption = { kind: AnyLinkKind; label: string; pageBy?: "id" | "slug" };

/** Items carry a key while edited, so React keeps each row's inputs as rows move. */
type Row = AnyMenuItem & { key: string };

/** What the page says around the menus: the store's words, or Kaizen's. */
export type NavigationCopy = {
  logo: string;
  /** What the logo for dark backgrounds is for (D60). */
  logoDark: string;
  header: string;
  footer: string;
  saved: string;
  view: string;
  urlHint: string;
  urlPlaceholder: string;
};

export const STORE_COPY: NavigationCopy = {
  logo: "Shown in the header instead of the store's name, up to 40 pixels high. A wide PNG with a transparent background works best. Without a logo, the header shows the name.",
  logoDark:
    "Optional: a light version of the logo, shown instead where the background is dark, such as a black header or dark mode in your theme (under Design). Without it, the logo above is shown everywhere.",
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
export const STORE_KINDS: KindOption[] = [
  { kind: "home", label: "Front page" },
  { kind: "page", label: "A page", pageBy: "slug" },
  { kind: "product", label: "A product" },
  { kind: "category", label: "A category's products" },
  { kind: "tag", label: "A tag's products" },
  { kind: "blog", label: "The blog" },
  { kind: "article", label: "An article", pageBy: "slug" },
  { kind: "blogCategory", label: "A blog category's articles" },
  { kind: "account", label: "My account" },
  { kind: "cart", label: "Cart" },
  { kind: "url", label: "Web address" },
];

let counter = 0;
const keyed = (item: AnyMenuItem): Row => ({ ...item, key: `row-${++counter}` });

/** The link a new row, or a row switched to `kind`, starts with. */
function linkFor(kind: AnyLinkKind, targets: Targets, kinds: KindOption[]): AnyMenuLink {
  switch (kind) {
    case "product":
      return { kind, handle: targets.product?.[0]?.value ?? "" };
    case "page":
    case "article":
      return targetLink(kind, targets[kind]?.[0]?.value ?? "", kinds);
    case "category":
    case "tag":
    case "blogCategory":
      return { kind, slug: targets[kind]?.[0]?.value ?? "" };
    case "url":
      return { kind, url: "" };
    default:
      return { kind } as AnyMenuLink;
  }
}

/** The page, product, category or tag a link points at, if the link has one. */
function targetOf(link: AnyMenuLink): { kind: TargetKind; value: string } | null {
  if (link.kind === "product") return { kind: "product", value: link.handle };
  if (link.kind === "page" || link.kind === "article") return { kind: link.kind, value: "pageId" in link ? link.pageId : link.slug };
  if (link.kind === "category" || link.kind === "tag" || link.kind === "blogCategory") return { kind: link.kind, value: link.slug };
  return null;
}

/** A link to `value` of a target kind. */
function targetLink(kind: TargetKind, value: string, kinds: KindOption[]): AnyMenuLink {
  if (kind === "page" || kind === "article") {
    const bySlug = kinds.find((k) => k.kind === kind)?.pageBy === "slug";
    if (kind === "page") return bySlug ? { kind, slug: value } : { kind, pageId: value };
    return bySlug ? { kind, slug: value } : { kind, pageId: value };
  }
  if (kind === "product") return { kind, handle: value };
  return { kind, slug: value };
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
  kinds?: KindOption[];
  targets: Targets;
  copy?: NavigationCopy;
  /** Who runs the site, edited with the menus when given (Kaizen's footer). */
  business?: BusinessDetails;
  upload: Upload | null;
  save: Save;
  previewHref: string;
}) {
  const [logo, setLogo] = useState<Logo | null>(initial.logo);
  const [logoDark, setLogoDark] = useState<Logo | null>(initial.logoDark);
  const [favicon, setFavicon] = useState<Favicon | null>(initial.favicon);
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
        logoDark,
        favicon,
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
        title="Logo"
        help={copy.logo}
        logo={logo}
        upload={upload}
        onChange={(next) => {
          setLogo(next);
          setDirty(true);
          setResult(null);
        }}
      />
      <LogoField
        title="Logo for dark backgrounds"
        help={copy.logoDark}
        logo={logoDark}
        upload={upload}
        dark
        onChange={(next) => {
          setLogoDark(next);
          setDirty(true);
          setResult(null);
        }}
      />
      <FaviconField
        favicon={favicon}
        upload={upload}
        onChange={(next) => {
          setFavicon(next);
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

/**
 * The site's icon (D62): any picture, made square in the browser as a 512 and
 * a 64 pixel PNG, shown as it will look in a browser tab.
 */
function FaviconField({
  favicon,
  upload,
  onChange,
}: {
  favicon: Favicon | null;
  upload: Upload | null;
  onChange: (favicon: Favicon | null) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    try {
      const [big, small] = await Promise.all([squareIcon(file, 512), squareIcon(file, 64)]);
      const data = new FormData();
      data.set("image", new File([big], "icon.png", { type: "image/png" }));
      data.set("thumbnail", new File([small], "icon-64.png", { type: "image/png" }));
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, smallUrl: outcome.thumbnailUrl ?? outcome.url });
      else setProblem(outcome.problem);
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a PNG, JPEG, WebP or SVG.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className={card}>
      <div>
        <h2 id={`${id}-heading`} className="font-medium">
          Icon (favicon)
        </h2>
        <p className="text-sm text-muted">
          Shown in browser tabs and bookmarks, and on phones&apos; home screens. A square picture of at least 512 pixels
          works best: a simple mark rather than the whole logo, as it is shown as small as 16 pixels. Without one,
          Kaizen&apos;s icon is shown.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {/* As in a browser tab, at the sizes it is shown. */}
        <div className="flex min-w-56 items-center gap-2 rounded-t-lg border border-b-0 border-border bg-surface px-3 py-2 text-sm">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded icon
            <img src={favicon.smallUrl} alt="" width={16} height={16} className="size-4" />
          ) : (
            <span aria-hidden className="size-4 rounded-sm bg-border" />
          )}
          <span className="truncate text-muted">Your site</span>
        </div>
        {favicon && (
          // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded icon
          <img src={favicon.url} alt="Your icon" width={64} height={64} className="size-16 rounded-xl border border-border" />
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {upload ? (
            <label className="cursor-pointer rounded-md border border-border px-3 py-2 focus-within:outline-2">
              {busy ? "Uploading …" : favicon ? "Replace icon" : "Upload icon"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
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
          {favicon && (
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

function LogoField({
  title,
  help,
  logo,
  upload,
  onChange,
  dark = false,
}: {
  title: string;
  help: string;
  logo: Logo | null;
  upload: Upload | null;
  onChange: (logo: Logo | null) => void;
  /** Shows the logo on a dark background, as it will be. */
  dark?: boolean;
}) {
  const id = useId();
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
    <section aria-labelledby={`${id}-heading`} className={card}>
      <div>
        <h2 id={`${id}-heading`} className="font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted">{help}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex h-20 min-w-40 items-center justify-center rounded-md border border-dashed border-border px-4 ${
            dark ? "bg-neutral-900 text-neutral-300" : "bg-surface text-muted"
          }`}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded logo
            <img src={logo.url} alt={`Your ${title.toLowerCase()}`} className="max-h-10 w-auto max-w-56 object-contain" />
          ) : (
            <span className="text-sm">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {upload ? (
            <label className="cursor-pointer rounded-md border border-border px-3 py-2 focus-within:outline-2">
              {busy ? "Uploading …" : logo ? `Replace ${title.toLowerCase()}` : `Upload ${title.toLowerCase()}`}
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
  kinds: KindOption[];
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
  const first = kinds.find(({ kind }) => isTargetKind(kind) && (targets[kind]?.length ?? 0) > 0);
  const add = () => onChange([...rows, keyed({ label: {}, link: linkFor(first?.kind ?? "home", targets, kinds) })]);

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
  kinds: KindOption[];
  targets: Targets;
  copy: NavigationCopy;
}) {
  const setLink = (link: AnyMenuLink) => onChange({ ...row, link });
  const hintId = useId();
  const kind = row.link.kind;
  const target = targetOf(row.link);
  const options = target ? (targets[target.kind] ?? []) : [];
  const chosen = target ? options.find((option) => option.value === target.value) : null;
  const noun = target ? TARGET_NOUNS[target.kind] : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        Link {position} goes to
        <select
          value={kind}
          onChange={(event) => setLink(linkFor(event.target.value as AnyLinkKind, targets, kinds))}
          className={input}
        >
          {kinds.map((option) => (
            <option
              key={option.kind}
              value={option.kind}
              disabled={isTargetKind(option.kind) && !targets[option.kind]?.length}
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
            onChange={(event) => setLink(targetLink(target.kind, event.target.value, kinds))}
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
                  ? (chosen?.title.trim() ?? `The ${noun.toLowerCase()}'s ${target.kind === "category" || target.kind === "tag" ? "name" : "title"}`)
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
