"use client";

import { useId, useState, useTransition } from "react";

import { shrinkImage, squareIcon } from "@/lib/image-resize";
import type { BusinessDetails, Favicon, Logo } from "@/lib/navigation";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

type Upload = (data: FormData) => Promise<{ ok: true; url: string; thumbnailUrl?: string } | { ok: false; problem: string }>;
type Navigation = {
  logo: Logo | null;
  logoDark: Logo | null;
  favicon: Favicon | null;
  /** The menus the standard header (and the phone's menu) and footer show (D85). */
  headerMenuId: string | null;
  footerMenuId: string | null;
};
type Save = (
  input: Navigation & { business?: BusinessDetails },
) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
/** What the page says around the menus: the store's words, or Kaizen's. */
export type NavigationCopy = {
  logo: string;
  /** What the logo for dark backgrounds is for (D60). */
  logoDark: string;
  header: string;
  footer: string;
  saved: string;
  view: string;
};

export const STORE_COPY: NavigationCopy = {
  logo: "Shown in the header instead of the store's name, up to 40 pixels high. A wide PNG with a transparent background works best. Without a logo, the header shows the name.",
  logoDark:
    "Optional: a light version of the logo, shown instead where the background is dark, such as a black header or dark mode in your theme (under Design). Without it, the logo above is shown everywhere.",
  header:
    "Across the top on computers, and in the slide-out menu on phones. The cart, My account and the country choice are always there, so they need no link in it.",
  footer: "At the bottom of every page, beside your business details, which the law requires and Kaizena Flow always shows.",
  saved: "Saved. Your store shows it now.",
  view: "View the store",
};

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/**
 * A site's logos and icon, and which of its menus (D85) the standard header
 * and footer show: a store's (D30) or Kaizen's own (D42). Changes stay in
 * the page until saved; every page shows them straight after.
 */
export function NavigationEditor({
  initial,
  menus,
  menusHref,
  copy: given,
  business,
  upload,
  save,
  previewHref,
}: {
  initial: Navigation;
  /** The owner's menus to choose from. */
  menus: { id: string; name: string }[];
  /** Where the menus are edited. */
  menusHref: string;
  copy?: NavigationCopy;
  /** Who runs the site, edited with the menus when given (Kaizen's footer). */
  business?: BusinessDetails;
  upload: Upload | null;
  save: Save;
  previewHref: string;
}) {
  const w = useAdminText("website").navigation;
  // The store's words in the admin's language unless the page gives its own (Kaizen's).
  const copy = given ?? w.copy;
  const [logo, setLogo] = useState<Logo | null>(initial.logo);
  const [logoDark, setLogoDark] = useState<Logo | null>(initial.logoDark);
  const [favicon, setFavicon] = useState<Favicon | null>(initial.favicon);
  const [details, setDetails] = useState<BusinessDetails | undefined>(business);
  const [standard, setStandard] = useState({ headerMenuId: initial.headerMenuId, footerMenuId: initial.footerMenuId });
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; problems: string[] } | null>(null);
  const [saving, startSaving] = useTransition();

  const submit = () =>
    startSaving(async () => {
      const outcome = await save({ logo, logoDark, favicon, ...standard, ...(details && { business: details }) });
      setResult(outcome);
      if (outcome.ok) setDirty(false);
    });

  return (
    <div className="flex flex-col gap-6 pb-24">
      <LogoField
        title={w.logo}
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
        title={w.logoDark}
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
      <section aria-labelledby="standard-menus-heading" className={card}>
        <div>
          <h2 id="standard-menus-heading" className="text-title text-ink">
            {w.menus}
          </h2>
          <p className="text-sm text-muted">
            {w.menusHintStart}
            <a href={menusHref} className="underline">
              {w.menus}
            </a>
            {w.menusHintEnd}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["headerMenuId", w.mainMenu, copy.header],
              ["footerMenuId", w.footerMenu, copy.footer],
            ] as const
          ).map(([key, title, help]) => (
            <label key={key} className={label}>
              {title}
              <select
                value={standard[key] ?? ""}
                onChange={(event) => {
                  setStandard((current) => ({ ...current, [key]: event.target.value || null }));
                  setDirty(true);
                  setResult(null);
                }}
                className={input}
              >
                <option value="">{w.none}</option>
                {menus.map((menu) => (
                  <option key={menu.id} value={menu.id}>
                    {menu.name}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted">{help}</span>
            </label>
          ))}
        </div>
      </section>
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

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
          >
            {saving ? w.saving : w.save}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {result?.ok
              ? copy.saved
              : dirty
                ? w.unsaved
                : ""}
          </p>
          <a href={previewHref} target="_blank" rel="noopener" className="ml-auto text-sm underline">
            {copy.view}
          </a>
        </div>
      </div>
      {result && !result.ok && (
        <div role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
          <p className="font-medium">{w.fix}</p>
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
  const w = useAdminText("website").navigation;
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
      // Its name as it was on the owner's computer, for the media library (D88).
      data.set("name", file.name);
      data.set("thumbnail", new File([small], "icon-64.png", { type: "image/png" }));
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, smallUrl: outcome.thumbnailUrl ?? outcome.url });
      else setProblem(outcome.problem);
    } catch {
      setProblem(fillWords(w.iconUnreadable, { name: file.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className={card}>
      <div>
        <h2 id={`${id}-heading`} className="text-title text-ink">
          {w.icon}
        </h2>
        <p className="text-sm text-muted">{w.iconHint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {/* As in a browser tab, at the sizes it is shown. */}
        <div className="flex min-w-56 items-center gap-2 rounded-t-lg border border-b-0 border-line bg-sunken px-3 py-2 text-sm">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded icon
            <img src={favicon.smallUrl} alt="" width={16} height={16} className="size-4" />
          ) : (
            <span aria-hidden className="size-4 rounded-sm bg-line" />
          )}
          <span className="truncate text-muted">{w.yourSite}</span>
        </div>
        {favicon && (
          // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded icon
          <img src={favicon.url} alt={w.yourIcon} width={64} height={64} className="size-16 rounded-xl border border-line" />
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {upload ? (
            <label className="cursor-pointer rounded-md border border-line px-3 py-2 focus-within:outline-2">
              {busy ? w.uploading : favicon ? w.replaceIcon : w.uploadIcon}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="text-muted">{w.uploadsOff}</p>
          )}
          {favicon && (
            <button type="button" onClick={() => onChange(null)} className="rounded-pill px-3 py-2 underline">
              {w.remove}
            </button>
          )}
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
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
  const w = useAdminText("website").navigation;
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
      // Its name as it was on the owner's computer, for the media library (D88).
      data.set("name", file.name);
      data.set("thumbnail", new File([thumbnail], `logo-480.${ext}`, { type: thumbnail.type }));
      // Compressed until it was as small as it could be while it looked the same (D213).
      data.set("compressed", "1");
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, width: size.width, height: size.height });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(fillWords(w.logoUnreadable, { name: file.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className={card}>
      <div>
        <h2 id={`${id}-heading`} className="text-title text-ink">
          {title}
        </h2>
        <p className="text-sm text-muted">{help}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex h-20 min-w-40 items-center justify-center rounded-md border border-dashed border-edge px-4 ${
            dark ? "bg-neutral-soft text-neutral-text" : "bg-sunken text-muted"
          }`}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded logo
            <img src={logo.url} alt={dark ? w.yourLogoDark : w.yourLogo} className="max-h-10 w-auto max-w-56 object-contain" />
          ) : (
            <span className="text-sm">{w.noLogo}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {upload ? (
            <label className="cursor-pointer rounded-md border border-line px-3 py-2 focus-within:outline-2">
              {busy ? w.uploading : logo ? (dark ? w.replaceLogoDark : w.replaceLogo) : dark ? w.uploadLogoDark : w.uploadLogo}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="text-muted">{w.uploadsOff}</p>
          )}
          {logo && (
            <button type="button" onClick={() => onChange(null)} className="rounded-pill px-3 py-2 underline">
              {w.remove}
            </button>
          )}
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </section>
  );
}

/** Who runs the site: the footer shows it on every page, as the law asks. */
function BusinessFields({ value, onChange }: { value: BusinessDetails; onChange: (value: BusinessDetails) => void }) {
  const w = useAdminText("website").navigation;
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
        <h2 id="business-heading" className="text-title text-ink">
          {w.business}
        </h2>
        <p className="text-sm text-muted">{w.businessHint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("legalName", w.legalName, { autoComplete: "organization" })}
        {field("organisationNumber", w.organisationNumber)}
        {field("postalAddress", w.postalAddress, { autoComplete: "street-address" })}
        {field("contactEmail", w.contactEmail, { type: "email", autoComplete: "email" })}
      </div>
    </section>
  );
}
