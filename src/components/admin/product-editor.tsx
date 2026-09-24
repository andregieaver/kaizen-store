"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import {
  saveProductAction,
  startFileUploadAction,
  uploadImageAction,
  type SaveState,
} from "@/app/admin/(gated)/[store]/products/actions";
import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { fileSize } from "@/lib/file-size";
import { shrinkImage } from "@/lib/image-resize";
import type { CountryOption } from "@/lib/iso-countries";
import {
  combineOptions,
  GENERAL_TAX_CODE,
  MAX_FILES,
  MAX_MEDIA,
  MAX_OPTIONS,
  PRODUCER_SCHEMES,
  WITHDRAWAL_EXCLUSIONS,
  variantLabel,
  type Delivery,
  type OperatorChoice,
  type ProductInput,
  type VariantInput,
} from "@/lib/product-input";
import { summarize } from "@/lib/seo";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/client";
import type { EditorContext, Operator } from "@/server/products";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "rounded-lg border border-border bg-background p-5";
const CREATED_KEY = "kaizen:product-created";

const noSubscription = () => () => {};

function readCreated(productId: string | null): boolean {
  try {
    return productId !== null && sessionStorage.getItem(CREATED_KEY) === productId;
  } catch {
    return false;
  }
}

function forgetCreated() {
  try {
    sessionStorage.removeItem(CREATED_KEY);
  } catch {
    // Nothing to forget.
  }
}

type Props = {
  storeSlug: string;
  productId: string | null;
  initial: ProductInput;
  context: EditorContext;
  languageNames: Record<string, string>;
  /** Every country, named on the server so the browser renders the same text. */
  countries: CountryOption[];
  uploads: boolean;
  /** Where the product is shown in the storefront, once saved. */
  storefrontPath: string | null;
  /** The site's address, for the search result preview. */
  siteOrigin: string;
};

/**
 * The whole product on one page, saved in one go. State lives here until
 * Save; leaving with unsaved changes asks first.
 */
export function ProductEditor(props: Props) {
  const { storeSlug, languageNames, uploads, productId } = props;
  const router = useRouter();
  const [product, setProduct] = useState(props.initial);
  const [context, setContext] = useState(props.context);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<SaveState>({ status: "idle" });
  const [saving, startSaving] = useTransition();
  const [handleTouched, setHandleTouched] = useState(props.productId !== null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // A new product moves to its own page after the first save; the "Saved"
  // notice comes along through session storage until the next edit.
  const justCreated = useSyncExternalStore(
    noSubscription,
    () => readCreated(productId),
    () => false,
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (change: (p: ProductInput) => ProductInput) => {
    setProduct((p) => change(p));
    setDirty(true);
    if (result.status === "saved") setResult({ status: "idle" });
    forgetCreated();
  };

  const primary = context.primaryLocale;
  const title = product.translations.find((t) => t.locale === primary)?.title ?? "";

  const save = () => {
    const payload: ProductInput = {
      ...product,
      handle: product.handle || slugify(title) || "product",
    };
    startSaving(async () => {
      const outcome = await saveProductAction(storeSlug, productId, JSON.stringify(payload));
      setResult(outcome);
      if (outcome.status === "saved") {
        setProduct(outcome.product);
        setContext(outcome.context);
        setDirty(false);
        setHandleTouched(true);
        if (!productId) {
          try {
            sessionStorage.setItem(CREATED_KEY, outcome.productId);
          } catch {
            // Storage can be unavailable (private mode); the notice is optional.
          }
          router.replace(`/admin/${storeSlug}/products/${outcome.productId}`);
        }
      } else {
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-6"
      aria-busy={saving}
    >
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href={`/admin/${storeSlug}/products`} className="text-sm underline">
            Products
          </Link>
          <h1 className="text-xl font-semibold">{title || (productId ? "Untitled product" : "New product")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Status</span>
            <select
              value={product.status}
              onChange={(e) => update((p) => ({ ...p, status: e.target.value as ProductInput["status"] }))}
              className={`${input} w-auto`}
            >
              <option value="draft">Draft (hidden)</option>
              <option value="active">On sale</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="min-h-10 rounded-md bg-foreground px-5 text-sm font-medium text-background disabled:opacity-50"
          >
            {saving ? "Saving …" : "Save"}
          </button>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {(result.status === "saved" || justCreated) && !dirty && (
          <p className="rounded-md border border-border bg-background p-3 text-sm">
            Saved.{" "}
            {product.status === "active" && props.storefrontPath ? (
              <Link href={`${props.storefrontPath}/p/${product.handle}`} className="underline" target="_blank">
                See it in your store
              </Link>
            ) : (
              "Drafts are hidden from shoppers."
            )}
          </p>
        )}
      </div>
      {result.status === "error" && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-red-700 bg-background p-4 text-sm dark:border-red-400"
        >
          <p className="mb-2 font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="list-disc pl-5">
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <TextSection
        product={product}
        update={update}
        context={context}
        languageNames={languageNames}
        handleTouched={handleTouched}
        onHandleTouched={() => setHandleTouched(true)}
        productUrl={`${props.siteOrigin}${props.storefrontPath ?? ""}/p/${product.handle || slugify(title) || "product"}`}
      />
      <MediaSection storeSlug={storeSlug} product={product} update={update} uploads={uploads} />
      <VariantsSection product={product} update={update} context={context} countries={props.countries} />
      {product.variants.some((v) => v.delivery === "digital") && (
        <DigitalSection storeSlug={storeSlug} product={product} update={update} uploads={uploads} />
      )}
      <SafetySection
        product={product}
        update={update}
        operators={context.operators}
        countries={props.countries}
      />
      <LegalSection product={product} update={update} />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="min-h-10 rounded-md bg-foreground px-5 text-sm font-medium text-background disabled:opacity-50"
        >
          {saving ? "Saving …" : "Save"}
        </button>
      </div>
    </form>
  );
}

type SectionProps = {
  product: ProductInput;
  update: (change: (p: ProductInput) => ProductInput) => void;
};

function TextSection({
  product,
  update,
  context,
  languageNames,
  handleTouched,
  onHandleTouched,
  productUrl,
}: SectionProps & {
  context: EditorContext;
  languageNames: Record<string, string>;
  handleTouched: boolean;
  onHandleTouched: () => void;
  productUrl: string;
}) {
  const [locale, setLocale] = useState(context.primaryLocale);
  const tabsId = useId();
  const current = product.translations.find((t) => t.locale === locale) ?? {
    locale,
    title: "",
    description: "",
    safetyInformation: "",
    seoTitle: "",
    seoDescription: "",
  };
  const isPrimary = locale === context.primaryLocale;
  const primaryText = product.translations.find((t) => t.locale === context.primaryLocale);

  const setField = (
    field: "title" | "description" | "safetyInformation" | "seoTitle" | "seoDescription",
    value: string,
  ) =>
    update((p) => {
      const exists = p.translations.some((t) => t.locale === locale);
      const translations = exists
        ? p.translations.map((t) => (t.locale === locale ? { ...t, [field]: value } : t))
        : [...p.translations, { ...current, [field]: value }];
      // The web address follows the title until someone edits it.
      const handle = field === "title" && isPrimary && !handleTouched ? slugify(value) : p.handle;
      return { ...p, translations, handle };
    });

  return (
    <section aria-labelledby="text-heading" className={card}>
      <h2 id="text-heading" className="mb-4 font-medium">
        Title and description
      </h2>
      {context.locales.length > 1 && (
        <div role="tablist" aria-label="Language" className="mb-4 flex flex-wrap gap-1">
          {context.locales.map((l) => {
            const filled = Boolean(product.translations.find((t) => t.locale === l)?.title);
            return (
              <button
                key={l}
                type="button"
                role="tab"
                id={`${tabsId}-${l}`}
                aria-selected={l === locale}
                aria-controls={`${tabsId}-panel`}
                onClick={() => setLocale(l)}
                className="min-h-9 rounded-md border border-border px-3 text-sm aria-selected:border-foreground aria-selected:font-semibold"
              >
                {languageNames[l] ?? l}
                {!filled && <span className="text-muted"> (empty)</span>}
              </button>
            );
          })}
        </div>
      )}
      <div
        id={`${tabsId}-panel`}
        role={context.locales.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={context.locales.length > 1 ? `${tabsId}-${locale}` : undefined}
        className="flex flex-col gap-4"
      >
        {!isPrimary && (
          <p className="text-sm text-muted">
            Leave empty to show shoppers the {languageNames[context.primaryLocale] ?? context.primaryLocale} text.
          </p>
        )}
        <label className={label}>
          Title
          <input
            value={current.title}
            onChange={(e) => setField("title", e.target.value)}
            required={isPrimary}
            maxLength={200}
            lang={locale}
            className={input}
          />
        </label>
        <label className={label}>
          Description
          <textarea
            value={current.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={5}
            lang={locale}
            className={`${input} py-2`}
          />
        </label>
        <label className={label}>
          <span>
            Warnings and safety information <span className={hint}>(shown on the product page)</span>
          </span>
          <textarea
            value={current.safetyInformation}
            onChange={(e) => setField("safetyInformation", e.target.value)}
            rows={3}
            lang={locale}
            className={`${input} py-2`}
          />
        </label>
        {isPrimary && (
          <label className={label}>
            <span>
              Web address <span className={hint}>(the end of the product&apos;s link)</span>
            </span>
            <input
              value={product.handle}
              onChange={(e) => {
                onHandleTouched();
                update((p) => ({ ...p, handle: e.target.value.toLowerCase() }));
              }}
              placeholder={slugify(current.title) || "product-name"}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              spellCheck={false}
              autoCapitalize="none"
              className={`${input} font-mono`}
            />
          </label>
        )}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">In search results and shares</h3>
          <p className="text-sm text-muted">
            Optional. Empty fields use the title and the start of the description.
          </p>
          <SearchSnippetFields
            value={{ title: current.seoTitle, description: current.seoDescription }}
            onChange={(next) => {
              if (next.title !== current.seoTitle) setField("seoTitle", next.title);
              if (next.description !== current.seoDescription) setField("seoDescription", next.description);
            }}
            fallback={{
              title: current.title || primaryText?.title || "Product title",
              description: summarize(current.description || primaryText?.description || ""),
            }}
            url={productUrl}
            lang={locale}
          />
        </div>
      </div>
    </section>
  );
}

function MediaSection({ storeSlug, product, update, uploads }: SectionProps & { storeSlug: string; uploads: boolean }) {
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setProblem(null);
    const room = MAX_MEDIA - product.media.length;
    for (const file of Array.from(files).slice(0, room)) {
      setBusy((n) => n + 1);
      try {
        const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
        const data = new FormData();
        const ext = image.type === "image/webp" ? "webp" : "jpg";
        data.set("image", new File([image], `image.${ext}`, { type: image.type }));
        data.set("thumbnail", new File([thumbnail], `thumb.${ext}`, { type: thumbnail.type }));
        const outcome = await uploadImageAction(storeSlug, data);
        if (outcome.ok) {
          update((p) => ({
            ...p,
            media: [...p.media, { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl, alt: "" }],
          }));
        } else {
          setProblem(outcome.problem);
        }
      } catch {
        setProblem(`${file.name} could not be read as a picture.`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const move = (from: number, to: number) =>
    update((p) => {
      const media = [...p.media];
      const [item] = media.splice(from, 1);
      media.splice(to, 0, item);
      return { ...p, media };
    });

  return (
    <section aria-labelledby="media-heading" className={card}>
      <h2 id="media-heading" className="mb-1 font-medium">
        Pictures
      </h2>
      <p className="mb-4 text-sm text-muted">
        The first picture is the one shoppers see in lists. Pictures are made smaller before upload,
        so large photos are fine.
      </p>
      {product.media.length > 0 && (
        <ol className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {product.media.map((media, index) => (
            <li key={media.url} className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file */}
              <img
                src={media.thumbnailUrl ?? media.url}
                alt=""
                className="aspect-square w-full rounded-md border border-border bg-surface object-cover"
              />
              <label className="flex flex-col gap-1 text-xs font-medium">
                Describe the picture
                <input
                  value={media.alt}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      media: p.media.map((m, i) => (i === index ? { ...m, alt: e.target.value } : m)),
                    }))
                  }
                  placeholder="Defaults to the title"
                  className={`${input} min-h-9 text-xs`}
                />
              </label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  className="underline disabled:opacity-30"
                  aria-label={`Move picture ${index + 1} earlier`}
                >
                  ← Earlier
                </button>
                <button
                  type="button"
                  disabled={index === product.media.length - 1}
                  onClick={() => move(index, index + 1)}
                  className="underline disabled:opacity-30"
                  aria-label={`Move picture ${index + 1} later`}
                >
                  Later →
                </button>
                <button
                  type="button"
                  onClick={() => update((p) => ({ ...p, media: p.media.filter((_, i) => i !== index) }))}
                  className="ml-auto underline"
                  aria-label={`Remove picture ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {product.media.length < MAX_MEDIA &&
        (uploads ? (
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-dashed border-foreground px-4 text-sm font-medium focus-within:outline-2">
            {busy > 0 ? `Uploading ${busy} …` : "Add pictures"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy > 0}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className={`${label} flex-1`}>
              <span>
                Picture address <span className={hint}>(uploads are not set up on this server)</span>
              </span>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…"
                className={input}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (!/^https?:\/\/\S+$/.test(link)) return setProblem("Enter a full picture address, starting with https://.");
                setProblem(null);
                update((p) => ({ ...p, media: [...p.media, { url: link, thumbnailUrl: null, alt: "" }] }));
                setLink("");
              }}
              className="min-h-10 rounded-md border border-border px-4 text-sm"
            >
              Add picture
            </button>
          </div>
        ))}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </section>
  );
}

const emptyVariant = (options: Record<string, string>, delivery: Delivery): VariantInput => ({
  id: null,
  options,
  sku: "",
  gtin: null,
  prices: {},
  stock: 0,
  active: true,
  weightGrams: null,
  hsCode: null,
  originCountry: null,
  delivery,
});

/** Variants for a new set of options, keeping what was typed for combinations that remain. */
function variantsFor(
  options: ProductInput["options"],
  previous: VariantInput[],
  delivery: Delivery,
): VariantInput[] {
  const clean = options
    .map((o) => ({ name: o.name.trim(), values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))] }))
    .filter((o) => o.name && o.values.length > 0);
  const combos = combineOptions(clean);
  const key = (opts: Record<string, string>) =>
    JSON.stringify(clean.map((o) => opts[o.name] ?? ""));
  const byKey = new Map(previous.map((v) => [key(v.options), v]));
  const template = previous[0];
  return combos.map((combo) => {
    const kept = byKey.get(key(combo));
    if (kept) return { ...kept, options: combo };
    // A new combination starts with the first variant's prices, so a new
    // colour does not need every price typed again.
    return { ...emptyVariant(combo, delivery), prices: template ? { ...template.prices } : {} };
  });
}

function VariantsSection({
  product,
  update,
  context,
  countries,
}: SectionProps & { context: EditorContext; countries: CountryOption[] }) {
  const [optionsOn, setOptionsOn] = useState(product.options.length > 0);
  const [drafts, setDrafts] = useState(() => product.options.map((o) => o.values.join(", ")));
  const [mixed, setMixed] = useState(() => new Set(product.variants.map((v) => v.delivery)).size > 1);
  const allDigital = product.variants.every((v) => v.delivery === "digital");

  const setOptions = (options: ProductInput["options"]) =>
    update((p) => ({ ...p, options, variants: variantsFor(options, p.variants, p.delivery) }));

  const setVariant = (index: number, change: Partial<VariantInput>) =>
    update((p) => {
      const before = p.variants[index];
      const variants = p.variants.map((v, i) => (i === index ? { ...v, ...change } : v));
      // Files follow their variant when its SKU changes, and go back to
      // every digital variant when it stops being digital.
      const files = p.files.map((f) => {
        if (f.variantSku === null || f.variantSku !== before.sku) return f;
        if (change.delivery === "physical") return { ...f, variantSku: null };
        return change.sku !== undefined ? { ...f, variantSku: change.sku } : f;
      });
      return { ...p, variants, files };
    });

  const setDelivery = (delivery: Delivery) =>
    update((p) => ({
      ...p,
      delivery,
      variants: p.variants.map((v) => ({ ...v, delivery })),
      files: p.files.map((f) => ({ ...f, variantSku: null })),
    }));

  const parseValues = (text: string) => text.split(",").map((v) => v.trim()).filter(Boolean);

  return (
    <section aria-labelledby="variants-heading" className={card}>
      <h2 id="variants-heading" className="mb-4 font-medium">
        {allDigital ? "Price" : "Price and stock"}
      </h2>

      <fieldset className="mb-4 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">How is it delivered?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["physical", "Physical", "Shipped to the customer"],
              ["digital", "Digital", "Downloaded after payment"],
            ] as const
          ).map(([value, name, note]) => (
            <label
              key={value}
              className="flex min-h-10 min-w-48 flex-1 cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-checked:border-foreground sm:flex-none"
            >
              <input
                type="radio"
                name="delivery"
                checked={!mixed && product.delivery === value}
                onChange={() => {
                  setMixed(false);
                  setDelivery(value);
                }}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="block font-medium">{name}</span>
                <span className="text-muted">{note}</span>
              </span>
            </label>
          ))}
        </div>
        {product.variants.length > 1 && (
          <label className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked={mixed}
              onChange={(e) => {
                setMixed(e.target.checked);
                if (!e.target.checked) setDelivery(product.delivery);
              }}
              className="size-4"
            />
            Variants are delivered differently (for example a hardcover and an e-book)
          </label>
        )}
      </fieldset>

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={optionsOn}
          onChange={(e) => {
            setOptionsOn(e.target.checked);
            if (!e.target.checked) {
              setDrafts([]);
              setOptions([]);
            } else if (product.options.length === 0) {
              setDrafts([""]);
            }
          }}
          className="size-4"
        />
        This product comes in options, such as sizes or colours
      </label>

      {optionsOn && (
        <fieldset className="mb-5 flex flex-col gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Options</legend>
          {drafts.map((draft, index) => {
            const option = product.options[index] ?? { name: "", values: [] };
            return (
              <div key={index} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <label className={label}>
                  Option name
                  <input
                    value={option.name}
                    placeholder={index === 0 ? "Colour" : "Size"}
                    onChange={(e) => {
                      const options = [...product.options];
                      options[index] = { name: e.target.value, values: parseValues(draft) };
                      setOptions(options);
                    }}
                    className={input}
                  />
                </label>
                <label className={label}>
                  <span>
                    Values <span className={hint}>(separated by commas)</span>
                  </span>
                  <input
                    value={draft}
                    placeholder={index === 0 ? "White, Black" : "S, M, L"}
                    onChange={(e) => {
                      const next = [...drafts];
                      next[index] = e.target.value;
                      setDrafts(next);
                      const options = [...product.options];
                      options[index] = { name: option.name, values: parseValues(e.target.value) };
                      setOptions(options);
                    }}
                    className={input}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDrafts(drafts.filter((_, i) => i !== index));
                    setOptions(product.options.filter((_, i) => i !== index));
                  }}
                  className="min-h-10 text-sm underline"
                >
                  Remove<span className="sr-only"> option {option.name}</span>
                </button>
              </div>
            );
          })}
          {drafts.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => setDrafts([...drafts, ""])}
              className="self-start text-sm underline"
            >
              Add another option
            </button>
          )}
        </fieldset>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            Variants with SKU, {allDigital ? "" : "stock and "}price per country
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">
                Variant
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                SKU
              </th>
              {mixed && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  Delivery
                </th>
              )}
              {!allDigital && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  Stock
                  {context.locationName && (
                    <span className="block font-normal text-muted">{context.locationName}</span>
                  )}
                </th>
              )}
              {context.markets.map((market) => (
                <th key={market.code} scope="col" className="py-2 pr-3 font-medium">
                  {market.name}
                  <span className="block font-normal text-muted">{market.currency}, incl. VAT</span>
                </th>
              ))}
              <th scope="col" className="py-2 font-medium">
                For sale
              </th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant, index) => {
              const name = variantLabel(variant.options);
              return (
                <VariantRow
                  key={variant.id ?? `new-${JSON.stringify(variant.options)}`}
                  variant={variant}
                  name={name}
                  markets={context.markets}
                  countries={countries}
                  showDelivery={mixed}
                  showStock={!allDigital}
                  onChange={(change) => setVariant(index, change)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        {allDigital
          ? "Digital products have no stock: they never sell out. "
          : product.variants.some((v) => v.delivery === "digital")
            ? "Digital variants have no stock. "
            : ""}
        Prices include VAT. Leave a country empty to not sell the product there. Changing a price
        keeps its history, so reductions are always shown against the lowest price of the last 30 days.
      </p>
    </section>
  );
}

function VariantRow({
  variant,
  name,
  markets,
  countries,
  showDelivery,
  showStock,
  onChange,
}: {
  variant: VariantInput;
  name: string;
  markets: EditorContext["markets"];
  countries: CountryOption[];
  showDelivery: boolean;
  showStock: boolean;
  onChange: (change: Partial<VariantInput>) => void;
}) {
  const cell = "min-h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
  const digital = variant.delivery === "digital";
  const columns = 3 + Number(showDelivery) + Number(showStock) + markets.length;
  return (
    <>
      <tr className="border-b border-border align-top">
        <th scope="row" className="py-2 pr-3 font-normal">
          {name}
        </th>
        <td className="py-2 pr-3">
          <input
            value={variant.sku}
            onChange={(e) => onChange({ sku: e.target.value })}
            aria-label={`SKU for ${name}`}
            required
            className={`${cell} font-mono`}
          />
        </td>
        {showDelivery && (
          <td className="py-2 pr-3">
            <select
              value={variant.delivery}
              onChange={(e) => onChange({ delivery: e.target.value as Delivery })}
              aria-label={`Delivery for ${name}`}
              className={`${cell} w-32`}
            >
              <option value="physical">Physical</option>
              <option value="digital">Digital</option>
            </select>
          </td>
        )}
        {showStock && (
          <td className="py-2 pr-3">
            {digital ? (
              <span className="inline-flex min-h-9 items-center text-muted">Not needed</span>
            ) : (
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={variant.stock}
                onChange={(e) => onChange({ stock: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                aria-label={`Stock for ${name}`}
                className={`${cell} w-24`}
              />
            )}
          </td>
        )}
        {markets.map((market) => (
          <td key={market.code} className="py-2 pr-3">
            <input
              inputMode="decimal"
              value={variant.prices[market.code] ?? ""}
              onChange={(e) => onChange({ prices: { ...variant.prices, [market.code]: e.target.value } })}
              aria-label={`Price in ${market.name} for ${name}, ${market.currency}`}
              placeholder="0,00"
              className={`${cell} w-28`}
            />
          </td>
        ))}
        <td className="py-2">
          <input
            type="checkbox"
            checked={variant.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            aria-label={`${name} is for sale`}
            className="size-4"
          />
        </td>
      </tr>
      <tr className="border-b border-border">
        <td colSpan={columns} className="pb-3">
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              {digital ? `Barcode for ${name}` : `Barcode, weight and customs for ${name}`}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-medium">
                Barcode (GTIN/EAN)
                <input
                  inputMode="numeric"
                  value={variant.gtin ?? ""}
                  onChange={(e) => onChange({ gtin: e.target.value || null })}
                  className={cell}
                />
              </label>
              {!digital && (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Weight in grams
                    <input
                      type="number"
                      min={1}
                      value={variant.weightGrams ?? ""}
                      onChange={(e) => onChange({ weightGrams: e.target.value ? Math.floor(Number(e.target.value)) : null })}
                      className={cell}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Customs tariff (HS) code
                    <input
                      inputMode="numeric"
                      value={variant.hsCode ?? ""}
                      onChange={(e) => onChange({ hsCode: e.target.value || null })}
                      className={cell}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Country of origin
                    <select
                      value={variant.originCountry ?? ""}
                      onChange={(e) => onChange({ originCountry: e.target.value || null })}
                      className={cell}
                    >
                      <option value="">Not set</option>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function DigitalSection({ storeSlug, product, update, uploads }: SectionProps & { storeSlug: string; uploads: boolean }) {
  const [busy, setBusy] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const digital = product.variants.filter((v) => v.delivery === "digital");
  const several = digital.length > 1;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setProblem(null);
    const room = MAX_FILES - product.files.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setProblem(`A product can have at most ${MAX_FILES} files.`);
    await Promise.all(
      chosen.slice(0, room).map(async (file) => {
        setBusy((b) => [...b, file.name]);
        try {
          const started = await startFileUploadAction(storeSlug, file.name);
          if (!started.ok) return setProblem(started.problem);
          const contentType = file.type || "application/octet-stream";
          const { error } = await createClient()
            .storage.from(started.bucket)
            .uploadToSignedUrl(started.path, started.token, file, { contentType });
          if (error) return setProblem(`${file.name} could not be uploaded. It may be too large.`);
          update((p) => ({
            ...p,
            files: [
              ...p.files,
              { id: null, name: file.name, path: started.path, sizeBytes: file.size, contentType, variantSku: null },
            ],
          }));
        } catch {
          setProblem(`${file.name} could not be uploaded. Try again.`);
        } finally {
          setBusy((b) => {
            const i = b.indexOf(file.name);
            return b.filter((_, j) => j !== i);
          });
        }
      }),
    );
  };

  const setFile = (index: number, change: Partial<ProductInput["files"][number]>) =>
    update((p) => ({ ...p, files: p.files.map((f, i) => (i === index ? { ...f, ...change } : f)) }));

  const limit = (field: "downloadLimit" | "downloadDays", text: string) =>
    update((p) => ({ ...p, [field]: text === "" ? null : Math.max(1, Math.floor(Number(text) || 1)) }));

  return (
    <section aria-labelledby="digital-heading" className={card}>
      <h2 id="digital-heading" className="mb-1 font-medium">
        Files to download
      </h2>
      <p className="mb-4 text-sm text-muted">
        Shoppers get download links on their order page as soon as they have paid. The files stay private: links are personal and work only within the limits below.
      </p>

      {product.files.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-border rounded-md border border-border">
          {product.files.map((file, index) => (
            <li key={file.path} className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium">
                  <span>
                    Name shoppers see <span className={hint}>({fileSize(file.sizeBytes)})</span>
                  </span>
                  <input
                    value={file.name}
                    onChange={(e) => setFile(index, { name: e.target.value })}
                    required
                    maxLength={200}
                    className={`${input} min-h-9`}
                  />
                </label>
                {several && (
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Delivered with
                    <select
                      value={file.variantSku ?? ""}
                      onChange={(e) => setFile(index, { variantSku: e.target.value || null })}
                      className={`${input} min-h-9`}
                    >
                      <option value="">Every digital variant</option>
                      {digital.map((v) => (
                        <option key={v.sku || variantLabel(v.options)} value={v.sku} disabled={!v.sku}>
                          {variantLabel(v.options)}
                          {v.sku ? "" : " (add a SKU first)"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <button
                type="button"
                onClick={() => update((p) => ({ ...p, files: p.files.filter((_, i) => i !== index) }))}
                className="min-h-9 justify-self-start text-sm underline"
              >
                Remove<span className="sr-only"> {file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploads ? (
        product.files.length < MAX_FILES && (
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-dashed border-foreground px-4 text-sm font-medium focus-within:outline-2">
            {busy.length > 0 ? `Uploading ${busy.length} …` : "Add files"}
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={busy.length > 0}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )
      ) : (
        <p className="text-sm text-muted">File uploads are not set up on this server, so files cannot be added.</p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      {product.files.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Removing a file stops new downloads of it; customers who already bought it keep their links.
        </p>
      )}

      <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <label className={label}>
          <span>
            Downloads per file <span className={hint}>(empty for no limit)</span>
          </span>
          <input
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            value={product.downloadLimit ?? ""}
            onChange={(e) => limit("downloadLimit", e.target.value)}
            className={`${input} max-w-32`}
          />
        </label>
        <label className={label}>
          <span>
            Links work for this many days <span className={hint}>(empty for always)</span>
          </span>
          <input
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            value={product.downloadDays ?? ""}
            onChange={(e) => limit("downloadDays", e.target.value)}
            className={`${input} max-w-32`}
          />
        </label>
      </div>
    </section>
  );
}

function SafetySection({
  product,
  update,
  operators,
  countries,
}: SectionProps & { operators: Operator[]; countries: CountryOption[] }) {
  return (
    <section aria-labelledby="safety-heading" className={card}>
      <h2 id="safety-heading" className="mb-1 font-medium">
        Product safety
      </h2>
      <p className="mb-4 text-sm text-muted">
        {product.variants.every((v) => v.delivery === "digital")
          ? "Not needed for digital products: EU product-safety rules cover physical goods."
          : "EU rules require the manufacturer\u2019s name and contact details on the listing, and a responsible person in the EU when the manufacturer is outside it."}
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        <OperatorPicker
          legend="Manufacturer"
          choice={product.manufacturer}
          operators={operators}
          countries={countries}
          onChange={(manufacturer) => update((p) => ({ ...p, manufacturer }))}
        />
        <OperatorPicker
          legend="Responsible person in the EU"
          note="Needed when the manufacturer is outside the EU (Norway included)."
          choice={product.responsiblePerson}
          operators={operators}
          countries={countries}
          onChange={(responsiblePerson) => update((p) => ({ ...p, responsiblePerson }))}
        />
      </div>
    </section>
  );
}

function OperatorPicker({
  legend,
  note,
  choice,
  operators,
  countries,
  onChange,
}: {
  legend: string;
  note?: string;
  choice: OperatorChoice;
  operators: Operator[];
  countries: CountryOption[];
  onChange: (choice: OperatorChoice) => void;
}) {
  const value = choice === null ? "" : "id" in choice ? choice.id : "new";
  const blank = { name: "", postalAddress: "", electronicAddress: "", country: "" };
  const fresh = choice && "new" in choice ? choice.new : null;
  const setNew = (change: Partial<typeof blank>) => onChange({ new: { ...(fresh ?? blank), ...change } });

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {note && <p className="text-xs text-muted">{note}</p>}
      <select
        value={value}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "new" ? { new: blank } : { id: e.target.value })
        }
        aria-label={legend}
        className={input}
      >
        <option value="">None</option>
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.country})
          </option>
        ))}
        <option value="new">Add a new company …</option>
      </select>
      {fresh && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <label className={label}>
            Company name
            <input value={fresh.name} onChange={(e) => setNew({ name: e.target.value })} className={input} />
          </label>
          <label className={label}>
            Postal address
            <textarea
              value={fresh.postalAddress}
              onChange={(e) => setNew({ postalAddress: e.target.value })}
              rows={2}
              className={`${input} py-2`}
            />
          </label>
          <label className={label}>
            Email or website for safety questions
            <input
              value={fresh.electronicAddress}
              onChange={(e) => setNew({ electronicAddress: e.target.value })}
              className={input}
            />
          </label>
          <label className={label}>
            Country
            <select value={fresh.country} onChange={(e) => setNew({ country: e.target.value })} className={input}>
              <option value="">Choose …</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}

function LegalSection({ product, update }: SectionProps) {
  const general = product.taxCode === GENERAL_TAX_CODE;
  return (
    <section aria-labelledby="legal-heading" className={card}>
      <h2 id="legal-heading" className="mb-4 font-medium">
        Tax, returns and recycling
      </h2>
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">VAT category</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={general}
              onChange={() => update((p) => ({ ...p, taxCode: GENERAL_TAX_CODE }))}
            />
            General goods (standard VAT rate)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!general}
              onChange={() => update((p) => ({ ...p, taxCode: "" }))}
            />
            Something else (books, food, children&apos;s clothing …)
          </label>
          {!general && (
            <label className={`${label} pl-6`}>
              <span>
                Stripe tax code{" "}
                <a
                  href="https://docs.stripe.com/tax/tax-codes"
                  target="_blank"
                  rel="noreferrer"
                  className="font-normal underline"
                >
                  (find the right code)
                </a>
              </span>
              <input
                value={product.taxCode}
                onChange={(e) => update((p) => ({ ...p, taxCode: e.target.value.trim() }))}
                placeholder="txcd_…"
                className={`${input} max-w-xs font-mono`}
              />
            </label>
          )}
        </fieldset>

        <label className={label}>
          Right of withdrawal
          <select
            value={product.withdrawalExclusion}
            onChange={(e) => update((p) => ({ ...p, withdrawalExclusion: e.target.value }))}
            className={input}
          >
            {WITHDRAWAL_EXCLUSIONS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
          <span className={hint}>
            Most products have no exclusion. Only choose one that clearly applies.
            {product.variants.some((v) => v.delivery === "digital") &&
              " Downloads are handled for you: shoppers agree at checkout that the right ends once the download is available."}
          </span>
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Recycling schemes this product falls under</legend>
          <p className="mb-2 text-muted">
            Producer responsibility: you may need to register and pay a recycling fee in each country.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRODUCER_SCHEMES.map((scheme) => (
              <label key={scheme.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={product.schemes.includes(scheme.id)}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      schemes: e.target.checked
                        ? [...p.schemes, scheme.id]
                        : p.schemes.filter((s) => s !== scheme.id),
                    }))
                  }
                  className="size-4"
                />
                {scheme.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
