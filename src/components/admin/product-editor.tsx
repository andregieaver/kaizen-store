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
  createProductTermAction,
  saveProductAction,
  startFileUploadAction,
  uploadImageAction,
  type SaveState,
  suggestTextAction,
} from "@/app/admin/(gated)/[store]/products/actions";
import { startFieldFileUploadAction } from "@/app/admin/(gated)/[store]/fields/actions";
import { AiWriter } from "@/components/admin/ai-writer";
import { applicableGroups, EntityFields } from "@/components/admin/entity-fields";
import { fieldFileUploader } from "@/components/admin/field-file-upload";
import { uploadFieldPicture } from "@/components/admin/field-picture-upload";
import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { TermPicker } from "@/components/admin/terms";
import { PRODUCT_AUDIENCES, type ProductAudience } from "@/lib/b2b";
import { EMPTY_DATA, changesFrom, withParents, type FieldData, type FieldGroup, type FieldLookups } from "@/lib/custom-fields";
import { fileSize } from "@/lib/file-size";
import { shrinkImage } from "@/lib/image-resize";
import { addressChangeWords } from "@/lib/redirect-admin";
import type { CountryOption } from "@/lib/iso-countries";
import {
  combineOptions,
  DEFAULT_APPOINTMENT,
  defaultBooking,
  GENERAL_TAX_CODE,
  isBooked,
  MAX_FILES,
  MAX_MEDIA,
  MAX_OPTIONS,
  PRODUCER_SCHEMES,
  WITHDRAWAL_EXCLUSIONS,
  variantLabel,
  type Delivery,
  type AppointmentInput,
  type SeasonInput,
  type OperatorChoice,
  type ProductInput,
  type VariantInput,
} from "@/lib/product-input";
import { backorderMayPassAgreed, BACKORDER_DAYS_MAX, BACKORDER_DAYS_MIN, BACKORDER_LONG_HINT, THRESHOLD_MAX } from "@/lib/inventory";
import type { ProductFacts, WriteRequest, WrittenText } from "@/lib/product-writing";
import { summarize } from "@/lib/seo";
import {
  MAX_DISCOUNT_PERCENT,
  MAX_INTERVAL_COUNT,
  MAX_MIN_CYCLES,
  MAX_PLANS,
  MAX_TRIAL_DAYS,
  type PlanInterval,
} from "@/lib/subscriptions";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/client";
import type { EditorContext, Operator } from "@/server/products";
import { SoldByMeasureField, ContentFields, type ContentContext } from "@/components/admin/unit-price-fields";
import { VatCategoryField } from "@/components/admin/vat-category-field";
import { contentState, withoutContentWhereNotGoods } from "@/lib/unit-price-editor";

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
  /** The store's custom field groups for products (D118), and what is entered in them for this product. */
  fields: {
    groups: FieldGroup[];
    data: FieldData;
    lookups: FieldLookups;
    /** The groups for its variants and what is entered for each, by variant id; none where the store has no such group. */
    variants: { groups: FieldGroup[]; data: Record<string, FieldData> } | null;
  };
};

/** Which variant a client holds fields for: a saved one by id, a new one by its options (as its row is keyed). */
const variantKey = (variant: { id: string | null; options: Record<string, string> }) =>
  variant.id ?? `new-${JSON.stringify(variant.options)}`;

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
  const [fieldData, setFieldData] = useState(props.fields.data);
  const [variantData, setVariantData] = useState(props.fields.variants?.data ?? {});
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
  // The custom field groups this product gets now: they follow its kind, audience, categories and tags as they change (D118).
  const fieldGroups = applicableGroups(props.fields.groups, {
    entity: "product",
    kind: product.kind,
    audience: product.audience,
    categories: withParents(product.categories, context.terms),
    tags: product.tags,
    roles: [],
  });
  // And the groups for its variants, by the same rules (a variant follows its product).
  const variantGroups = applicableGroups(props.fields.variants?.groups ?? [], {
    entity: "variant",
    kind: product.kind,
    audience: product.audience,
    categories: withParents(product.categories, context.terms),
    tags: product.tags,
    roles: [],
  });
  const pictureUpload = uploads ? (file: File) => uploadFieldPicture(storeSlug, file) : null;
  // Files for file fields go from the browser to the store's folder in storage (a server action only starts the upload).
  const fileUpload = uploads ? fieldFileUploader((file) => startFieldFileUploadAction(storeSlug, file)) : null;

  const save = () => {
    const payload = {
      ...product,
      // A content left empty is no content (unit price, D160).
      variants: product.variants.map((v) => (v.measure && v.measure.amount.trim() === "" ? { ...v, measure: null } : v)),
      handle: product.handle || slugify(title) || "product",
      fields: changesFrom(fieldGroups.flatMap((group) => group.fields), fieldData, context.locales),
      // Each variant's, by its SKU as it is now.
      variantFields:
        variantGroups.length > 0
          ? Object.fromEntries(
              product.variants.map((variant) => [
                variant.sku,
                changesFrom(variantGroups.flatMap((group) => group.fields), variantData[variantKey(variant)] ?? EMPTY_DATA, context.locales),
              ]),
            )
          : undefined,
    };
    startSaving(async () => {
      const outcome = await saveProductAction(storeSlug, productId, JSON.stringify(payload));
      setResult(outcome);
      if (outcome.status === "saved") {
        setProduct(outcome.product);
        setContext(outcome.context);
        setFieldData(outcome.fieldData);
        setVariantData(outcome.variantFieldData);
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
              <option value="active">Published</option>
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
            {result.status === "saved" && result.handleChanged && (
              <span className="mt-1 block">
                {addressChangeWords(result.handleChanged)}{" "}
                <Link href={`/admin/${storeSlug}/redirects`} className="underline">
                  See the redirects
                </Link>
              </span>
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
        suggest={(request) => suggestTextAction(storeSlug, productId, request)}
      />
      <MediaSection storeSlug={storeSlug} product={product} update={update} uploads={uploads} />
      <section aria-labelledby="terms-heading" className={card}>
        <h2 id="terms-heading" className="mb-1 font-medium">
          Categories and tags
        </h2>
        <p className="mb-4 text-sm text-muted">
          Shoppers find the product through its categories and tags, in menus and in content grids.
        </p>
        <TermPicker
          terms={context.terms}
          value={{ categories: product.categories, tags: product.tags }}
          onChange={(ids) => update((p) => ({ ...p, ...ids }))}
          onTerms={(terms) => setContext((c) => ({ ...c, terms }))}
          create={createProductTermAction.bind(null, storeSlug)}
          manageHref={`/admin/${storeSlug}/products/categories`}
        />
        {context.layouts.length > 0 && (
          <label className={`${label} mt-4 max-w-sm`}>
            Page layout
            <select
              value={product.layoutId ?? ""}
              onChange={(e) => update((p) => ({ ...p, layoutId: e.target.value || null }))}
              className={input}
            >
              <option value="">From its categories, tags or the store</option>
              {context.layouts.map((layout) => (
                <option key={layout.id} value={layout.id}>
                  {layout.title}
                  {layout.published ? "" : " (not published)"}
                </option>
              ))}
            </select>
            <span className={hint}>
              How its page is laid out (Product layouts). Its own layout goes before its categories&apos;, tags&apos; and the
              store&apos;s; one not yet published is not used.
            </span>
          </label>
        )}
      </section>
      <EntityFields
        groups={fieldGroups}
        data={fieldData}
        onChange={(next) => {
          setFieldData(next);
          setDirty(true);
          if (result.status === "saved") setResult({ status: "idle" });
          forgetCreated();
        }}
        locales={context.locales}
        main={context.primaryLocale}
        languageNames={languageNames}
        upload={pictureUpload}
        fileUpload={fileUpload}
        lookups={props.fields.lookups}
      />
      {variantGroups.length > 0 && product.variants.length > 0 && (
        <section aria-labelledby="variant-fields-heading" className="flex flex-col gap-3">
          <h2 id="variant-fields-heading" className="font-medium">
            Custom fields for each variant
          </h2>
          {product.variants.map((variant) => {
            const key = variantKey(variant);
            return (
              <details key={key} className="rounded-lg border border-border bg-background" open={product.variants.length === 1}>
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
                  {variant.sku} <span className="font-normal text-muted">{variantLabel(variant.options)}</span>
                </summary>
                <div className="px-3 pb-3">
                  <EntityFields
                    groups={variantGroups.map((group) => ({ ...group, position: "main" as const }))}
                    data={variantData[key] ?? EMPTY_DATA}
                    onChange={(next) => {
                      setVariantData((all) => ({ ...all, [key]: next }));
                      setDirty(true);
                      if (result.status === "saved") setResult({ status: "idle" });
                      forgetCreated();
                    }}
                    locales={context.locales}
                    main={context.primaryLocale}
                    languageNames={languageNames}
                    upload={pictureUpload}
                    fileUpload={fileUpload}
                    lookups={props.fields.lookups}
                    title={`Fields of ${variant.sku}`}
                    intro="Only for this variant, shown when a shopper chooses it."
                    idPrefix={`variant-fields-${key}`}
                  />
                </div>
              </details>
            );
          })}
        </section>
      )}
      {context.audience === "both" && <AudienceSection product={product} update={update} />}
      {/* The kinds a store's features offer (D178), and the product's own kind as it was loaded, which it keeps while its feature is off. */}
      {(context.appointmentsOn || context.staysOn || isBooked(product.kind) || isBooked(props.initial.kind)) && (
        <KindSection
          product={product}
          update={update}
          offered={{
            goods: true,
            appointment: context.appointmentsOn || props.initial.kind === "appointment",
            stay: context.staysOn || props.initial.kind === "stay",
            rental: context.staysOn || props.initial.kind === "rental",
          }}
        />
      )}
      {product.kind === "appointment" && product.appointment && (
        <AppointmentSection storeSlug={storeSlug} product={product} update={update} context={context} />
      )}
      {(product.kind === "stay" || product.kind === "rental") && product.appointment && (
        <RangeSection storeSlug={storeSlug} product={product} update={update} context={context} />
      )}
      <VariantsSection
        storeSlug={storeSlug}
        product={product}
        update={update}
        context={context}
        countries={props.countries}
        upload={uploads ? (file) => uploadPicture(storeSlug, file) : null}
      />
      {product.variants.some((v) => v.delivery === "digital") && (
        <DigitalSection storeSlug={storeSlug} product={product} update={update} uploads={uploads} />
      )}
      {!isBooked(product.kind) && (
        <>
          {/* Purchase options while Subscriptions is on (D178); off, they are kept as they are and not offered to shoppers. */}
          {context.subscriptionsOn ? (
            <SubscriptionSection product={product} update={update} markets={context.markets} netPrices={context.audience === "businesses"} />
          ) : (
            product.plans.length > 0 && (
              <p className="text-sm text-muted">
                Purchase options: Subscriptions is switched off under Settings, Features, so this product&apos;s {product.plans.length === 1 ? "option is" : `${product.plans.length} options are`} kept but not offered.
              </p>
            )
          )}
          <SafetySection product={product} update={update} operators={context.operators} countries={props.countries} />
        </>
      )}
      <LegalSection
        product={product}
        update={update}
        markets={context.markets}
        vatCategories={context.vatCategories}
        terms={context.terms}
        primaryLocale={context.primaryLocale}
      />

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
  suggest,
}: SectionProps & {
  context: EditorContext;
  languageNames: Record<string, string>;
  handleTouched: boolean;
  onHandleTouched: () => void;
  productUrl: string;
  suggest: (request: WriteRequest) => Promise<Awaited<ReturnType<typeof suggestTextAction>>>;
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

  // What AI writing is told (D76): the texts, with the product's categories, tags and options by name.
  const termName = (id: string) => context.terms.find((term) => term.id === id)?.name;
  const factsOf = (text: { title: string; description: string; seoTitle: string; seoDescription: string }): ProductFacts => ({
    kind: product.kind,
    title: text.title,
    description: text.description,
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
    categories: product.categories.map(termName).filter((name): name is string => Boolean(name)),
    tags: product.tags.map(termName).filter((name): name is string => Boolean(name)),
    options: product.options,
  });

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
        {context.aiWriting && (
          <AiWriter
            key={locale}
            isPrimary={isPrimary}
            language={languageNames[locale] ?? locale}
            fromLanguage={languageNames[context.primaryLocale] ?? context.primaryLocale}
            facts={factsOf(current)}
            sourceFacts={factsOf(primaryText ?? current)}
            suggest={suggest}
            onUse={(written: WrittenText) => {
              for (const [field, value] of Object.entries(written) as [keyof WrittenText, string][]) setField(field, value);
            }}
          />
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
            <span className={hint}>If you change the address of a product that has been published, the old address redirects to the new one.</span>
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

/** A picture from the owner's computer, shrunk in the browser (1600 px and a 480 px copy) and uploaded to the store. */
async function uploadPicture(storeSlug: string, file: File): Promise<{ url: string; thumbnailUrl: string } | { problem: string }> {
  try {
    const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
    const data = new FormData();
    const ext = image.type === "image/webp" ? "webp" : "jpg";
    data.set("image", new File([image], `image.${ext}`, { type: image.type }));
    // Its name as it was on the owner's computer, for the media library (D88).
    data.set("name", file.name);
    data.set("thumbnail", new File([thumbnail], `thumb.${ext}`, { type: thumbnail.type }));
    const outcome = await uploadImageAction(storeSlug, data);
    return outcome.ok ? { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl } : { problem: outcome.problem };
  } catch {
    return { problem: `${file.name} could not be read as a picture.` };
  }
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
      const outcome = await uploadPicture(storeSlug, file);
      if ("url" in outcome) {
        update((p) => ({ ...p, media: [...p.media, { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl, alt: "" }] }));
      } else {
        setProblem(outcome.problem);
      }
      setBusy((n) => n - 1);
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
  measure: null,
  prices: {},
  cost: "",
  stock: 0,
  stockPolicy: "deny",
  backorderDays: null,
  lowStockThreshold: null,
  active: true,
  weightGrams: null,
  hsCode: null,
  originCountry: null,
  delivery,
  rentalPeriod: "day",
  image: null,
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

type PictureUpload = (file: File) => Promise<{ url: string; thumbnailUrl: string } | { problem: string }>;

function VariantsSection({
  storeSlug,
  product,
  update,
  context,
  countries,
  upload,
}: SectionProps & { storeSlug: string; context: EditorContext; countries: CountryOption[]; upload: PictureUpload | null }) {
  const [optionsOn, setOptionsOn] = useState(product.options.length > 0);
  const [drafts, setDrafts] = useState(() => product.options.map((o) => o.values.join(", ")));
  const [mixed, setMixed] = useState(() => new Set(product.variants.map((v) => v.delivery)).size > 1);
  // Downloads and appointments (D65) have no stock.
  const allDigital = product.variants.every((v) => v.delivery !== "physical");
  const service = isBooked(product.kind);

  const setOptions = (options: ProductInput["options"]) =>
    update((p) => ({ ...p, options, variants: variantsFor(options, p.variants, p.delivery) }));

  const setVariant = (index: number, change: Partial<VariantInput>) =>
    update((p) => {
      const before = p.variants[index];
      // A variant that is no longer shipped goods has no content (D160).
      // A variant that is no longer goods that are shipped keeps no backorder setting and no low-stock level (wave 3, D172).
      const notShipped = change.delivery !== undefined && change.delivery !== "physical";
      const variants = withoutContentWhereNotGoods(
        p.kind,
        p.variants.map((v, i) => (i === index ? { ...v, ...change, ...(notShipped ? { stockPolicy: "deny" as const, backorderDays: null, lowStockThreshold: null } : {}) } : v)),
      );
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
      variants: withoutContentWhereNotGoods(p.kind, p.variants.map((v) => ({ ...v, delivery }))),
      files: p.files.map((f) => ({ ...f, variantSku: null })),
    }));

  const parseValues = (text: string) => text.split(",").map((v) => v.trim()).filter(Boolean);

  // What the content's live preview needs (unit price, D160): the markets with their VAT, how the store shows prices.
  const contentContext: ContentContext = {
    markets: context.markets,
    audience: context.audience,
    vatCategory: product.vatCategory,
    locale: context.primaryLocale,
  };

  return (
    <section aria-labelledby="variants-heading" className={card}>
      <h2 id="variants-heading" className="mb-4 font-medium">
        {allDigital ? "Price" : "Price and stock"}
      </h2>

      <fieldset className="mb-4 flex flex-col gap-2 text-sm" hidden={service}>
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
              {product.kind === "rental" && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  Rented by
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
                  <span className="block font-normal text-muted">
                    {market.currency}, {context.audience === "businesses" ? "excl." : "incl."} VAT
                  </span>
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
                  mainCurrency={context.mainCurrency}
                  countries={countries}
                  showDelivery={mixed}
                  showPeriod={product.kind === "rental"}
                  showStock={!allDigital}
                  stockHref={context.activeLocations > 1 ? `/admin/${storeSlug}/inventory?q=${encodeURIComponent(variant.sku)}` : null}
                  content={product.kind === "goods" ? contentContext : null}
                  pictures={product.media}
                  upload={upload}
                  onChange={(change) => setVariant(index, change)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {!allDigital && <BackorderAll product={product} update={update} />}
      {context.activeLocations > 1 && !allDigital && (
        <p className="mt-3 text-sm text-muted">
          This store has several stock locations, so the stock here is the total over the active ones. Change it on the{" "}
          <Link href={`/admin/${storeSlug}/inventory`} className="underline">
            Inventory page
          </Link>
          , location by location.
        </p>
      )}
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
  mainCurrency,
  countries,
  showDelivery,
  showPeriod = false,
  showStock,
  stockHref,
  content,
  pictures,
  upload,
  onChange,
}: {
  variant: VariantInput;
  name: string;
  /** What the content's preview needs (unit price, D160); null where a variant cannot have a content (not goods). */
  content: ContentContext | null;
  /** The product's pictures, to choose the variant's from. */
  pictures: ProductInput["media"];
  upload: PictureUpload | null;
  markets: EditorContext["markets"];
  /** What a unit's cost is typed in (D152). */
  mainCurrency: string;
  countries: CountryOption[];
  showDelivery: boolean;
  /** A rental's variants are each booked by the day, half day or hour (D69). */
  showPeriod?: boolean;
  showStock: boolean;
  /** With several active stock locations the number is the total and read-only (wave 3, D172): the link goes to the Inventory page for this SKU. */
  stockHref: string | null;
  onChange: (change: Partial<VariantInput>) => void;
}) {
  const cell = "min-h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
  // Nothing to weigh or send through customs for a download or an appointment.
  const digital = variant.delivery !== "physical";
  const columns = 3 + Number(showDelivery) + Number(showPeriod) + Number(showStock) + markets.length;
  return (
    <>
      <tr className="border-b border-border align-top">
        <th scope="row" className="py-2 pr-3 font-normal">
          <span className="flex items-center gap-2">
            <VariantPicture
              name={name}
              image={variant.image}
              pictures={pictures}
              upload={upload}
              onChange={(image) => onChange({ image })}
            />
            {name}
          </span>
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
        {showPeriod && (
          <td className="py-2 pr-3">
            <select
              value={variant.rentalPeriod}
              onChange={(e) => onChange({ rentalPeriod: e.target.value as VariantInput["rentalPeriod"] })}
              aria-label={`How ${name} is rented`}
              className={`${cell} w-32`}
            >
              <option value="day">Whole days</option>
              <option value="half_day">Half day</option>
              <option value="hour">By the hour</option>
            </select>
          </td>
        )}
        {showStock && (
          <td className="py-2 pr-3">
            {digital ? (
              <span className="inline-flex min-h-9 items-center text-muted">Not needed</span>
            ) : stockHref ? (
              <span className="flex flex-col">
                <span className="inline-flex min-h-9 items-center tabular-nums" aria-label={`Stock for ${name}, the total over the active locations`}>
                  {variant.stock}
                </span>
                <Link href={stockHref} className="text-xs underline underline-offset-2">
                  By location
                </Link>
              </span>
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
          {!digital && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-muted">
                Stock rules for {name}
                {variant.stockPolicy === "continue" && variant.backorderDays ? `: keeps selling, ships within ${variant.backorderDays} ${variant.backorderDays === 1 ? "day" : "days"}` : ""}
                {variant.lowStockThreshold !== null ? `${variant.stockPolicy === "continue" ? ", " : ": "}warns at ${variant.lowStockThreshold} or below` : ""}
              </summary>
              <div className="mt-2">
                <StockRules name={name} variant={variant} cell={cell} onChange={onChange} />
              </div>
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              {digital ? `Barcode and cost for ${name}` : `Barcode, cost, weight, content and customs for ${name}`}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <label className="flex flex-col gap-1 text-xs font-medium">
                Barcode (GTIN/EAN)
                <input
                  inputMode="numeric"
                  value={variant.gtin ?? ""}
                  onChange={(e) => onChange({ gtin: e.target.value || null })}
                  className={cell}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Cost per unit ({mainCurrency}, without VAT)
                <input
                  inputMode="decimal"
                  value={variant.cost}
                  onChange={(e) => onChange({ cost: e.target.value })}
                  placeholder="Not known"
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
              {!digital && content && (
                <ContentFields
                  name={name}
                  variant={variant}
                  context={content}
                  onChange={(measure) => onChange({ measure })}
                />
              )}
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

/**
 * What happens when a variant is sold out and when to warn (wave 3, D172, `docs/wave-3-inventory.md` 2.2): keep selling it on backorder with a stated
 * delivery time, and the stock level at or below which the owners get an email. The days are required with the setting and shoppers see them on the
 * product page, in the cart and in the order; `policyProblem()` holds the same rules on the server and in the database.
 */
function StockRules({ name, variant, cell, onChange }: { name: string; variant: VariantInput; cell: string; onChange: (change: Partial<VariantInput>) => void }) {
  const keeps = variant.stockPolicy === "continue";
  return (
    <fieldset className="flex flex-col gap-2 text-xs">
      <legend className="font-medium">Stock rules for {name}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-start gap-2 font-medium">
          <input
            type="checkbox"
            checked={keeps}
            onChange={(e) => onChange(e.target.checked ? { stockPolicy: "continue", backorderDays: variant.backorderDays ?? 7 } : { stockPolicy: "deny", backorderDays: null })}
            className="mt-0.5 size-4"
          />
          <span>
            Keep selling when sold out
            <span className="block font-normal text-muted">Shoppers can still buy it. The page says it is on backorder and when it is expected to ship.</span>
          </span>
        </label>
        {keeps && (
          <label className="flex flex-col gap-1 font-medium">
            Expected to ship within (days)
            <input
              type="number"
              min={BACKORDER_DAYS_MIN}
              max={BACKORDER_DAYS_MAX}
              inputMode="numeric"
              required
              value={variant.backorderDays ?? ""}
              onChange={(e) => onChange({ backorderDays: e.target.value === "" ? null : Math.floor(Number(e.target.value)) })}
              className={cell}
            />
            <span className="font-normal text-muted">
              {BACKORDER_DAYS_MIN} to {BACKORDER_DAYS_MAX} days, always stated.{backorderMayPassAgreed(variant.backorderDays) ? ` ${BACKORDER_LONG_HINT}` : ""}
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1 font-medium">
          Warn me when stock is at or below
          <input
            type="number"
            min={0}
            max={THRESHOLD_MAX}
            inputMode="numeric"
            value={variant.lowStockThreshold ?? ""}
            onChange={(e) => onChange({ lowStockThreshold: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
            placeholder="No warning"
            className={cell}
          />
          <span className="font-normal text-muted">The owners get one email when the stock goes down to this level, not one for every sale.</span>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * The same setting for every variant that is shipped at once (the product-wide switch of wave 3, D172): on gives every such variant the days typed
 * (keeping a variant's own days when it has them), off stops selling at zero for all of them. The data is per variant; this only sets them together.
 */
function BackorderAll({ product, update }: SectionProps) {
  const shipped = product.variants.filter((v) => v.delivery === "physical");
  const [days, setDays] = useState(() => String(shipped.find((v) => v.backorderDays)?.backorderDays ?? 7));
  if (shipped.length < 2) return null;
  const all = shipped.every((v) => v.stockPolicy === "continue");
  const set = (on: boolean, typed: number | null) =>
    update((p) => ({
      ...p,
      variants: p.variants.map((v) =>
        v.delivery !== "physical" ? v : on ? { ...v, stockPolicy: "continue" as const, backorderDays: typed ?? v.backorderDays ?? 7 } : { ...v, stockPolicy: "deny" as const, backorderDays: null },
      ),
    }));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => set(e.target.checked, Number(days) >= BACKORDER_DAYS_MIN ? Math.floor(Number(days)) : null)} className="size-4" />
        Keep selling every variant when sold out
      </label>
      <label className="flex items-center gap-2">
        Expected to ship within
        <input
          type="number"
          min={BACKORDER_DAYS_MIN}
          max={BACKORDER_DAYS_MAX}
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            const n = Math.floor(Number(e.target.value));
            if (all && n >= BACKORDER_DAYS_MIN && n <= BACKORDER_DAYS_MAX) set(true, n);
          }}
          aria-label="Days until a backordered variant is expected to ship"
          className="min-h-9 w-20 rounded-md border border-border bg-background px-2 text-sm"
        />
        days
      </label>
    </div>
  );
}

/**
 * A variant's picture, shown beside it where shoppers choose a variant:
 * one of the product's pictures, or one uploaded for it.
 */
function VariantPicture({
  name,
  image,
  pictures,
  upload,
  onChange,
}: {
  name: string;
  image: VariantInput["image"];
  pictures: ProductInput["media"];
  upload: PictureUpload | null;
  onChange: (image: VariantInput["image"]) => void;
}) {
  // Where the chooser opens: fixed beside its button, as the variants' table scrolls and would cut it off.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const open = at !== null;
  const setOpen = (next: boolean) => {
    const box = ref.current?.getBoundingClientRect();
    setAt(next && box ? { top: box.bottom + 4, left: Math.min(box.left, window.innerWidth - 272) } : null);
  };
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setAt(null);
    };
    const away = () => setAt(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", away);
    // Scrolling the page (not the chooser's own content) closes it, as it no longer sits by its button.
    const scrolled = (event: Event) => !ref.current?.contains(event.target as Node) && setAt(null);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);

  const choose = (next: VariantInput["image"]) => {
    onChange(next);
    setOpen(false);
  };
  const thumb = "size-10 shrink-0 rounded-md border border-border object-cover";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={image ? `Change the picture for ${name}` : `Choose a picture for ${name}`}
        className="block rounded-md"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- the store's own uploaded picture
          <img src={image.thumbnailUrl ?? image.url} alt="" className={thumb} />
        ) : (
          <span aria-hidden className={`${thumb} flex items-center justify-center border-dashed text-lg text-muted`}>
            +
          </span>
        )}
      </button>
      {at && (
        <div
          style={{ top: at.top, left: at.left }}
          className="fixed z-50 flex w-64 flex-col gap-2 rounded-lg border border-border bg-background p-3 shadow-lg"
        >
          <p className="text-xs font-medium">Picture for {name}</p>
          {pictures.length > 0 ? (
            <ul className="grid grid-cols-4 gap-2">
              {pictures.map((picture, index) => (
                <li key={picture.url}>
                  <button
                    type="button"
                    onClick={() => choose({ url: picture.url, thumbnailUrl: picture.thumbnailUrl })}
                    aria-label={`Picture ${index + 1}`}
                    aria-pressed={image?.url === picture.url}
                    className="block rounded-md aria-pressed:ring-2 aria-pressed:ring-foreground"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- the product's own picture */}
                    <img src={picture.thumbnailUrl ?? picture.url} alt="" className="aspect-square w-full rounded-md object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">The product has no pictures yet.</p>
          )}
          {upload && (
            <label className="w-fit cursor-pointer text-sm underline focus-within:outline-2">
              {busy ? "Uploading …" : "Upload a picture"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="sr-only"
                disabled={busy}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setBusy(true);
                  setProblem(null);
                  const outcome = await upload(file);
                  setBusy(false);
                  if ("url" in outcome) choose(outcome);
                  else setProblem(outcome.problem);
                }}
              />
            </label>
          )}
          {image && (
            <button type="button" onClick={() => choose(null)} className="w-fit text-sm text-muted underline">
              No picture
            </button>
          )}
          {problem && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
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

const INTERVAL_NAMES: Record<PlanInterval, [string, string]> = {
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/** Purchase options for subscribing (D25), like Shopify's selling plans. */
function SubscriptionSection({
  product,
  update,
  markets,
  netPrices,
}: SectionProps & { markets: EditorContext["markets"]; netPrices: boolean }) {
  const setPlan = (index: number, change: Partial<ProductInput["plans"][number]>) =>
    update((p) => ({ ...p, plans: p.plans.map((plan, i) => (i === index ? { ...plan, ...change } : plan)) }));
  const count = (text: string, interval: PlanInterval) =>
    Math.min(MAX_INTERVAL_COUNT[interval], Math.max(1, Math.floor(Number(text) || 1)));
  const addPlan = () =>
    update((p) => {
      // Suggest the next usual rhythm that is not taken yet.
      const taken = new Set(p.plans.map((plan) => `${plan.interval}:${plan.intervalCount}`));
      const next =
        (
          [
            ["month", 1],
            ["month", 2],
            ["week", 2],
            ["month", 3],
            ["year", 1],
          ] as const
        ).find(([interval, n]) => !taken.has(`${interval}:${n}`)) ?? (["month", 6] as const);
      return {
        ...p,
        plans: [
          ...p.plans,
          { id: null, interval: next[0], intervalCount: next[1], discountPercent: 10, trialDays: 0, signupFee: {}, minCycles: 0 },
        ],
      };
    });

  return (
    <section aria-labelledby="subscription-heading" className={card}>
      <h2 id="subscription-heading" className="mb-1 font-medium">
        Subscriptions
      </h2>
      <p className="mb-4 text-sm text-muted">
        Let shoppers subscribe and get the product regularly. Stripe charges each renewal
        automatically, and shoppers can cancel any time from their order page.
      </p>

      {product.plans.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-border rounded-md border border-border">
          {product.plans.map((plan, index) => {
            const [one, many] = INTERVAL_NAMES[plan.interval];
            return (
              <li key={plan.id ?? `new-${index}`} className="flex flex-wrap items-end gap-3 p-3">
                <fieldset>
                  <legend className="mb-1 text-xs font-medium">Renews every</legend>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_INTERVAL_COUNT[plan.interval]}
                      inputMode="numeric"
                      value={plan.intervalCount}
                      onChange={(e) => setPlan(index, { intervalCount: count(e.target.value, plan.interval) })}
                      aria-label={`Purchase option ${index + 1}: how many`}
                      className={`${input} min-h-9 w-20`}
                    />
                    <select
                      value={plan.interval}
                      onChange={(e) => {
                        const interval = e.target.value as PlanInterval;
                        setPlan(index, { interval, intervalCount: Math.min(plan.intervalCount, MAX_INTERVAL_COUNT[interval]) });
                      }}
                      aria-label={`Purchase option ${index + 1}: weeks, months or years`}
                      className={`${input} min-h-9 w-36`}
                    >
                      {(Object.keys(INTERVAL_NAMES) as PlanInterval[]).map((interval) => (
                        <option key={interval} value={interval}>
                          {plan.intervalCount === 1 ? INTERVAL_NAMES[interval][0] : INTERVAL_NAMES[interval][1]}
                        </option>
                      ))}
                    </select>
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  Subscriber discount
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={MAX_DISCOUNT_PERCENT}
                      inputMode="numeric"
                      value={plan.discountPercent}
                      onChange={(e) =>
                        setPlan(index, {
                          discountPercent: Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                        })
                      }
                      className={`${input} min-h-9 w-20`}
                    />
                    <span className="text-sm font-normal">%</span>
                  </span>
                </label>
                <p className="min-h-9 flex-1 self-center text-sm text-muted">
                  Every {plan.intervalCount === 1 ? one : `${plan.intervalCount} ${many}`}
                  {plan.discountPercent > 0 ? `, ${plan.discountPercent}% off each time` : ", full price"}
                  {plan.trialDays > 0 && `, ${plan.trialDays} days free`}
                  {plan.minCycles > 0 && `, at least ${plan.minCycles} payments`}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    update((p) => {
                      const plans = p.plans.filter((_, i) => i !== index);
                      return { ...p, plans, subscriptionOnly: plans.length > 0 && p.subscriptionOnly };
                    })
                  }
                  className="min-h-9 text-sm underline"
                >
                  Remove<span className="sr-only"> purchase option {index + 1}</span>
                </button>
                <details className="w-full" open={plan.trialDays > 0 || plan.minCycles > 0 || Object.values(plan.signupFee).some(Boolean)}>
                  <summary className="cursor-pointer text-xs text-muted">Free trial, sign-up fee and commitment</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs font-medium">
                      <span>
                        Free trial <span className="font-normal text-muted">(days, 0 for none)</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={MAX_TRIAL_DAYS}
                        inputMode="numeric"
                        value={plan.trialDays}
                        onChange={(e) =>
                          setPlan(index, { trialDays: Math.min(MAX_TRIAL_DAYS, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
                        }
                        className={`${input} min-h-9 w-24`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium">
                      <span>
                        Minimum payments <span className="font-normal text-muted">(the first included, 0 for none)</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={MAX_MIN_CYCLES}
                        inputMode="numeric"
                        value={plan.minCycles}
                        onChange={(e) =>
                          setPlan(index, { minCycles: Math.min(MAX_MIN_CYCLES, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
                        }
                        className={`${input} min-h-9 w-24`}
                      />
                    </label>
                    <fieldset className="flex flex-col gap-1 text-xs">
                      <legend className="mb-1 font-medium">
                        Sign-up fee{" "}
                        <span className="font-normal text-muted">({netPrices ? "excl. VAT, " : ""}once, empty for none)</span>
                      </legend>
                      {markets.map((market) => (
                        <label key={market.code} className="flex items-center gap-2">
                          <span className="w-16 text-muted">{market.currency}</span>
                          <input
                            inputMode="decimal"
                            value={plan.signupFee[market.code] ?? ""}
                            onChange={(e) => setPlan(index, { signupFee: { ...plan.signupFee, [market.code]: e.target.value } })}
                            aria-label={`Sign-up fee in ${market.name}, ${market.currency}`}
                            placeholder="0,00"
                            className={`${input} min-h-9 w-28`}
                          />
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  {plan.minCycles > 0 && (
                    <p className="mt-2 text-xs text-muted">
                      Shoppers are told before they subscribe. A cancellation before the commitment is met takes effect
                      when it is.
                    </p>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {product.plans.length < MAX_PLANS && (
          <button
            type="button"
            onClick={addPlan}
            className="min-h-10 rounded-md border border-dashed border-foreground px-4 text-sm font-medium"
          >
            {product.plans.length === 0 ? "Offer a subscription" : "Add another purchase option"}
          </button>
        )}
        {product.plans.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={product.subscriptionOnly}
              onChange={(e) => update((p) => ({ ...p, subscriptionOnly: e.target.checked }))}
              className="size-4"
            />
            Only sell as a subscription (no one-time purchase)
          </label>
        )}
      </div>
      {product.plans.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Subscribers keep the price they signed up at. Changing or removing an option affects
          new subscribers only.
        </p>
      )}
    </section>
  );
}

const PRODUCT_AUDIENCE_LABELS: Record<ProductAudience, { label: string; hint: string }> = {
  all: { label: "Everyone", hint: "Private shoppers and businesses." },
  consumers: { label: "Private shoppers only", hint: "Hidden from shoppers buying for a business." },
  businesses: {
    label: "Businesses only",
    hint: "Shown only to shoppers buying for a business, who give their company's name and organisation number at checkout.",
  },
};

/** Stores selling to both (B2B): whom the product is for. */
function AudienceSection({ product, update }: SectionProps) {
  return (
    <section aria-labelledby="audience-heading" className={card}>
      <fieldset>
        <legend id="audience-heading" className="mb-1 font-medium">
          Customers
        </legend>
        <p className="mb-4 text-sm text-muted">Who sees and can buy the product. Businesses see its prices without VAT.</p>
        <div className="flex flex-col gap-2 text-sm">
          {PRODUCT_AUDIENCES.map((value) => (
            <label key={value} className="flex items-start gap-2">
              <input
                type="radio"
                name="product-audience"
                checked={product.audience === value}
                onChange={() => update((p) => ({ ...p, audience: value }))}
                className="mt-0.5 size-4"
              />
              <span>
                {PRODUCT_AUDIENCE_LABELS[value].label}
                <span className="block text-muted">{PRODUCT_AUDIENCE_LABELS[value].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/** Goods, or an appointment booked for a time (D65). */
function KindSection({ product, update, offered }: SectionProps & { offered: Record<ProductInput["kind"], boolean> }) {
  // Content for the unit price goes with a change to something that is not goods (D160): said once, where it happened.
  const [lostContent, setLostContent] = useState(false);
  const choose = (kind: ProductInput["kind"]) => {
    setLostContent(kind !== "goods" && product.variants.some((v) => v.measure !== null));
    update((p) => {
      const booked = isBooked(kind);
      const delivery = (d: Delivery): Delivery => (booked ? "service" : d === "service" ? "physical" : d);
      return {
        ...p,
        kind,
        appointment: isBooked(kind) ? (p.kind === kind && p.appointment ? p.appointment : defaultBooking(kind)) : null,
        // Rooms and homes take the reduced rate for accommodation where there is one (D65).
        vatCategory: kind === "stay" && p.vatCategory === "standard" ? "accommodation" : p.vatCategory,
        delivery: delivery(p.delivery),
        variants: withoutContentWhereNotGoods(kind, p.variants.map((v) => ({ ...v, delivery: delivery(v.delivery) }))),
        plans: booked ? [] : p.plans,
        subscriptionOnly: booked ? false : p.subscriptionOnly,
        soldByMeasure: kind === "goods" ? p.soldByMeasure : false,
      };
    });
  };
  return (
    <section aria-labelledby="kind-heading" className={card}>
      <fieldset>
        <legend id="kind-heading" className="mb-3 font-medium">
          What is it?
        </legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["goods", "Goods", "Shipped or downloaded"],
              ["appointment", "An appointment", "Booked for a time with your staff"],
              ["stay", "A stay", "Nights in a room or a home"],
              ["rental", "A rental", "Days with an item, such as a bike or a boat"],
            ] as const
          ).filter(([value]) => offered[value]).map(([value, name, note]) => (
            <label
              key={value}
              className="flex min-h-10 min-w-48 flex-1 cursor-pointer items-start gap-2 rounded-md border border-border p-3 has-checked:border-foreground sm:flex-none"
            >
              <input
                type="radio"
                name="kind"
                checked={product.kind === value}
                onChange={() => choose(value)}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="block font-medium">{name}</span>
                <span className="text-muted">{note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {lostContent && (
        <p role="status" className="mt-3 text-sm text-muted">
          The content of its variants was taken away: only shipped goods have a price per kg or litre.
        </p>
      )}
    </section>
  );
}

/** How an appointment is booked (D65): how long, what is kept free around it, when, where and with whom. */
function AppointmentSection({
  storeSlug,
  product,
  update,
  context,
}: SectionProps & { storeSlug: string; context: EditorContext }) {
  const a = product.appointment ?? DEFAULT_APPOINTMENT;
  const set = (change: Partial<AppointmentInput>) => update((p) => ({ ...p, appointment: { ...a, ...change } }));
  const minutes = (text: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(text) || 0)));
  const toggleStaff = (id: string, on: boolean) =>
    set({ resourceIds: on ? [...a.resourceIds, id] : a.resourceIds.filter((r) => r !== id) });
  const people = context.staff.filter((s) => s.kind === "staff");
  return (
    <section aria-labelledby="appointment-heading" className={card}>
      <h2 id="appointment-heading" className="mb-1 font-medium">
        Appointment
      </h2>
      <p className="mb-4 text-sm text-muted">
        Shoppers choose a day and a time within the hours of the staff below; each booking takes one of them.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          Length <span className={hint}>(minutes)</span>
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            value={a.durationMinutes}
            onChange={(e) => set({ durationMinutes: Math.max(5, minutes(e.target.value, 720)) })}
            className={input}
          />
        </label>
        <label className={label}>
          Free before <span className={hint}>(minutes)</span>
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            value={a.bufferBeforeMinutes}
            onChange={(e) => set({ bufferBeforeMinutes: minutes(e.target.value, 240) })}
            className={input}
          />
        </label>
        <label className={label}>
          Free after <span className={hint}>(minutes)</span>
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            value={a.bufferAfterMinutes}
            onChange={(e) => set({ bufferAfterMinutes: minutes(e.target.value, 240) })}
            className={input}
          />
        </label>
        <label className={label}>
          Times offered
          <select
            value={a.stepMinutes}
            onChange={(e) => set({ stepMinutes: Number(e.target.value) as AppointmentInput["stepMinutes"] })}
            className={input}
          >
            {[5, 10, 15, 20, 30, 60].map((step) => (
              <option key={step} value={step}>
                {step === 60 ? "Every hour" : `Every ${step} minutes`}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Notice <span className={hint}>(hours)</span>
          <input
            type="number"
            min={0}
            max={720}
            value={Math.round(a.minNoticeMinutes / 60)}
            onChange={(e) => set({ minNoticeMinutes: minutes(e.target.value, 720) * 60 })}
            className={input}
          />
        </label>
        <label className={label}>
          Booked up to <span className={hint}>(days ahead)</span>
          <input
            type="number"
            min={1}
            max={730}
            value={a.maxDaysAhead}
            onChange={(e) => set({ maxDaysAhead: Math.max(1, minutes(e.target.value, 730)) })}
            className={input}
          />
        </label>
      </div>
      {context.places.length > 0 && (
        <label className={`${label} mt-4 max-w-sm`}>
          Where
          <select value={a.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value || null })} className={input}>
            <option value="">Not said</option>
            {context.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="mt-4 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Who does it</legend>
        {people.length === 0 ? (
          <p className="text-muted">
            No staff yet.{" "}
            <Link href={`/admin/${storeSlug}/bookings/staff/new`} className="underline" target="_blank">
              Add the people who take appointments
            </Link>
            , then come back.
          </p>
        ) : (
          people.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={a.resourceIds.includes(s.id)}
                onChange={(e) => toggleStaff(s.id, e.target.checked)}
                className="size-4"
              />
              {s.name}
              {!s.active && <span className="text-muted">(not taking bookings)</span>}
            </label>
          ))
        )}
      </fieldset>
      <PaymentFields a={a} set={set} where="the appointment" />
    </section>
  );
}


/** How a stay or a rental is booked (D67): check-in and check-out, how many nights or days, and which units. */
function RangeSection({
  storeSlug,
  product,
  update,
  context,
}: SectionProps & { storeSlug: string; context: EditorContext }) {
  const stay = product.kind === "stay";
  const a = product.appointment ?? defaultBooking(stay ? "stay" : "rental");
  const set = (change: Partial<AppointmentInput>) => update((p) => ({ ...p, appointment: { ...a, ...change } }));
  const whole = (text: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(text) || 0)));
  const units = context.staff.filter((s) => s.kind === (stay ? "unit" : "item"));
  const toggle = (id: string, on: boolean) =>
    set({ resourceIds: on ? [...a.resourceIds, id] : a.resourceIds.filter((r) => r !== id) });
  const nights = stay ? "nights" : "days";
  return (
    <section aria-labelledby="range-heading" className={card}>
      <h2 id="range-heading" className="mb-1 font-medium">
        {stay ? "Stay" : "Rental"}
      </h2>
      <p className="mb-4 text-sm text-muted">
        {stay
          ? "Guests choose their arrival and departure dates. The price is per night, and each booking takes one of the rooms or homes below."
          : "Shoppers choose the first and last day, or, for a variant rented by the half day or hour (set under Variants), a day and a time. Each variant's price is per day, half day or hour, and each booking takes one of the items below. Half days split the day between pick-up and return; hours start on the hour from pick-up."}
      </p>
      {context.hosts.length > 0 && (
        <label className={`${label} mb-4 max-w-sm`}>
          Host
          <select
            value={product.hostId ?? ""}
            onChange={(e) => update((p) => ({ ...p, hostId: e.target.value || null }))}
            className={input}
          >
            <option value="">The store itself</option>
            {context.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className={hint}>
            {(() => {
              const chosen = context.hosts.find((h) => h.id === product.hostId);
              if (!chosen) return "Listed for someone else? Choose their host; they then see its bookings and keep its calendar.";
              return chosen.vatRegistered
                ? "Their bookings are paid to them, less your commission. The VAT category above applies."
                : "Their bookings are paid to them, less your commission. They are not VAT registered, so it is sold without VAT.";
            })()}
          </span>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {stay ? "Check-in" : "Pick-up"}
          <input type="time" value={a.checkInTime} onChange={(e) => set({ checkInTime: e.target.value })} className={input} />
        </label>
        <label className={label}>
          {stay ? "Check-out" : "Return"}
          <input type="time" value={a.checkOutTime} onChange={(e) => set({ checkOutTime: e.target.value })} className={input} />
        </label>
        <span />
        <label className={label}>
          Shortest <span className={hint}>({stay ? nights : "whole days"})</span>
          <input
            type="number"
            min={1}
            max={365}
            value={a.minNights}
            onChange={(e) => set({ minNights: whole(e.target.value, 1, 365) })}
            className={input}
          />
        </label>
        <label className={label}>
          Longest <span className={hint}>({stay ? nights : "whole days"})</span>
          <input
            type="number"
            min={1}
            max={365}
            value={a.maxNights}
            onChange={(e) => set({ maxNights: whole(e.target.value, 1, 365) })}
            className={input}
          />
        </label>
        <label className={label}>
          Booked up to <span className={hint}>(days ahead)</span>
          <input
            type="number"
            min={1}
            max={730}
            value={a.maxDaysAhead}
            onChange={(e) => set({ maxDaysAhead: whole(e.target.value, 1, 730) })}
            className={input}
          />
        </label>
        <label className={label}>
          Notice <span className={hint}>(hours before {stay ? "check-in" : "pick-up"})</span>
          <input
            type="number"
            min={0}
            max={720}
            value={Math.round(a.minNoticeMinutes / 60)}
            onChange={(e) => set({ minNoticeMinutes: whole(e.target.value, 0, 720) * 60 })}
            className={input}
          />
        </label>
      </div>
      {context.places.length > 0 && (
        <label className={`${label} mt-4 max-w-sm`}>
          Where
          <select value={a.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value || null })} className={input}>
            <option value="">Not said</option>
            {context.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="mt-4 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{stay ? "Rooms and homes" : "Items"}</legend>
        {units.length === 0 ? (
          <p className="text-muted">
            None yet.{" "}
            <Link href={`/admin/${storeSlug}/bookings/units/new?kind=${stay ? "unit" : "item"}`} className="underline" target="_blank">
              {stay ? "Add the rooms or homes guests stay in" : "Add the items you rent out"}
            </Link>
            , then come back.
          </p>
        ) : (
          units.map((u) => (
            <label key={u.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={a.resourceIds.includes(u.id)}
                onChange={(e) => toggle(u.id, e.target.checked)}
                className="size-4"
              />
              {u.name}
              {!u.active && <span className="text-muted">(not taking bookings)</span>}
            </label>
          ))
        )}
      </fieldset>
      <PricingFields
        a={a}
        set={set}
        stay={stay}
        markets={context.markets}
        businesses={context.audience === "businesses"}
        otherLocales={context.locales.filter((l) => l !== context.primaryLocale)}
      />
      <PaymentFields a={a} set={set} where={stay ? "check-in" : "pick-up"} />
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A day of the year as `MM-DD`, chosen as a month and a day. */
function DayOfYear({ value, onChange, name }: { value: string; onChange: (value: string) => void; name: string }) {
  const [month, day] = value.split("-").map(Number);
  const set = (m: number, d: number) => onChange(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const cell = "min-h-9 rounded-md border border-border bg-background px-2 text-sm";
  return (
    <span className="flex gap-1">
      <input
        type="number"
        min={1}
        max={31}
        value={day}
        onChange={(e) => set(month, Math.max(1, Math.min(31, Math.round(Number(e.target.value) || 1))))}
        aria-label={`${name}: day`}
        className={`${cell} w-16`}
      />
      <select value={month} onChange={(e) => set(Number(e.target.value), day)} aria-label={`${name}: month`} className={cell}>
        {MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * A stay's or rental's fee per booking and its seasons (D70): the fee per
 * market, typed like a price, and seasons that raise or lower the price of
 * the nights or days they cover, every year.
 */
function PricingFields({
  a,
  set,
  stay,
  markets,
  businesses,
  otherLocales,
}: {
  a: AppointmentInput;
  set: (change: Partial<AppointmentInput>) => void;
  stay: boolean;
  markets: EditorContext["markets"];
  businesses: boolean;
  /** The store's languages besides its main one, for each season's name there. */
  otherLocales: string[];
}) {
  const languageName = (locale: string) => new Intl.DisplayNames(["en"], { type: "language" }).of(locale.slice(0, 2)) ?? locale;
  const setSeason = (index: number, change: Partial<SeasonInput>) =>
    set({ seasons: a.seasons.map((season, i) => (i === index ? { ...season, ...change } : season)) });
  const small = "min-h-9 rounded-md border border-border bg-background px-2 text-sm";
  return (
    <>
      <fieldset className="mt-6 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{stay ? "Final cleaning" : "Fee per rental"}</legend>
        <p className="text-muted">
          Added once to each booking, {businesses ? "without" : "with"} VAT at the product&apos;s rate. Leave empty for none.
        </p>
        <div className="flex flex-wrap gap-3">
          {markets.map((market) => (
            <label key={market.code} className={label}>
              <span>
                {market.name} <span className={hint}>({market.currency})</span>
              </span>
              <input
                inputMode="decimal"
                value={a.bookingFee[market.code] ?? ""}
                onChange={(e) => set({ bookingFee: { ...a.bookingFee, [market.code]: e.target.value } })}
                className={`${input} w-32`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6 flex flex-col gap-3 text-sm">
        <legend className="mb-1 font-medium">Seasons</legend>
        <p className="text-muted">
          Raise or lower the price of the {stay ? "nights" : "days"} a season covers, every year. Where seasons meet, both apply,
          one on top of the other (a summer weekend at +30 % and +20 % costs 56 % more). A {stay ? "night" : "day"} counts as the
          weekday it starts.
        </p>
        {a.seasons.map((season, index) => {
          const allYear = season.fromDay === null;
          return (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className={label}>
                  Name
                  <input
                    value={season.name}
                    maxLength={60}
                    onChange={(e) => setSeason(index, { name: e.target.value })}
                    className={`${input} w-44`}
                  />
                </label>
                {otherLocales.map((locale) => (
                  <label key={locale} className={label}>
                    <span>
                      {languageName(locale)} <span className={hint}>(optional)</span>
                    </span>
                    <input
                      value={season.names?.[locale] ?? ""}
                      maxLength={60}
                      lang={locale}
                      placeholder={season.name}
                      onChange={(e) => setSeason(index, { names: { ...season.names, [locale]: e.target.value } })}
                      className={`${input} w-40`}
                    />
                  </label>
                ))}
                <label className={label}>
                  <span>
                    Change <span className={hint}>(%)</span>
                  </span>
                  <input
                    type="number"
                    min={-90}
                    max={500}
                    value={season.percent}
                    onChange={(e) => setSeason(index, { percent: Math.round(Number(e.target.value) || 0) })}
                    className={`${input} w-24`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => set({ seasons: a.seasons.filter((_, i) => i !== index) })}
                  className="min-h-9 rounded-md px-2 underline"
                >
                  Remove <span className="sr-only">{season.name || "season"}</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allYear}
                    onChange={(e) =>
                      setSeason(index, e.target.checked ? { fromDay: null, toDay: null } : { fromDay: "06-15", toDay: "08-15" })
                    }
                    className="size-4"
                  />
                  All year
                </label>
                {!allYear && (
                  <>
                    <span>From</span>
                    <DayOfYear value={season.fromDay!} onChange={(fromDay) => setSeason(index, { fromDay })} name={`${season.name || "Season"} from`} />
                    <span>to</span>
                    <DayOfYear value={season.toDay!} onChange={(toDay) => setSeason(index, { toDay })} name={`${season.name || "Season"} to`} />
                  </>
                )}
              </div>
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Weekdays</legend>
                {WEEKDAYS.map((day, i) => (
                  <label key={day} className={`${small} flex items-center gap-1`}>
                    <input
                      type="checkbox"
                      checked={season.weekdays.includes(i + 1)}
                      onChange={(e) =>
                        setSeason(index, {
                          weekdays: e.target.checked
                            ? [...season.weekdays, i + 1].sort()
                            : season.weekdays.filter((d) => d !== i + 1),
                        })
                      }
                      className="size-4"
                    />
                    {day}
                  </label>
                ))}
              </fieldset>
            </div>
          );
        })}
        {a.seasons.length < 20 && (
          <div>
            <button
              type="button"
              onClick={() =>
                set({
                  seasons: [
                    ...a.seasons,
                    { name: "", names: {}, fromDay: "06-15", toDay: "08-15", weekdays: [1, 2, 3, 4, 5, 6, 7], percent: 20 },
                  ],
                })
              }
              className="min-h-10 rounded-md border border-border px-3"
            >
              Add a season
            </button>
          </div>
        )}
      </fieldset>
    </>
  );
}

/** How a booking is paid and until when shoppers may change it (D66), for every kind of booking. */
function PaymentFields({
  a,
  set,
  where,
}: {
  a: AppointmentInput;
  set: (change: Partial<AppointmentInput>) => void;
  /** "the appointment", "check-in" or "pick-up": when the rest is paid. */
  where: string;
}) {
  const minutes = (text: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(text) || 0)));
  return (
    <fieldset className="mt-6 flex flex-col gap-3 text-sm">
        <legend className="mb-1 font-medium">Payment and cancelling</legend>
        {(
          [
            ["now", "All at booking", "Shoppers pay the whole price when they book."],
            ["deposit", "A deposit at booking", `Part now, the rest at ${where}. The card is saved for a no-show fee.`],
            ["venue", `All at ${where}`, "Nothing to pay online; you mark it paid when they come."],
          ] as const
        ).map(([value, title, text]) => (
          <label key={value} className="flex items-start gap-2">
            <input
              type="radio"
              name="appointment-payment"
              checked={a.payment === value}
              onChange={() => set({ payment: value })}
              className="mt-0.5 size-4"
            />
            <span>
              {title}
              <span className="block text-muted">{text}</span>
            </span>
          </label>
        ))}
        <div className="grid gap-4 sm:grid-cols-3">
          {a.payment === "deposit" && (
            <label className={label}>
              Deposit <span className={hint}>(% of the price)</span>
              <input
                type="number"
                min={1}
                max={99}
                value={a.depositPercent}
                onChange={(e) => set({ depositPercent: Math.max(1, minutes(e.target.value, 99)) })}
                className={input}
              />
            </label>
          )}
          <label className={label}>
            Free cancelling <span className={hint}>(hours before)</span>
            <input
              type="number"
              min={0}
              max={720}
              value={a.cancelHours}
              onChange={(e) => set({ cancelHours: minutes(e.target.value, 720) })}
              className={input}
            />
          </label>
          {a.payment === "deposit" && (
            <label className={label}>
              No-show fee <span className={hint}>(% of the price)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={a.noShowPercent}
                onChange={(e) => set({ noShowPercent: minutes(e.target.value, 100) })}
                className={input}
              />
            </label>
          )}
        </div>
        <p className="text-muted">
          Until then shoppers can cancel or move the booking themselves, and get back what they paid. Later, they
          contact you.
          {a.payment === "deposit" &&
            " A no-show fee is charged only when you ask for it on the booking, less the deposit already paid."}
        </p>
      </fieldset>
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

function LegalSection({
  product,
  update,
  markets,
  vatCategories,
  terms,
  primaryLocale,
}: SectionProps & {
  markets: EditorContext["markets"];
  vatCategories: EditorContext["vatCategories"];
  terms: EditorContext["terms"];
  primaryLocale: string;
}) {
  const general = product.taxCode === GENERAL_TAX_CODE;
  return (
    <section aria-labelledby="legal-heading" className={card}>
      <h2 id="legal-heading" className="mb-4 font-medium">
        Tax, returns and recycling
      </h2>
      <div className="flex flex-col gap-5">
        <VatCategoryField
          category={product.vatCategory}
          kind={product.kind}
          categories={vatCategories}
          markets={markets}
          onChange={(vatCategory) => update((p) => ({ ...p, vatCategory }))}
        />

        {product.kind === "goods" && (
          <SoldByMeasureField
            checked={product.soldByMeasure}
            onChange={(soldByMeasure) => update((p) => ({ ...p, soldByMeasure }))}
            state={contentState(product, terms, primaryLocale)}
          />
        )}

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Tax code for Stripe</legend>
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
