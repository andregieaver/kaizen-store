import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { adminText } from "@/lib/admin-text";
import { ALLOWANCES_OF, LAUNCH_TRIAL_DAYS, type AllowanceKey, type ExtensionId } from "@/lib/extensions";
import { formatMoney } from "@/lib/money";
import { PLAN_INTERVALS, type PlanInterval } from "@/lib/plans";
import { formatPriceInput } from "@/lib/product-input";
import { requirePlatformReader } from "@/server/auth";
import { listPlans } from "@/server/billing";
import { launchPreview, type LaunchPreview } from "@/server/extension-launch";
import {
  extensionCurrencies,
  extensionsLaunchedAt,
  getExtensionCatalogue,
  type CatalogueBundle,
  type CatalogueExtension,
  type ExtensionPrice,
} from "@/server/extensions";

import { launchExtensionsAction, saveBundleAction, saveExtensionAction, savePlanGrantsAction } from "./actions";

export const metadata: Metadata = { title: "Extensions" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const cell = "min-h-9 w-full rounded-md border border-line bg-card px-2 text-sm font-normal";
type W = PlatformMessages["extensions"];

/**
 * Paid extensions (D748 step E2, `docs/extensions.md`): each extension's words and sizes with what they include and their prices, the
 * bundles, and what each plan includes. The platform admin's own screen, beside Plans, Limits and Plan features.
 */
export default async function ExtensionsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").extensions;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [catalogue, plans, currencies, launchedAt] = await Promise.all([getExtensionCatalogue(), listPlans(), extensionCurrencies(), extensionsLaunchedAt()]);
  const columns = plans.filter((plan) => plan.active);
  // The launch's preview is read only until it has happened.
  const preview = launchedAt ? null : await launchPreview();

  return (
    <>
      <PageHeader back={{ href: "/admin/platform/plans", label: w.plans }} title={w.title} description={w.description} />
      {preview ? (
        <LaunchCard preview={preview} catalogue={catalogue.extensions} lang={lang} w={w} />
      ) : (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {launchedAt ? fillWords(w.launched, { date: adminDate(PLATFORM_TIME_ZONE, launchedAt, "long", lang) }) : w.notLaunched}
        </p>
      )}

      {catalogue.extensions.map((extension) => (
        <section key={extension.id} aria-labelledby={`ext-${extension.id}`} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
          <h2 id={`ext-${extension.id}`} className="text-title text-ink">
            {extension.name}
          </h2>
          <ActionForm action={saveExtensionAction.bind(null, extension.id)} className="flex flex-col gap-4">
            <ExtensionFields extension={extension} currencies={currencies} w={w} />
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        </section>
      ))}

      <section aria-labelledby="bundles" className="flex flex-col gap-4">
        <div>
          <h2 id="bundles" className="text-title text-ink">
            {w.bundles}
          </h2>
          <p className="text-sm text-muted">{w.bundlesHint}</p>
        </div>
        {catalogue.bundles.map((bundle) => (
          <div key={bundle.id} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
            <h3 className="font-medium text-ink">{bundle.name}</h3>
            <ActionForm action={saveBundleAction.bind(null, bundle.id)} className="flex flex-col gap-4">
              <BundleFields bundle={bundle} extensions={catalogue.extensions} currencies={currencies} locale={locale} w={w} />
              <div>
                <SubmitButton>{w.save}</SubmitButton>
              </div>
            </ActionForm>
          </div>
        ))}
        <div className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
          <h3 className="font-medium text-ink">{w.newBundle}</h3>
          <ActionForm action={saveBundleAction.bind(null, null)} replaceOnSuccess className="flex flex-col gap-4">
            <BundleFields bundle={null} extensions={catalogue.extensions} currencies={currencies} locale={locale} position={catalogue.bundles.length} w={w} />
            <div>
              <SubmitButton>{w.create}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </section>

      <section aria-labelledby="included" className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
        <div>
          <h2 id="included" className="text-title text-ink">
            {w.included}
          </h2>
          <p className="text-sm text-muted">{w.includedHint}</p>
        </div>
        {columns.length === 0 ? (
          <p className="text-sm text-muted">{w.noPlan}</p>
        ) : (
          <ActionForm action={savePlanGrantsAction} className="flex flex-col gap-4">
            {columns.map((plan) => (
              <fieldset key={plan.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <legend className="float-left mb-1 font-medium text-ink">{plan.name}</legend>
                <div className="clear-left grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  {catalogue.extensions.map((extension) => {
                    const granted = catalogue.grants.find((g) => g.planId === plan.id && g.extensionId === extension.id);
                    const name = `grant:${plan.id}:${extension.id}`;
                    const choices = [
                      { value: "", label: w.notIncluded },
                      ...extension.sizes.filter((size) => size.active || size.id === granted?.sizeId).map((size) => ({ value: size.id, label: size.label })),
                    ];
                    return (
                      <fieldset key={extension.id} className="flex flex-col gap-1 text-sm">
                        <legend className="mb-1 text-muted">{extension.name}</legend>
                        <span className="sr-only">{fillWords(w.includesOf, { plan: plan.name, name: extension.name })}</span>
                        {choices.map((choice) => (
                          <label key={choice.value || "none"} className="flex items-center gap-2">
                            <input type="radio" name={name} value={choice.value} defaultChecked={(granted?.sizeId ?? "") === choice.value} className="size-4" />
                            {choice.label}
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>
    </>
  );
}

const intervalLabel = (w: W, interval: PlanInterval) => (interval === "month" ? w.month : w.year);

/** A price box per currency (rows) and interval (columns), named `{prefix}price:{currency}:{interval}`; an empty box is no price. */
function PriceBoxes({ prefix, prices, currencies, w, label }: { prefix: string; prices: readonly ExtensionPrice[]; currencies: readonly string[]; w: W; label: string }) {
  return (
    <div className="grid w-fit grid-cols-[3rem_repeat(2,7rem)] items-center gap-x-3 gap-y-1 text-sm" role="group" aria-label={`${label}: ${w.price}`}>
      <span />
      {PLAN_INTERVALS.map((interval) => (
        <span key={interval} className="text-muted">
          {intervalLabel(w, interval)}
        </span>
      ))}
      {currencies.map((currency) => [
        <span key={currency} className="font-medium">
          {currency}
        </span>,
        ...PLAN_INTERVALS.map((interval) => {
          const price = prices.find((p) => p.currency === currency && p.interval === interval);
          return (
            <input
              key={`${currency}:${interval}`}
              name={`${prefix}price:${currency}:${interval}`}
              inputMode="decimal"
              aria-label={`${label}: ${fillWords(w.priceIn, { interval: intervalLabel(w, interval), currency })}`}
              defaultValue={price ? formatPriceInput(price.amountMinor, currency) : ""}
              className={cell}
            />
          );
        }),
      ])}
    </div>
  );
}

/** One size: its name and what it includes on a line, whether it is offered, and its prices. The new size (`id` "new") is added only with a name. */
function SizeBlock({
  id,
  label,
  allowances,
  position,
  active,
  prices,
  keys,
  currencies,
  w,
}: {
  id: string;
  label: string;
  allowances: Partial<Record<AllowanceKey, number>>;
  position: number;
  active: boolean | null;
  prices: readonly ExtensionPrice[];
  keys: readonly AllowanceKey[];
  currencies: readonly string[];
  w: W;
}) {
  const prefix = `size:${id}:`;
  const name = label || w.newSize;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
          {active === null ? w.newSize : w.label}
          <input name={`${prefix}label`} defaultValue={label} maxLength={80} placeholder={active === null ? w.newSizeHint : undefined} className={control} />
        </label>
        <input type="hidden" name={`${prefix}position`} value={position} />
        {keys.map((key) => (
          <label key={key} className="flex w-44 flex-col gap-1 text-sm font-medium">
            {w.allowances[key]}
            <input name={`${prefix}allowance:${key}`} inputMode="numeric" defaultValue={allowances[key] ?? ""} aria-label={`${name}: ${w.allowances[key]}`} className={control} />
          </label>
        ))}
        {active !== null && (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name={`${prefix}offered`} defaultChecked={active} aria-label={`${name}: ${w.offered}`} className="size-4" />
            {w.offered}
          </label>
        )}
      </div>
      <PriceBoxes prefix={prefix} prices={prices} currencies={currencies} w={w} label={name} />
    </div>
  );
}

function ExtensionFields({ extension, currencies, w }: { extension: CatalogueExtension; currencies: readonly string[]; w: W }) {
  const keys = ALLOWANCES_OF[extension.id];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_3fr_6rem]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input name="name" required defaultValue={extension.name} maxLength={80} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.line}
          <input name="description" defaultValue={extension.description} maxLength={300} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.order}
          <input name="position" type="number" min={0} defaultValue={extension.position} className={control} />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {extension.storeOnly ? (
          <p className="text-muted">{w.storeOnly}</p>
        ) : (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="standalone" defaultChecked={extension.standalone} className="size-4" />
            {w.standalone}
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={extension.active} className="size-4" />
          {w.offered}
        </label>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.sizes}</legend>
        <p className="text-sm text-muted">
          {w.price}
          {keys.length > 0 ? `. ${w.unlimitedHint}` : ""}
        </p>
        {extension.sizes.map((size) => (
          <SizeBlock key={size.id} id={size.id} label={size.label} allowances={size.allowances} position={size.position} active={size.active} prices={size.prices} keys={keys} currencies={currencies} w={w} />
        ))}
        <SizeBlock id="new" label="" allowances={{}} position={extension.sizes.length} active={null} prices={[]} keys={keys} currencies={currencies} w={w} />
      </fieldset>
    </>
  );
}

function BundleFields({
  bundle,
  extensions,
  currencies,
  locale,
  position = 0,
  w,
}: {
  bundle: CatalogueBundle | null;
  extensions: readonly CatalogueExtension[];
  currencies: readonly string[];
  locale: string;
  position?: number;
  w: W;
}) {
  // What the members cost one by one at their smallest size, a month in the first currency: the bundle's saving at a glance.
  const currency = currencies[0];
  const worth = bundle
    ? bundle.members.reduce<number | null>((sum, id: ExtensionId) => {
        const price = extensions.find((e) => e.id === id)?.sizes.find((s) => s.active)?.prices.find((p) => p.currency === currency && p.interval === "month");
        return sum === null || !price ? null : sum + price.amountMinor;
      }, 0)
    : null;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_3fr_6rem]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input name="name" required defaultValue={bundle?.name ?? ""} maxLength={80} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.line}
          <input name="description" defaultValue={bundle?.description ?? ""} maxLength={300} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.order}
          <input name="position" type="number" min={0} defaultValue={bundle?.position ?? position} className={control} />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{w.holds}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {extensions.map((extension) => (
            <label key={extension.id} className="flex items-center gap-2">
              <input type="checkbox" name={`member:${extension.id}`} defaultChecked={bundle?.members.includes(extension.id) ?? false} className="size-4" />
              {extension.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <PriceBoxes prefix="" prices={bundle?.prices ?? []} currencies={currencies} w={w} label={bundle?.name ?? w.newBundle} />
        {worth !== null && currency && <p className="text-sm text-muted">{fillWords(w.worth, { amount: formatMoney(worth, currency, locale) })}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={bundle?.active ?? true} className="size-4" />
        {w.offered}
      </label>
    </>
  );
}

/** The launch (D748 step E5): what it does, as read now, and its one button behind a box to tick. */
function LaunchCard({ preview, catalogue, lang, w }: { preview: LaunchPreview; catalogue: CatalogueExtension[]; lang: AdminLang; w: W }) {
  const l = w.launch;
  const trials = preview.trials.filter((t) => t.accounts > 0);
  const nameOf = (id: ExtensionId) => catalogue.find((e) => e.id === id)?.name ?? id;
  return (
    <section aria-labelledby="launch" className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
      <h2 id="launch" className="text-title text-ink">
        {l.title}
      </h2>
      <p className="text-sm text-muted">{w.notLaunched}</p>
      <p className="text-sm">{l.lead}</p>
      <p className="text-sm">
        {preview.moving === 0
          ? l.noneMoving
          : fillWords(preview.ending > 0 ? l.moving : l.movingOnly, { count: String(preview.moving), ending: String(preview.ending) })}{" "}
        <Link href="/admin/platform/plans/accounts" className="underline underline-offset-2">
          {l.seeAccounts}
        </Link>
      </p>
      {trials.length > 0 ? (
        <div className="text-sm">
          <p>{fillWords(l.trials, { days: String(LAUNCH_TRIAL_DAYS), date: adminDate(PLATFORM_TIME_ZONE, preview.trialsEnd, "long", lang) })}</p>
          <ul className="mt-1 list-disc pl-5">
            {trials.map((t) => (
              <li key={t.extensionId}>{fillWords(l.trialLine, { name: nameOf(t.extensionId), count: String(t.accounts) })}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm">{l.noTrials}</p>
      )}
      <p className="text-sm text-muted">{l.reminders}</p>
      <ActionForm action={launchExtensionsAction} className="flex flex-col items-start gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="understand" required className="size-4" />
          {l.understand}
        </label>
        <SubmitButton>{l.button}</SubmitButton>
      </ActionForm>
    </section>
  );
}
