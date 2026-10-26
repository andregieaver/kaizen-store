"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
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
  VOUCHER_CATEGORY,
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
import { backorderMayPassAgreed, BACKORDER_DAYS_MAX, BACKORDER_DAYS_MIN, THRESHOLD_MAX } from "@/lib/inventory";
import { lineMax, MAX_ORDER_QUANTITY, ruleProblem } from "@/lib/quantity-rules";
import type { ProductMessages } from "@/lib/admin-messages/product.en";
import type { ProductFacts, WriteRequest, WrittenText } from "@/lib/product-writing";
import { EXCERPT_FIELD_MAX, summarize } from "@/lib/seo";
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
import { BundleSection, NEW_BUNDLE } from "@/components/admin/bundle-section";
import { PriceBreaksSection } from "@/components/admin/price-breaks-section";
import { VatCategoryField } from "@/components/admin/vat-category-field";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { contentState, withoutContentWhereNotGoods } from "@/lib/unit-price-editor";
import { GRID_FROM, filterVariants, setForShown, skuPatternProblem, type GridChange, type VariantFilter } from "@/lib/variant-grid";
import { useVirtualRows } from "@/components/admin/virtual-rows";
import { MAX_MODELS, MAX_VIDEOS, MODEL_MAX_MB, PRODUCT_VIDEO_MAX_MB, pictureItem } from "@/lib/product-media";
import { AddMedia, OtherLanguageWords, kindWords } from "@/components/admin/product-media-tools";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "rounded-lg border border-line bg-card p-5";
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
  const w = useAdminText("product");
  const router = useRouter();
  const [product, setProduct] = useState(props.initial);
  const [context, setContext] = useState(props.context);
  const [dirty, setDirty] = useState(false);
  const [fieldData, setFieldData] = useState(props.fields.data);
  const [variantData, setVariantData] = useState(props.fields.variants?.data ?? {});
  // A variant's fields are drawn only while its section is open: a product of thousands of variants keeps thousands of closed sections (D320).
  const [openFields, setOpenFields] = useState<ReadonlySet<string>>(() => new Set());
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
      const outcome = await saveProductAction(storeSlug, productId, { json: JSON.stringify(payload) });
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
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href={`/admin/${storeSlug}/products`} className="text-sm underline">
            {w.top.products}
          </Link>
          <h1 className="text-xl font-medium">{title || (productId ? w.top.untitled : w.top.newProduct)}</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">{w.top.status}</span>
            <select
              value={product.status}
              onChange={(e) => update((p) => ({ ...p, status: e.target.value as ProductInput["status"] }))}
              className={`${input} w-auto`}
            >
              <option value="draft">{w.top.draft}</option>
              <option value="active">{w.top.published}</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="min-h-10 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-50"
          >
            {saving ? w.top.saving : w.top.save}
          </button>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {(result.status === "saved" || justCreated) && !dirty && (
          <p className="rounded-md border border-line bg-card p-3 text-sm">
            {w.top.saved}{" "}
            {product.status === "active" && props.storefrontPath ? (
              <Link href={`${props.storefrontPath}/p/${product.handle}`} className="underline" target="_blank">
                {w.top.seeInStore}
              </Link>
            ) : (
              w.top.draftsHidden
            )}
            {result.status === "saved" && result.handleChanged && (
              <span className="mt-1 block">
                {addressChangeWords(result.handleChanged)}{" "}
                <Link href={`/admin/${storeSlug}/redirects`} className="underline">
                  {w.top.seeRedirects}
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
          className="rounded-md border border-danger-text bg-card p-4 text-sm"
        >
          <p className="mb-2 font-medium">{w.top.pleaseFix}</p>
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
      <MediaSection
        storeSlug={storeSlug}
        product={product}
        update={update}
        uploads={uploads}
        otherLocales={context.locales.filter((l) => l !== context.primaryLocale)}
        languageNames={languageNames}
      />
      <section aria-labelledby="terms-heading" className={card}>
        <h2 id="terms-heading" className="mb-1 text-title text-ink">
          {w.terms.title}
        </h2>
        <p className="mb-4 text-sm text-muted">{w.terms.intro}</p>
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
            {w.terms.layout}
            <select
              value={product.layoutId ?? ""}
              onChange={(e) => update((p) => ({ ...p, layoutId: e.target.value || null }))}
              className={input}
            >
              <option value="">{w.terms.layoutInherit}</option>
              {context.layouts.map((layout) => (
                <option key={layout.id} value={layout.id}>
                  {layout.title}
                  {layout.published ? "" : w.terms.notPublished}
                </option>
              ))}
            </select>
            <span className={hint}>{w.terms.layoutHint}</span>
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
          <h2 id="variant-fields-heading" className="text-title text-ink">
            {w.variantFields.title}
          </h2>
          {product.variants.map((variant) => {
            const key = variantKey(variant);
            return (
              <details
                key={key}
                className="rounded-panel border border-line bg-card"
                open={product.variants.length === 1}
                onToggle={(e) => {
                  const isOpen = e.currentTarget.open;
                  setOpenFields((was) => {
                    const next = new Set(was);
                    if (isOpen) next.add(key);
                    else next.delete(key);
                    return next;
                  });
                }}
              >
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
                  {variant.sku} <span className="font-normal text-muted">
                    {Object.keys(variant.options).length > 0 ? variantLabel(variant.options) : w.variants.defaultName}
                  </span>
                </summary>
                {(product.variants.length === 1 || openFields.has(key)) && (
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
                    title={fillWords(w.variantFields.fieldsOf, { sku: variant.sku })}
                    intro={w.variantFields.intro}
                    idPrefix={`variant-fields-${key}`}
                  />
                </div>
                )}
              </details>
            );
          })}
        </section>
      )}
      {context.audience === "both" && <AudienceSection product={product} update={update} />}
      {/* The kinds a store's features offer (D178), and the product's own kind as it was loaded, which it keeps while its feature is off. */}
      {/* A bundle (D322) is chosen when a product is made and stays one: a saved product is offered no move into or out of it. */}
      {(productId === null || context.appointmentsOn || context.staysOn || context.giftCardsOn || product.kind !== "goods" || props.initial.kind !== "goods") && (
        <KindSection
          product={product}
          update={update}
          offered={
            productId !== null && props.initial.kind === "bundle"
              ? { goods: false, appointment: false, stay: false, rental: false, gift_card: false, bundle: true }
              : {
                  goods: true,
                  appointment: context.appointmentsOn || props.initial.kind === "appointment",
                  stay: context.staysOn || props.initial.kind === "stay",
                  rental: context.staysOn || props.initial.kind === "rental",
                  gift_card: context.giftCardsOn || props.initial.kind === "gift_card",
                  bundle: productId === null,
                }
          }
        />
      )}
      {product.kind === "appointment" && product.appointment && (
        <AppointmentSection storeSlug={storeSlug} product={product} update={update} context={context} />
      )}
      {(product.kind === "stay" || product.kind === "rental") && product.appointment && (
        <RangeSection storeSlug={storeSlug} product={product} update={update} context={context} />
      )}
      {product.kind === "bundle" ? (
        <BundleSection storeSlug={storeSlug} product={product} update={update} context={context} />
      ) : (
        <VariantsSection
          storeSlug={storeSlug}
          product={product}
          update={update}
          context={context}
          countries={props.countries}
          upload={uploads ? (file) => uploadPicture(storeSlug, file, w.media.unreadable) : null}
        />
      )}
      {(product.kind === "goods" || product.kind === "bundle") && <PriceBreaksSection product={product} update={update} context={context} />}
      {product.kind !== "bundle" && product.variants.some((v) => v.delivery === "digital") && (
        <DigitalSection storeSlug={storeSlug} product={product} update={update} uploads={uploads} />
      )}
      {!isBooked(product.kind) && (
        <>
          {/* Purchase options while Subscriptions is on (D178); off, they are kept as they are and not offered to shoppers. */}
          {product.kind === "bundle" ? null : context.subscriptionsOn ? (
            <SubscriptionSection product={product} update={update} markets={context.markets} netPrices={context.audience === "businesses"} />
          ) : (
            product.plans.length > 0 && (
              <p className="text-sm text-muted">{countWords(product.plans.length, w.subscriptionsOff)}</p>
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
          className="min-h-10 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          {saving ? w.top.saving : w.top.save}
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
  const w = useAdminText("product");
  const [locale, setLocale] = useState(context.primaryLocale);
  const tabsId = useId();
  const current = product.translations.find((t) => t.locale === locale) ?? {
    locale,
    title: "",
    description: "",
    safetyInformation: "",
    seoTitle: "",
    seoDescription: "",
    excerpt: "",
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
    field: "title" | "description" | "safetyInformation" | "seoTitle" | "seoDescription" | "excerpt",
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
      <h2 id="text-heading" className="mb-4 text-title text-ink">
        {w.text.title}
      </h2>
      {context.locales.length > 1 && (
        <div role="tablist" aria-label={w.text.language} className="mb-4 flex flex-wrap gap-1">
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
                className="min-h-9 rounded-pill border border-edge px-3 text-sm aria-selected:border-brand aria-selected:font-medium"
              >
                {languageNames[l] ?? l}
                {!filled && <span className="text-muted">{w.text.empty}</span>}
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
            {fillWords(w.text.leaveEmpty, { language: languageNames[context.primaryLocale] ?? context.primaryLocale })}
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
          {w.text.fieldTitle}
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
          {w.text.description}
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
            {w.text.safety} <span className={hint}>{w.text.safetyHint}</span>
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
              {w.text.address} <span className={hint}>{w.text.addressHint}</span>
            </span>
            <input
              value={product.handle}
              onChange={(e) => {
                onHandleTouched();
                update((p) => ({ ...p, handle: e.target.value.toLowerCase() }));
              }}
              placeholder={slugify(current.title) || w.text.addressPlaceholder}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              spellCheck={false}
              autoCapitalize="none"
              className={`${input} font-mono`}
            />
            <span className={hint}>{w.text.addressRedirect}</span>
          </label>
        )}
        <label className={label}>
          {w.text.excerpt}
          <textarea
            value={current.excerpt}
            maxLength={EXCERPT_FIELD_MAX}
            rows={3}
            onChange={(e) => setField("excerpt", e.target.value)}
            className={`${input} py-2`}
          />
          <span className={hint}>
            {w.text.excerptHintBefore}
            <em>{w.text.excerptTick}</em>
            {w.text.excerptHintAfter}
          </span>
        </label>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-body-strong text-ink">{w.text.search}</h3>
          <p className="text-sm text-muted">{w.text.searchIntro}</p>
          <SearchSnippetFields
            value={{ title: current.seoTitle, description: current.seoDescription }}
            onChange={(next) => {
              if (next.title !== current.seoTitle) setField("seoTitle", next.title);
              if (next.description !== current.seoDescription) setField("seoDescription", next.description);
            }}
            fallback={{
              title: current.title || primaryText?.title || w.text.productTitle,
              description: summarize(current.description || primaryText?.description || ""),
            }}
            url={productUrl}
            lang={locale}
            words={w.seo}
          />
        </div>
      </div>
    </section>
  );
}

/** A picture from the owner's computer, shrunk in the browser (1600 px and a 480 px copy) and uploaded to the store. */
async function uploadPicture(
  storeSlug: string,
  file: File,
  unreadable: string,
): Promise<{ url: string; thumbnailUrl: string } | { problem: string }> {
  try {
    const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
    const data = new FormData();
    const ext = image.type === "image/webp" ? "webp" : "jpg";
    data.set("image", new File([image], `image.${ext}`, { type: image.type }));
    // Its name as it was on the owner's computer, for the media library (D88).
    data.set("name", file.name);
    data.set("thumbnail", new File([thumbnail], `thumb.${ext}`, { type: thumbnail.type }));
    // Compressed until it was as small as it could be while it looked the same (D213).
    data.set("compressed", "1");
    const outcome = await uploadImageAction(storeSlug, data);
    return outcome.ok ? { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl } : { problem: outcome.problem };
  } catch {
    return { problem: fillWords(unreadable, { name: file.name }) };
  }
}

function MediaSection({
  storeSlug,
  product,
  update,
  uploads,
  otherLocales,
  languageNames,
}: SectionProps & { storeSlug: string; uploads: boolean; otherLocales: string[]; languageNames: Record<string, string> }) {
  const w = useAdminText("product");
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setProblem(null);
    const room = MAX_MEDIA - product.media.length;
    for (const file of Array.from(files).slice(0, room)) {
      setBusy((n) => n + 1);
      const outcome = await uploadPicture(storeSlug, file, w.media.unreadable);
      if ("url" in outcome) {
        update((p) => ({ ...p, media: [...p.media, pictureItem(outcome.url, outcome.thumbnailUrl)] }));
      } else {
        setProblem(outcome.problem);
      }
      setBusy((n) => n - 1);
    }
  };

  const patch = (index: number, change: Partial<ProductInput["media"][number]>) =>
    update((p) => ({ ...p, media: p.media.map((m, i) => (i === index ? { ...m, ...change } : m)) }));

  const move = (from: number, to: number) =>
    update((p) => {
      const media = [...p.media];
      const [item] = media.splice(from, 1);
      media.splice(to, 0, item);
      return { ...p, media };
    });

  return (
    <section aria-labelledby="media-heading" className={card}>
      <h2 id="media-heading" className="mb-1 text-title text-ink">
        {w.media.title}
      </h2>
      <p className="mb-1 text-sm text-muted">{w.media.intro}</p>
      <p className="mb-4 text-xs text-muted">
        {fillWords(w.media.limits, { max: MAX_MEDIA, videos: MAX_VIDEOS, videoMb: PRODUCT_VIDEO_MAX_MB, models: MAX_MODELS, modelMb: MODEL_MAX_MB })}
      </p>
      {product.media.length > 0 && (
        <ol className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {product.media.map((media, index) => (
            <li key={`${media.url}:${media.mediaUrl ?? ""}`} className="flex flex-col gap-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file */}
                <img
                  src={media.thumbnailUrl ?? media.url}
                  alt=""
                  className="aspect-square w-full rounded-md border border-line bg-sunken object-cover"
                />
                {kindWords(media, w.media) && (
                  <span className="absolute bottom-2 left-2 rounded-pill bg-inverse px-2 py-0.5 text-caption text-inverse-ink">
                    {kindWords(media, w.media)}
                  </span>
                )}
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {media.kind === "video" ? w.media.describeVideo : media.kind === "model" ? w.media.describeModel : w.media.describe}
                <input
                  value={media.alt}
                  onChange={(e) => patch(index, { alt: e.target.value })}
                  placeholder={w.media.altPlaceholder}
                  className={`${input} min-h-9 text-xs`}
                />
              </label>
              <OtherLanguageWords item={media} locales={otherLocales} names={languageNames} onChange={(alts) => patch(index, { alts })} w={w.media} />
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  className="underline disabled:opacity-30"
                  aria-label={fillWords(w.media.moveEarlier, { n: index + 1 })}
                >
                  {w.media.earlier}
                </button>
                <button
                  type="button"
                  disabled={index === product.media.length - 1}
                  onClick={() => move(index, index + 1)}
                  className="underline disabled:opacity-30"
                  aria-label={fillWords(w.media.moveLater, { n: index + 1 })}
                >
                  {w.media.later}
                </button>
                <button
                  type="button"
                  onClick={() => update((p) => ({ ...p, media: p.media.filter((_, i) => i !== index) }))}
                  className="ml-auto underline"
                  aria-label={fillWords(w.media.removeNth, { n: index + 1 })}
                >
                  {w.media.remove}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {product.media.length < MAX_MEDIA &&
        (uploads ? (
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-dashed border-brand px-4 text-sm font-medium focus-within:outline-2">
            {busy > 0 ? fillWords(w.media.uploading, { n: busy }) : w.media.add}
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
                {w.media.address} <span className={hint}>{w.media.noUploads}</span>
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
                if (!/^https?:\/\/\S+$/.test(link)) return setProblem(w.media.fullAddress);
                setProblem(null);
                update((p) => ({ ...p, media: [...p.media, pictureItem(link, null)] }));
                setLink("");
              }}
              className="min-h-10 rounded-md border border-line px-4 text-sm"
            >
              {w.media.addOne}
            </button>
          </div>
        ))}
      {uploads && product.media.length < MAX_MEDIA && (
        <div className="mt-3">
          <AddMedia
            storeSlug={storeSlug}
            media={product.media}
            onAdd={(item) => update((p) => ({ ...p, media: [...p.media, item] }))}
            uploadPoster={async (file) => {
              const outcome = await uploadPicture(storeSlug, file, w.media.unreadable);
              return "url" in outcome ? outcome : { problem: outcome.problem };
            }}
            words={w.media}
          />
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
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
  minQuantity: 1,
  maxQuantity: null,
  quantityStep: 1,
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
  const w = useAdminText("product");
  const [optionsOn, setOptionsOn] = useState(product.options.length > 0);
  const [drafts, setDrafts] = useState(() => product.options.map((o) => o.values.join(", ")));
  const [mixed, setMixed] = useState(() => new Set(product.variants.map((v) => v.delivery)).size > 1);
  // At scale (wave 6 unit B, D320): a filter per option, and only the rows on screen drawn. A product of a few variants is drawn whole, as before.
  const [filter, setFilter] = useState<VariantFilter>({});
  const large = product.variants.length >= GRID_FROM;
  const shown = useMemo(() => (large ? filterVariants(product.variants, filter) : product.variants.map((_, i) => i)), [large, product.variants, filter]);
  const rowKeys = useMemo(() => shown.map((i) => rowKeyOf(product.variants[i])), [shown, product.variants]);
  const { container: listRef, measure: measureRow, start, end, before, after } = useVirtualRows({ keys: rowKeys, estimate: 96, enabled: large });
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
      <h2 id="variants-heading" className="mb-4 text-title text-ink">
        {allDigital ? w.variants.price : w.variants.priceAndStock}
      </h2>

      <fieldset className="mb-4 flex flex-col gap-2 text-sm" hidden={service}>
        <legend className="mb-1 font-medium">{w.variants.delivered}</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["physical", w.variants.physical, w.variants.physicalNote],
              ["digital", w.variants.digital, w.variants.digitalNote],
            ] as const
          ).map(([value, name, note]) => (
            <label
              key={value}
              className="flex min-h-10 min-w-48 flex-1 cursor-pointer items-start gap-2 rounded-md border border-line p-3 has-checked:border-brand sm:flex-none"
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
            {w.variants.mixed}
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
        {w.variants.hasOptions}
      </label>

      {optionsOn && (
        <fieldset className="mb-5 flex flex-col gap-3 rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-medium">{w.variants.options}</legend>
          {drafts.map((draft, index) => {
            const option = product.options[index] ?? { name: "", values: [] };
            return (
              <div key={index} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <label className={label}>
                  {w.variants.optionName}
                  <input
                    value={option.name}
                    placeholder={index === 0 ? w.variants.optionColour : w.variants.optionSize}
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
                    {w.variants.values} <span className={hint}>{w.variants.valuesHint}</span>
                  </span>
                  <input
                    value={draft}
                    placeholder={index === 0 ? w.variants.valuesColour : w.variants.valuesSize}
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
                  {w.variants.remove}<span className="sr-only">{fillWords(w.variants.removeOption, { name: option.name })}</span>
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
              {w.variants.addOption}
            </button>
          )}
        </fieldset>
      )}

      {product.variants.length > 1 && (
        <VariantGridTools
          product={product}
          filter={filter}
          onFilter={setFilter}
          shown={shown}
          large={large}
          markets={context.markets}
          showStock={!allDigital}
          onSet={(change) => update((p) => ({ ...p, variants: setForShown(p.variants, shown, change, p.handle) }))}
        />
      )}

      <div className="overflow-x-auto">
        <table
          ref={listRef}
          aria-rowcount={large ? shown.length + 1 : undefined}
          className="w-full min-w-[40rem] text-left text-sm"
        >
          <caption className="sr-only">
            {allDigital ? w.variants.captionDigital : w.variants.caption}
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-medium">
                {w.variants.variant}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {w.variants.sku}
              </th>
              {mixed && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  {w.variants.delivery}
                </th>
              )}
              {product.kind === "rental" && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  {w.variants.rentedBy}
                </th>
              )}
              {!allDigital && (
                <th scope="col" className="py-2 pr-3 font-medium">
                  {w.variants.stock}
                  {context.locationName && (
                    <span className="block font-normal text-muted">{context.locationName}</span>
                  )}
                </th>
              )}
              {context.markets.map((market) => (
                <th key={market.code} scope="col" className="py-2 pr-3 font-medium">
                  {market.name}
                  <span className="block font-normal text-muted">
                    {fillWords(context.audience === "businesses" ? w.variants.exclVat : w.variants.inclVat, { currency: market.currency })}
                  </span>
                </th>
              ))}
              <th scope="col" className="py-2 font-medium">
                {w.variants.forSale}
              </th>
            </tr>
          </thead>
          {before > 0 && (
            <tbody aria-hidden="true">
              <tr style={{ height: before }}>
                <td colSpan={99} />
              </tr>
            </tbody>
          )}
          {shown.slice(start, end).map((index, at) => {
              const variant = product.variants[index];
              const name = Object.keys(variant.options).length > 0 ? variantLabel(variant.options) : w.variants.defaultName;
              const key = rowKeys[start + at];
              // Each variant's rows are a body of their own, measured as one while drawn (`useVirtualRows()`).
              return (
                <tbody key={key} ref={large ? measureRow(key) : undefined}>
                <VariantRow
                  variant={variant}
                  rowIndex={large ? start + at + 2 : undefined}
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
                  ruleAll={
                    product.kind === "goods" || product.kind === "bundle"
                      ? (rule) => update((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, ...rule })) }))
                      : null
                  }
                />
                </tbody>
              );
            })}
          {after > 0 && (
            <tbody aria-hidden="true">
              <tr style={{ height: after }}>
                <td colSpan={99} />
              </tr>
            </tbody>
          )}
        </table>
      </div>
      {!allDigital && <BackorderAll product={product} update={update} />}
      {!allDigital && context.shippingProfiles && (
        <ShippingProfileField
          storeSlug={storeSlug}
          value={product.shippingProfileId ?? null}
          profiles={context.shippingProfiles}
          onChange={(shippingProfileId) => update((p) => ({ ...p, shippingProfileId }))}
        />
      )}
      {context.activeLocations > 1 && !allDigital && (
        <p className="mt-3 text-sm text-muted">
          {w.variants.locationsBefore}{" "}
          <Link href={`/admin/${storeSlug}/inventory`} className="underline">
            {w.variants.inventoryPage}
          </Link>
          {w.variants.locationsAfter}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        {allDigital
          ? w.variants.digitalNoStock
          : product.variants.some((v) => v.delivery === "digital")
            ? w.variants.someDigitalNoStock
            : ""}
        {w.variants.pricesNote}
      </p>
    </section>
  );
}

/** A variant's key in the grid: its id once saved, its option values before. */
const rowKeyOf = (variant: VariantInput) => variant.id ?? `new-${JSON.stringify(variant.options)}`;

/**
 * Above the variant table (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.4): from `GRID_FROM` variants a filter per option, and for any product
 * of several variants *Set for all shown*, one step away, which lays only the fields filled in over the variants shown (`setForShown()`).
 */
function VariantGridTools({
  product,
  filter,
  onFilter,
  shown,
  large,
  markets,
  showStock,
  onSet,
}: {
  product: ProductInput;
  filter: VariantFilter;
  onFilter: (filter: VariantFilter) => void;
  shown: number[];
  large: boolean;
  markets: EditorContext["markets"];
  showStock: boolean;
  onSet: (change: GridChange) => void;
}) {
  const w = useAdminText("product");
  const g = w.grid;
  // Counts as the admin's language writes them ("2,048", "2 048").
  const count = new Intl.NumberFormat(ADMIN_LANG_FACTS[useAdminLang()].locale).format;
  const [open, setOpen] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stock, setStock] = useState("");
  const [weight, setWeight] = useState("");
  const [pattern, setPattern] = useState("");
  const [active, setActive] = useState<"" | "yes" | "no">("");
  const [said, setSaid] = useState<string | null>(null);
  const problem = pattern.trim() ? skuPatternProblem(pattern, product.handle, product.variants, shown) : null;
  const reset = () => {
    setPrices({});
    setStock("");
    setWeight("");
    setPattern("");
    setActive("");
  };
  const apply = () => {
    const change: GridChange = {
      prices: Object.fromEntries(Object.entries(prices).filter(([, value]) => value.trim() !== "")),
      ...(stock.trim() !== "" ? { stock: Math.max(0, Math.floor(Number(stock) || 0)) } : {}),
      ...(weight.trim() !== "" && Number(weight) > 0 ? { weightGrams: Math.floor(Number(weight)) } : {}),
      ...(pattern.trim() ? { skuPattern: pattern } : {}),
      ...(active ? { active: active === "yes" } : {}),
    };
    if (Object.keys(change.prices ?? {}).length === 0 && Object.keys(change).length === 1) return setSaid(g.nothing);
    onSet(change);
    reset();
    setOpen(false);
    setSaid(countWords(shown.length, g.done, { n: count(shown.length) }));
  };
  const field = "min-h-9 w-full rounded-md border border-line bg-card px-2 text-sm";
  return (
    <div className="mb-3 flex flex-col gap-3">
      {large && product.options.length > 0 && (
        <fieldset className="flex flex-wrap items-end gap-3 text-sm">
          <legend className="mb-1 font-medium">{g.filterLegend}</legend>
          {product.options.map((option) => (
            <label key={option.name} className="flex flex-col gap-1 text-xs font-medium">
              {option.name}
              <select
                value={filter[option.name] ?? ""}
                onChange={(e) => onFilter({ ...filter, [option.name]: e.target.value })}
                className={`${field} w-44`}
              >
                <option value="">{g.all}</option>
                {option.values.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p role="status" className="min-h-9 self-end py-2 text-xs text-muted">
            {shown.length === 0 ? g.noneShown : fillWords(g.showing, { shown: count(shown.length), total: count(product.variants.length) })}
          </p>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          disabled={shown.length === 0}
          onClick={() => {
            setOpen(!open);
            setSaid(null);
          }}
          className="min-h-9 rounded-pill border border-line px-4 text-sm"
        >
          {fillWords(g.setFor, { n: count(shown.length) })}
        </button>
        {said && !open && (
          <p role="status" className="text-sm">
            {said}
          </p>
        )}
      </div>
      {open && (
        <fieldset className="flex flex-col gap-3 rounded-panel border border-line p-4 text-sm">
          <legend className="px-1 font-medium">{fillWords(g.setTitle, { n: count(shown.length) })}</legend>
          <p className="text-xs text-muted">{g.setHint}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {markets.map((market) => (
              <label key={market.code} className="flex flex-col gap-1 text-xs font-medium">
                {fillWords(g.priceIn, { market: market.name, currency: market.currency })}
                <input
                  inputMode="decimal"
                  value={prices[market.code] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [market.code]: e.target.value })}
                  placeholder="0,00"
                  className={field}
                />
              </label>
            ))}
            {showStock && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                {g.stock}
                <input type="number" min={0} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className={field} />
              </label>
            )}
            {showStock && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                {g.weight}
                <input type="number" min={1} inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium">
              {g.forSale}
              <select value={active} onChange={(e) => setActive(e.target.value as "" | "yes" | "no")} className={field}>
                <option value="">{g.unchanged}</option>
                <option value="yes">{g.yes}</option>
                <option value="no">{g.no}</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {g.skuPattern}
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={g.skuExample}
              aria-describedby="sku-pattern-hint"
              className={`${field} font-mono`}
            />
            <span id="sku-pattern-hint" className="font-normal text-muted">
              {g.skuHint}
            </span>
          </label>
          {(problem || said) && (
            <p role="alert" className="text-sm text-danger-text">
              {problem ? (problem.kind === "unknown" ? fillWords(g.unknownToken, { token: problem.token }) : fillWords(g.repeats, { sku: problem.sku })) : said}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={apply} disabled={problem !== null} className="min-h-9 rounded-pill bg-brand px-4 text-sm text-brand-ink">
              {g.apply}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
                setSaid(null);
              }}
              className="min-h-9 rounded-pill border border-line px-4 text-sm"
            >
              {g.cancel}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function VariantRow({
  variant,
  rowIndex,
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
  ruleAll = null,
}: {
  variant: VariantInput;
  /** How many at a time for every variant (D323): set for goods and bundles, whose variants have a rule; null for any other kind. */
  ruleAll?: ((rule: Pick<VariantInput, "minQuantity" | "maxQuantity" | "quantityStep">) => void) | null;
  /** Its row's place in the whole table while only the rows on screen are drawn (`aria-rowindex`, the header being 1). */
  rowIndex?: number;
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
  const w = useAdminText("product");
  const r = w.row;
  const cell = "min-h-9 w-full rounded-md border border-line bg-card px-2 text-sm";
  // Nothing to weigh or send through customs for a download or an appointment.
  const digital = variant.delivery !== "physical";
  const columns = 3 + Number(showDelivery) + Number(showPeriod) + Number(showStock) + markets.length;
  return (
    <>
      <tr className="border-b border-line align-top" aria-rowindex={rowIndex}>
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
            aria-label={fillWords(r.skuFor, { name })}
            required
            className={`${cell} font-mono`}
          />
        </td>
        {showDelivery && (
          <td className="py-2 pr-3">
            <select
              value={variant.delivery}
              onChange={(e) => onChange({ delivery: e.target.value as Delivery })}
              aria-label={fillWords(r.deliveryFor, { name })}
              className={`${cell} w-32`}
            >
              <option value="physical">{w.variants.physical}</option>
              <option value="digital">{w.variants.digital}</option>
            </select>
          </td>
        )}
        {showPeriod && (
          <td className="py-2 pr-3">
            <select
              value={variant.rentalPeriod}
              onChange={(e) => onChange({ rentalPeriod: e.target.value as VariantInput["rentalPeriod"] })}
              aria-label={fillWords(r.rentedHow, { name })}
              className={`${cell} w-32`}
            >
              <option value="day">{r.wholeDays}</option>
              <option value="half_day">{r.halfDay}</option>
              <option value="hour">{r.byHour}</option>
            </select>
          </td>
        )}
        {showStock && (
          <td className="py-2 pr-3">
            {digital ? (
              <span className="inline-flex min-h-9 items-center text-muted">{r.notNeeded}</span>
            ) : stockHref ? (
              <span className="flex flex-col">
                <span className="inline-flex min-h-9 items-center tabular-nums" aria-label={fillWords(r.stockTotalFor, { name })}>
                  {variant.stock}
                </span>
                <Link href={stockHref} className="text-xs underline underline-offset-2">
                  {r.byLocation}
                </Link>
              </span>
            ) : (
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={variant.stock}
                onChange={(e) => onChange({ stock: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                aria-label={fillWords(r.stockFor, { name })}
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
              aria-label={fillWords(r.priceFor, { market: market.name, name, currency: market.currency })}
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
            aria-label={fillWords(r.forSale, { name })}
            className="size-4"
          />
        </td>
      </tr>
      <tr className="border-b border-line">
        <td colSpan={columns} className="pb-3">
          {!digital && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-muted">
                {fillWords(r.stockRulesFor, { name })}
                {variant.stockPolicy === "continue" && variant.backorderDays ? countWords(variant.backorderDays, r.keepsSelling) : ""}
                {variant.lowStockThreshold !== null
                  ? fillWords(variant.stockPolicy === "continue" ? r.warnsAfter : r.warnsFirst, { n: variant.lowStockThreshold })
                  : ""}
              </summary>
              <div className="mt-2">
                <StockRules name={name} variant={variant} cell={cell} onChange={onChange} />
              </div>
            </details>
          )}
          {ruleAll && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-muted">
                {fillWords(w.quantityRules.summary, { name })}
                {quantityRuleLine(variant, w.quantityRules)}
              </summary>
              <div className="mt-2">
                <QuantityRules name={name} variant={variant} cell={cell} onChange={onChange} onAll={ruleAll} />
              </div>
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              {fillWords(digital ? r.detailsDigital : r.details, { name })}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <label className="flex flex-col gap-1 text-xs font-medium">
                {r.barcode}
                <input
                  inputMode="numeric"
                  value={variant.gtin ?? ""}
                  onChange={(e) => onChange({ gtin: e.target.value || null })}
                  className={cell}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {fillWords(r.cost, { currency: mainCurrency })}
                <input
                  inputMode="decimal"
                  value={variant.cost}
                  onChange={(e) => onChange({ cost: e.target.value })}
                  placeholder={r.notKnown}
                  className={cell}
                />
              </label>
              {!digital && (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    {r.weight}
                    <input
                      type="number"
                      min={1}
                      value={variant.weightGrams ?? ""}
                      onChange={(e) => onChange({ weightGrams: e.target.value ? Math.floor(Number(e.target.value)) : null })}
                      className={cell}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    {r.hsCode}
                    <input
                      inputMode="numeric"
                      value={variant.hsCode ?? ""}
                      onChange={(e) => onChange({ hsCode: e.target.value || null })}
                      className={cell}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    {r.origin}
                    <select
                      value={variant.originCountry ?? ""}
                      onChange={(e) => onChange({ originCountry: e.target.value || null })}
                      className={cell}
                    >
                      <option value="">{r.notSet}</option>
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

/** The rule in a few words after its summary (D323): ": at least 12, in sixes, at most 48", or nothing for one at a time. */
function quantityRuleLine(variant: VariantInput, w: ProductMessages["quantityRules"]): string {
  const parts = [
    variant.minQuantity > variant.quantityStep && fillWords(w.atLeast, { n: variant.minQuantity }),
    variant.quantityStep > 1 && fillWords(w.inSteps, { n: variant.quantityStep }),
    variant.maxQuantity !== null && fillWords(w.atMost, { n: variant.maxQuantity }),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? `: ${parts.join(", ")}` : "";
}

/**
 * How many at a time (wave 6 unit E, D323, `docs/wave-6-catalogue.md` E.1): a line's minimum, maximum and step. *Add to cart* puts in the minimum and
 * then whole steps; the cart refuses a quantity between them. Changing the step moves the minimum and maximum to whole steps, so what is typed is
 * always a rule the database takes (`ruleProblem()` checks it again on save).
 */
function QuantityRules({
  name,
  variant,
  cell,
  onChange,
  onAll,
}: {
  name: string;
  variant: VariantInput;
  cell: string;
  onChange: (change: Partial<VariantInput>) => void;
  onAll: (rule: Pick<VariantInput, "minQuantity" | "maxQuantity" | "quantityStep">) => void;
}) {
  const w = useAdminText("product").quantityRules;
  const whole = (value: string, fallback: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_ORDER_QUANTITY) : fallback;
  };
  const up = (n: number, step: number) => Math.ceil(n / step) * step;
  const setStep = (step: number) =>
    onChange({
      quantityStep: step,
      minQuantity: up(variant.minQuantity, step),
      maxQuantity: variant.maxQuantity === null ? null : Math.max(up(variant.minQuantity, step), up(variant.maxQuantity, step)),
    });
  const problem = ruleProblem({ min: variant.minQuantity, max: variant.maxQuantity, step: variant.quantityStep });
  return (
    <fieldset className="flex flex-col gap-2 text-xs">
      <legend className="font-medium">{fillWords(w.title, { name })}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 font-medium">
          {w.step}
          <input type="number" min={1} max={MAX_ORDER_QUANTITY} inputMode="numeric" value={variant.quantityStep} onChange={(e) => setStep(whole(e.target.value, 1))} className={cell} />
          <span className="font-normal text-muted">{w.stepHint}</span>
        </label>
        <label className="flex flex-col gap-1 font-medium">
          {w.min}
          <input
            type="number"
            min={variant.quantityStep}
            max={MAX_ORDER_QUANTITY}
            step={variant.quantityStep}
            inputMode="numeric"
            value={variant.minQuantity}
            onChange={(e) => onChange({ minQuantity: whole(e.target.value, variant.quantityStep) })}
            className={cell}
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          {w.max}
          <input
            type="number"
            min={variant.minQuantity}
            max={MAX_ORDER_QUANTITY}
            step={variant.quantityStep}
            inputMode="numeric"
            value={variant.maxQuantity ?? ""}
            placeholder={fillWords(w.noMax, { n: lineMax({ min: variant.minQuantity, max: null, step: variant.quantityStep }) })}
            onChange={(e) => onChange({ maxQuantity: e.target.value === "" ? null : whole(e.target.value, variant.minQuantity) })}
            className={cell}
          />
        </label>
      </div>
      {problem && <p className="text-danger-text">{problem}</p>}
      <button
        type="button"
        onClick={() => onAll({ minQuantity: variant.minQuantity, maxQuantity: variant.maxQuantity, quantityStep: variant.quantityStep })}
        className="self-start rounded-pill border border-line px-3 py-1"
      >
        {w.useForAll}
      </button>
    </fieldset>
  );
}

/**
 * What happens when a variant is sold out and when to warn (wave 3, D172, `docs/wave-3-inventory.md` 2.2): keep selling it on backorder with a stated
 * delivery time, and the stock level at or below which the owners get an email. The days are required with the setting and shoppers see them on the
 * product page, in the cart and in the order; `policyProblem()` holds the same rules on the server and in the database.
 */
function StockRules({ name, variant, cell, onChange }: { name: string; variant: VariantInput; cell: string; onChange: (change: Partial<VariantInput>) => void }) {
  const w = useAdminText("product").stockRules;
  const keeps = variant.stockPolicy === "continue";
  return (
    <fieldset className="flex flex-col gap-2 text-xs">
      <legend className="font-medium">{fillWords(w.title, { name })}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-start gap-2 font-medium">
          <input
            type="checkbox"
            checked={keeps}
            onChange={(e) => onChange(e.target.checked ? { stockPolicy: "continue", backorderDays: variant.backorderDays ?? 7 } : { stockPolicy: "deny", backorderDays: null })}
            className="mt-0.5 size-4"
          />
          <span>
            {w.keepSelling}
            <span className="block font-normal text-muted">{w.keepSellingHint}</span>
          </span>
        </label>
        {keeps && (
          <label className="flex flex-col gap-1 font-medium">
            {w.shipWithin}
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
              {fillWords(w.daysRange, { min: BACKORDER_DAYS_MIN, max: BACKORDER_DAYS_MAX })}
              {backorderMayPassAgreed(variant.backorderDays) ? ` ${w.longHint}` : ""}
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1 font-medium">
          {w.warnAt}
          <input
            type="number"
            min={0}
            max={THRESHOLD_MAX}
            inputMode="numeric"
            value={variant.lowStockThreshold ?? ""}
            onChange={(e) => onChange({ lowStockThreshold: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
            placeholder={w.noWarning}
            className={cell}
          />
          <span className="font-normal text-muted">{w.warnHint}</span>
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
  const w = useAdminText("product").backorderAll;
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
        {w.keepSelling}
      </label>
      <label className="flex items-center gap-2">
        {w.shipWithin}
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
          aria-label={w.daysLabel}
          className="min-h-9 w-20 rounded-md border border-line bg-card px-2 text-sm"
        />
        {w.days}
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
  const w = useAdminText("product").picture;
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
  const thumb = "size-10 shrink-0 rounded-md border border-line object-cover";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={fillWords(image ? w.change : w.choose, { name })}
        className="block rounded-pill"
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
          className="fixed z-50 flex w-64 flex-col gap-2 rounded-panel border border-line bg-card p-3 shadow-lg"
        >
          <p className="text-xs font-medium">{fillWords(w.title, { name })}</p>
          {pictures.length > 0 ? (
            <ul className="grid grid-cols-4 gap-2">
              {pictures.map((picture, index) => (
                <li key={picture.url}>
                  <button
                    type="button"
                    onClick={() => choose({ url: picture.url, thumbnailUrl: picture.thumbnailUrl })}
                    aria-label={fillWords(w.nth, { n: index + 1 })}
                    aria-pressed={image?.url === picture.url}
                    className="block rounded-pill aria-pressed:ring-2 aria-pressed:ring-ink"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- the product's own picture */}
                    <img src={picture.thumbnailUrl ?? picture.url} alt="" className="aspect-square w-full rounded-md object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{w.none}</p>
          )}
          {upload && (
            <label className="w-fit cursor-pointer text-sm underline focus-within:outline-2">
              {busy ? w.uploading : w.upload}
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
              {w.noPicture}
            </button>
          )}
          {problem && (
            <p role="alert" className="text-xs text-danger-text">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DigitalSection({ storeSlug, product, update, uploads }: SectionProps & { storeSlug: string; uploads: boolean }) {
  const all = useAdminText("product");
  const w = all.digital;
  const defaultName = all.variants.defaultName;
  const [busy, setBusy] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const digital = product.variants.filter((v) => v.delivery === "digital");
  const several = digital.length > 1;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setProblem(null);
    const room = MAX_FILES - product.files.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setProblem(fillWords(w.atMost, { max: MAX_FILES }));
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
          if (error) return setProblem(fillWords(w.tooLarge, { name: file.name }));
          update((p) => ({
            ...p,
            files: [
              ...p.files,
              { id: null, name: file.name, path: started.path, sizeBytes: file.size, contentType, variantSku: null },
            ],
          }));
        } catch {
          setProblem(fillWords(w.failed, { name: file.name }));
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
      <h2 id="digital-heading" className="mb-1 text-title text-ink">
        {w.title}
      </h2>
      <p className="mb-4 text-sm text-muted">{w.intro}</p>

      {product.files.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-line rounded-md border border-line">
          {product.files.map((file, index) => (
            <li key={file.path} className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium">
                  <span>
                    {w.name} <span className={hint}>({fileSize(file.sizeBytes)})</span>
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
                    {w.deliveredWith}
                    <select
                      value={file.variantSku ?? ""}
                      onChange={(e) => setFile(index, { variantSku: e.target.value || null })}
                      className={`${input} min-h-9`}
                    >
                      <option value="">{w.everyVariant}</option>
                      {digital.map((v) => (
                        <option key={v.sku || variantLabel(v.options)} value={v.sku} disabled={!v.sku}>
                          {Object.keys(v.options).length > 0 ? variantLabel(v.options) : defaultName}
                          {v.sku ? "" : w.addSkuFirst}
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
                {w.remove}
                <span className="sr-only"> {file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploads ? (
        product.files.length < MAX_FILES && (
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-dashed border-brand px-4 text-sm font-medium focus-within:outline-2">
            {busy.length > 0 ? fillWords(w.uploading, { n: busy.length }) : w.add}
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
        <p className="text-sm text-muted">{w.noUploads}</p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {problem}
        </p>
      )}
      {product.files.length > 0 && (
        <p className="mt-2 text-xs text-muted">{w.removeNote}</p>
      )}

      <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <label className={label}>
          <span>
            {w.perFile} <span className={hint}>{w.perFileHint}</span>
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
            {w.days} <span className={hint}>{w.daysHint}</span>
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

const INTERVALS: PlanInterval[] = ["week", "month", "year"];

/** Purchase options for subscribing (D25), like Shopify's selling plans. */
function SubscriptionSection({
  product,
  update,
  markets,
  netPrices,
}: SectionProps & { markets: EditorContext["markets"]; netPrices: boolean }) {
  const w = useAdminText("product").subscriptions;
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
      <h2 id="subscription-heading" className="mb-1 text-title text-ink">
        {w.title}
      </h2>
      <p className="mb-4 text-sm text-muted">{w.intro}</p>

      {product.plans.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-line rounded-md border border-line">
          {product.plans.map((plan, index) => {
            return (
              <li key={plan.id ?? `new-${index}`} className="flex flex-wrap items-end gap-3 p-3">
                <fieldset>
                  <legend className="mb-1 text-xs font-medium">{w.renewsEvery}</legend>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_INTERVAL_COUNT[plan.interval]}
                      inputMode="numeric"
                      value={plan.intervalCount}
                      onChange={(e) => setPlan(index, { intervalCount: count(e.target.value, plan.interval) })}
                      aria-label={fillWords(w.howMany, { n: index + 1 })}
                      className={`${input} min-h-9 w-20`}
                    />
                    <select
                      value={plan.interval}
                      onChange={(e) => {
                        const interval = e.target.value as PlanInterval;
                        setPlan(index, { interval, intervalCount: Math.min(plan.intervalCount, MAX_INTERVAL_COUNT[interval]) });
                      }}
                      aria-label={fillWords(w.whichInterval, { n: index + 1 })}
                      className={`${input} min-h-9 w-36`}
                    >
                      {INTERVALS.map((interval) => (
                        <option key={interval} value={interval}>
                          {plan.intervalCount === 1 ? w.intervals[interval].one : w.intervals[interval].many}
                        </option>
                      ))}
                    </select>
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {w.discount}
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
                  {countWords(plan.intervalCount, w.every[plan.interval])}
                  {plan.discountPercent > 0 ? fillWords(w.percentOff, { n: plan.discountPercent }) : w.fullPrice}
                  {plan.trialDays > 0 && fillWords(w.daysFree, { n: plan.trialDays })}
                  {plan.minCycles > 0 && fillWords(w.atLeast, { n: plan.minCycles })}
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
                  {w.remove}
                  <span className="sr-only">{fillWords(w.removeNth, { n: index + 1 })}</span>
                </button>
                <details className="w-full" open={plan.trialDays > 0 || plan.minCycles > 0 || Object.values(plan.signupFee).some(Boolean)}>
                  <summary className="cursor-pointer text-xs text-muted">{w.more}</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs font-medium">
                      <span>
                        {w.trial} <span className="font-normal text-muted">{w.trialHint}</span>
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
                        {w.minimum} <span className="font-normal text-muted">{w.minimumHint}</span>
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
                        {w.fee}{" "}
                        <span className="font-normal text-muted">{netPrices ? w.feeHintNet : w.feeHint}</span>
                      </legend>
                      {markets.map((market) => (
                        <label key={market.code} className="flex items-center gap-2">
                          <span className="w-16 text-muted">{market.currency}</span>
                          <input
                            inputMode="decimal"
                            value={plan.signupFee[market.code] ?? ""}
                            onChange={(e) => setPlan(index, { signupFee: { ...plan.signupFee, [market.code]: e.target.value } })}
                            aria-label={fillWords(w.feeIn, { market: market.name, currency: market.currency })}
                            placeholder="0,00"
                            className={`${input} min-h-9 w-28`}
                          />
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  {plan.minCycles > 0 && (
                    <p className="mt-2 text-xs text-muted">{w.commitmentNote}</p>
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
            className="min-h-10 rounded-pill border border-dashed border-brand px-4 text-sm font-medium"
          >
            {product.plans.length === 0 ? w.offer : w.addAnother}
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
            {w.only}
          </label>
        )}
      </div>
      {product.plans.length > 0 && (
        <p className="mt-3 text-xs text-muted">{w.keepPrice}</p>
      )}
    </section>
  );
}

/** Stores selling to both (B2B): whom the product is for. */
function AudienceSection({ product, update }: SectionProps) {
  const w = useAdminText("product").audience;
  const labels: Record<ProductAudience, { label: string; hint: string }> = w.choices;
  return (
    <section aria-labelledby="audience-heading" className={card}>
      <fieldset>
        <legend id="audience-heading" className="mb-1 font-medium">
          {w.title}
        </legend>
        <p className="mb-4 text-sm text-muted">{w.intro}</p>
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
                {labels[value].label}
                <span className="block text-muted">{labels[value].hint}</span>
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
  const w = useAdminText("product").kind;
  const [lostContent, setLostContent] = useState(false);
  const choose = (kind: ProductInput["kind"]) => {
    setLostContent(kind !== "goods" && product.variants.some((v) => v.measure !== null));
    update((p) => {
      const booked = isBooked(kind);
      // A gift card's amounts are emailed as a code (D300); leaving the kind, they are shipped until said otherwise.
      const giftCard = kind === "gift_card";
      // A bundle (D322) is one physical variant with no options, stock or content of its own, never subscribed to.
      const bundle = kind === "bundle";
      const delivery = (d: Delivery): Delivery =>
        booked ? "service" : giftCard ? "digital" : d === "service" || p.kind === "gift_card" ? "physical" : d;
      // Rooms and homes take the reduced rate for accommodation where there is one (D65); a gift card no VAT when sold, and only it (D300).
      const vatCategory = giftCard
        ? VOUCHER_CATEGORY
        : p.vatCategory === VOUCHER_CATEGORY
          ? kind === "stay" ? "accommodation" : "standard"
          : kind === "stay" && p.vatCategory === "standard" ? "accommodation" : p.vatCategory;
      const variants = withoutContentWhereNotGoods(kind, p.variants.map((v) => ({ ...v, delivery: delivery(v.delivery) })));
      return {
        ...p,
        kind,
        appointment: isBooked(kind) ? (p.kind === kind && p.appointment ? p.appointment : defaultBooking(kind)) : null,
        vatCategory,
        delivery: bundle ? "physical" : delivery(p.delivery),
        options: bundle ? [] : p.options,
        variants: bundle
          ? variants.slice(0, 1).map((v) => ({ ...v, options: {}, delivery: "physical" as const, stockPolicy: "deny" as const, backorderDays: null }))
          : variants,
        files: bundle ? [] : p.files,
        plans: booked || giftCard || bundle ? [] : p.plans,
        subscriptionOnly: booked || giftCard || bundle ? false : p.subscriptionOnly,
        soldByMeasure: kind === "goods" ? p.soldByMeasure : false,
        bundle: bundle ? (p.bundle ?? NEW_BUNDLE) : null,
      };
    });
  };
  return (
    <section aria-labelledby="kind-heading" className={card}>
      <fieldset>
        <legend id="kind-heading" className="mb-3 font-medium">
          {w.title}
        </legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["goods", w.goods, w.goodsNote],
              ["appointment", w.appointment, w.appointmentNote],
              ["stay", w.stay, w.stayNote],
              ["rental", w.rental, w.rentalNote],
              ["gift_card", w.giftCard, w.giftCardNote],
              ["bundle", w.bundle, w.bundleNote],
            ] as const
          ).filter(([value]) => offered[value]).map(([value, name, note]) => (
            <label
              key={value}
              className="flex min-h-10 min-w-48 flex-1 cursor-pointer items-start gap-2 rounded-md border border-line p-3 has-checked:border-brand sm:flex-none"
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
          {w.lostContent}
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
  const all = useAdminText("product");
  const w = all.appointment;
  return (
    <section aria-labelledby="appointment-heading" className={card}>
      <h2 id="appointment-heading" className="mb-1 text-title text-ink">
        {w.title}
      </h2>
      <p className="mb-4 text-sm text-muted">{w.intro}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {w.length} <span className={hint}>{w.minutes}</span>
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
          {w.before} <span className={hint}>{w.minutes}</span>
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
          {w.after} <span className={hint}>{w.minutes}</span>
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
          {w.times}
          <select
            value={a.stepMinutes}
            onChange={(e) => set({ stepMinutes: Number(e.target.value) as AppointmentInput["stepMinutes"] })}
            className={input}
          >
            {[5, 10, 15, 20, 30, 60].map((step) => (
              <option key={step} value={step}>
                {step === 60 ? w.everyHour : fillWords(w.everyMinutes, { n: step })}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {w.notice} <span className={hint}>{w.hours}</span>
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
          {w.ahead} <span className={hint}>{w.daysAhead}</span>
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
          {w.where}
          <select value={a.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value || null })} className={input}>
            <option value="">{w.notSaid}</option>
            {context.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="mt-4 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{w.who}</legend>
        {people.length === 0 ? (
          <p className="text-muted">
            {w.noStaff}{" "}
            <Link href={`/admin/${storeSlug}/bookings/staff/new`} className="underline" target="_blank">
              {w.addStaff}
            </Link>
            {w.comeBack}
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
              {!s.active && <span className="text-muted">{w.notTaking}</span>}
            </label>
          ))
        )}
      </fieldset>
      <PaymentFields a={a} set={set} where={all.payment.places.appointment} />
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
  const all = useAdminText("product");
  const w = all.range;
  return (
    <section aria-labelledby="range-heading" className={card}>
      <h2 id="range-heading" className="mb-1 text-title text-ink">
        {stay ? w.stay : w.rental}
      </h2>
      <p className="mb-4 text-sm text-muted">
        {stay ? w.stayIntro : w.rentalIntro}
      </p>
      {context.hosts.length > 0 && (
        <label className={`${label} mb-4 max-w-sm`}>
          {w.host}
          <select
            value={product.hostId ?? ""}
            onChange={(e) => update((p) => ({ ...p, hostId: e.target.value || null }))}
            className={input}
          >
            <option value="">{w.storeItself}</option>
            {context.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className={hint}>
            {(() => {
              const chosen = context.hosts.find((h) => h.id === product.hostId);
              if (!chosen) return w.hostHint;
              return chosen.vatRegistered ? w.hostVat : w.hostNoVat;
            })()}
          </span>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {stay ? w.checkIn : w.pickUp}
          <input type="time" value={a.checkInTime} onChange={(e) => set({ checkInTime: e.target.value })} className={input} />
        </label>
        <label className={label}>
          {stay ? w.checkOut : w.return}
          <input type="time" value={a.checkOutTime} onChange={(e) => set({ checkOutTime: e.target.value })} className={input} />
        </label>
        <span />
        <label className={label}>
          {w.shortest} <span className={hint}>{stay ? w.nights : w.wholeDays}</span>
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
          {w.longest} <span className={hint}>{stay ? w.nights : w.wholeDays}</span>
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
          {all.appointment.ahead} <span className={hint}>{all.appointment.daysAhead}</span>
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
          {all.appointment.notice} <span className={hint}>{stay ? w.noticeCheckIn : w.noticePickUp}</span>
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
          {all.appointment.where}
          <select value={a.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value || null })} className={input}>
            <option value="">{all.appointment.notSaid}</option>
            {context.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="mt-4 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{stay ? w.units : w.items}</legend>
        {units.length === 0 ? (
          <p className="text-muted">
            {w.noneYet}{" "}
            <Link href={`/admin/${storeSlug}/bookings/units/new?kind=${stay ? "unit" : "item"}`} className="underline" target="_blank">
              {stay ? w.addUnits : w.addItems}
            </Link>
            {all.appointment.comeBack}
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
              {!u.active && <span className="text-muted">{all.appointment.notTaking}</span>}
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
      <PaymentFields a={a} set={set} where={stay ? all.payment.places.checkIn : all.payment.places.pickUp} />
    </section>
  );
}

/** A day of the year as `MM-DD`, chosen as a month and a day. */
function DayOfYear({ value, onChange, name }: { value: string; onChange: (value: string) => void; name: string }) {
  const w = useAdminText("product").pricing;
  const [month, day] = value.split("-").map(Number);
  const set = (m: number, d: number) => onChange(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const cell = "min-h-9 rounded-md border border-line bg-card px-2 text-sm";
  return (
    <span className="flex gap-1">
      <input
        type="number"
        min={1}
        max={31}
        value={day}
        onChange={(e) => set(month, Math.max(1, Math.min(31, Math.round(Number(e.target.value) || 1))))}
        aria-label={fillWords(w.dayOf, { name })}
        className={`${cell} w-16`}
      />
      <select value={month} onChange={(e) => set(Number(e.target.value), day)} aria-label={fillWords(w.monthOf, { name })} className={cell}>
        {w.months.map((label, i) => (
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
  const w = useAdminText("product").pricing;
  const lang = useAdminLang();
  const languageName = (locale: string) =>
    new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].tag], { type: "language" }).of(locale.slice(0, 2)) ?? locale;
  const setSeason = (index: number, change: Partial<SeasonInput>) =>
    set({ seasons: a.seasons.map((season, i) => (i === index ? { ...season, ...change } : season)) });
  const small = "min-h-9 rounded-pill border border-edge bg-card px-2 text-sm";
  return (
    <>
      <fieldset className="mt-6 flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{stay ? w.cleaning : w.feePerRental}</legend>
        <p className="text-muted">{businesses ? w.feeHintNet : w.feeHint}</p>
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
        <legend className="mb-1 font-medium">{w.seasons}</legend>
        <p className="text-muted">{stay ? w.seasonsStay : w.seasonsRental}</p>
        {a.seasons.map((season, index) => {
          const allYear = season.fromDay === null;
          return (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className={label}>
                  {w.name}
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
                      {languageName(locale)} <span className={hint}>{w.optional}</span>
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
                    {w.change} <span className={hint}>(%)</span>
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
                  className="min-h-9 rounded-pill px-2 underline"
                >
                  {w.remove} <span className="sr-only">{season.name || w.season}</span>
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
                  {w.allYear}
                </label>
                {!allYear && (
                  <>
                    <span>{w.from}</span>
                    <DayOfYear
                      value={season.fromDay!}
                      onChange={(fromDay) => setSeason(index, { fromDay })}
                      name={fillWords(w.fromOf, { name: season.name || w.seasonName })}
                    />
                    <span>{w.to}</span>
                    <DayOfYear
                      value={season.toDay!}
                      onChange={(toDay) => setSeason(index, { toDay })}
                      name={fillWords(w.toOf, { name: season.name || w.seasonName })}
                    />
                  </>
                )}
              </div>
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">{w.weekdays}</legend>
                {w.weekdayNames.map((day, i) => (
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
              className="min-h-10 rounded-md border border-line px-3"
            >
              {w.add}
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
  const w = useAdminText("product").payment;
  const minutes = (text: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(text) || 0)));
  return (
    <fieldset className="mt-6 flex flex-col gap-3 text-sm">
        <legend className="mb-1 font-medium">{w.title}</legend>
        {(
          [
            ["now", w.now, w.nowNote],
            ["deposit", w.deposit, fillWords(w.depositNote, { where })],
            ["venue", fillWords(w.venue, { where }), w.venueNote],
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
              {w.depositPercent} <span className={hint}>{w.ofPrice}</span>
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
            {w.cancel} <span className={hint}>{w.hoursBefore}</span>
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
              {w.noShow} <span className={hint}>{w.ofPrice}</span>
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
          {w.untilThen}
          {a.payment === "deposit" && w.noShowNote}
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
  const w = useAdminText("product").safety;
  return (
    <section aria-labelledby="safety-heading" className={card}>
      <h2 id="safety-heading" className="mb-1 text-title text-ink">
        {w.title}
      </h2>
      <p className="mb-4 text-sm text-muted">
        {product.variants.every((v) => v.delivery === "digital") ? w.digital : w.rules}
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        <OperatorPicker
          legend={w.manufacturer}
          choice={product.manufacturer}
          operators={operators}
          countries={countries}
          onChange={(manufacturer) => update((p) => ({ ...p, manufacturer }))}
        />
        <OperatorPicker
          legend={w.responsible}
          note={w.responsibleNote}
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
  const w = useAdminText("product").safety;
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
        <option value="">{w.none}</option>
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.country})
          </option>
        ))}
        <option value="new">{w.addCompany}</option>
      </select>
      {fresh && (
        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <label className={label}>
            {w.companyName}
            <input value={fresh.name} onChange={(e) => setNew({ name: e.target.value })} className={input} />
          </label>
          <label className={label}>
            {w.postalAddress}
            <textarea
              value={fresh.postalAddress}
              onChange={(e) => setNew({ postalAddress: e.target.value })}
              rows={2}
              className={`${input} py-2`}
            />
          </label>
          <label className={label}>
            {w.electronic}
            <input
              value={fresh.electronicAddress}
              onChange={(e) => setNew({ electronicAddress: e.target.value })}
              className={input}
            />
          </label>
          <label className={label}>
            {w.country}
            <select value={fresh.country} onChange={(e) => setNew({ country: e.target.value })} className={input}>
              <option value="">{w.choose}</option>
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
  const all = useAdminText("product");
  const w = all.legal;
  const general = product.taxCode === GENERAL_TAX_CODE;
  return (
    <section aria-labelledby="legal-heading" className={card}>
      <h2 id="legal-heading" className="mb-4 text-title text-ink">
        {w.title}
      </h2>
      <div className="flex flex-col gap-5">
        <VatCategoryField
          category={product.vatCategory}
          kind={product.kind}
          categories={vatCategories}
          markets={markets}
          onChange={(vatCategory) => update((p) => ({ ...p, vatCategory }))}
          words={all.vatCategory}
        />

        {product.kind === "goods" && (
          <SoldByMeasureField
            checked={product.soldByMeasure}
            onChange={(soldByMeasure) => update((p) => ({ ...p, soldByMeasure }))}
            state={contentState(product, terms, primaryLocale, all.unitPrice.editor)}
          />
        )}

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{w.taxCode}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={general}
              onChange={() => update((p) => ({ ...p, taxCode: GENERAL_TAX_CODE }))}
            />
            {w.general}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!general}
              onChange={() => update((p) => ({ ...p, taxCode: "" }))}
            />
            {w.other}
          </label>
          {!general && (
            <label className={`${label} pl-6`}>
              <span>
                {w.stripeCode}{" "}
                <a
                  href="https://docs.stripe.com/tax/tax-codes"
                  target="_blank"
                  rel="noreferrer"
                  className="font-normal underline"
                >
                  {w.findCode}
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
          {w.withdrawal}
          <select
            value={product.withdrawalExclusion}
            onChange={(e) => update((p) => ({ ...p, withdrawalExclusion: e.target.value }))}
            className={input}
          >
            {WITHDRAWAL_EXCLUSIONS.map((exclusion) => (
              <option key={exclusion.id} value={exclusion.id}>
                {w.exclusions[exclusion.id]}
              </option>
            ))}
          </select>
          <span className={hint}>
            {w.withdrawalHint}
            {product.variants.some((v) => v.delivery === "digital") && w.withdrawalDownloads}
          </span>
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">{w.schemes}</legend>
          <p className="mb-2 text-muted">{w.schemesHint}</p>
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
                {w.schemeNames[scheme.id]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

/**
 * The product's shipping profile (D237, `docs/wave-3-shipping-methods.md` 2.1): which rates of the store's shipping methods price it. General (no
 * profile) is the default; the profiles themselves are made under Settings, Shipping, Profiles.
 */
function ShippingProfileField({
  storeSlug,
  value,
  profiles,
  onChange,
}: {
  storeSlug: string;
  value: string | null;
  profiles: { id: string; name: string }[];
  onChange: (id: string | null) => void;
}) {
  const w = useAdminText("product").shipping;
  return (
    <label className="mt-4 flex max-w-md flex-col gap-1 text-sm">
      <span className="font-medium">{w.profile}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="min-h-10 rounded-md border border-line bg-card px-3">
        <option value="">{w.general}</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="text-muted">
        {w.hint}{" "}
        <Link href={`/admin/${storeSlug}/settings/shipping/profiles`} className="underline">
          {w.profiles}
        </Link>
      </span>
    </label>
  );
}
