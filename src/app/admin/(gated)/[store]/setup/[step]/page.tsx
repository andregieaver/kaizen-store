import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { BusinessDetailsFields } from "@/components/admin/business-details-fields";
import { CountriesForm } from "@/components/admin/countries-form";
import { FeatureQuestion, type QuestionWarning } from "@/components/admin/feature-question";
import { SetupFrame } from "@/components/admin/setup-frame";
import { StoreDraftsSection } from "@/components/admin/store-drafts-section";
import { AdminTextScope } from "@/components/admin/admin-text";
import { StripeAccountPanel } from "@/components/admin/stripe-account-panel";
import { storeBase, storeHref } from "@/lib/paths";
import { type Membership } from "@/server/auth";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { getPaymentSettings } from "@/server/settings";
import {
  getSetupProgress,
  isSetupStep,
  listStoreProducts,
  setupStepsFor,
  starterTitleOf,
  type SetupProgress,
} from "@/server/setup";
import { featureFacts } from "@/server/store-features";
import { listCountries } from "@/server/stores";
import { storeThemePurchases } from "@/server/theme-prices";

import { answersForFeatures, QUESTION_FEATURES } from "@/lib/onboarding";
import { nextSetupStep, stepApplies } from "@/lib/setup-steps";
import { FEATURES_BY_ID, featureOn, kindFeature, kindOffered } from "@/lib/store-features";
import { featureWarnings } from "@/lib/feature-words";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { setupEn, type SetupMessages } from "@/lib/admin-messages/setup.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { priceText } from "@/lib/theme-prices";
import {
  chooseFeaturesAction,
  openStoreAction,
  removeDemoProductsAction,
  saveCountriesAction,
  saveDetailsAction,
} from "../actions";

type Props = PageProps<"/admin/[store]/setup/[step]">;

// A fixed tab title: one read from the account would stream the metadata into the body (see the sign-in pages, D312 A1).
export const metadata: Metadata = { title: setupEn.title };


export default async function SetupStepPage({ params }: Props) {
  const { store: slug, step } = await params;
  if (!isSetupStep(step)) notFound();
  const member = await requireMemberAny(slug);
  const progress = await getSetupProgress(member.store);

  if (!memberCan(member, "owner")) {
    return (
      <p className="mx-auto max-w-2xl text-sm">
        {fillWords(adminText(adminLangOf(member.account.adminLocale), "setup").ownerOnly, { name: member.store.name })}
      </p>
    );
  }

  // The wizard follows the store's features (D178 step 6): a step the store does not have resumes the wizard where it is.
  if (!stepApplies(step, member.store)) redirect(`/admin/${member.store.slug}/setup`);
  const selling = featureOn(member.store, "shop");
  const w = adminText(adminLangOf(member.account.adminLocale), "setup");
  // The steps named in the account's language: the countries step is "Your country" for a website, as `setupStepsFor()` names it.
  const steps = setupStepsFor(member.store).map((s) => ({ ...s, title: s.id === "countries" && !selling ? w.steps.countriesWebsite : w.steps[s.id] }));
  const frame = { storeSlug: member.store.slug, storeName: member.store.name, steps, step, progress, w: w.frame };

  switch (step) {
    case "features":
      return (
        <SetupFrame
          {...frame}
          title={w.features.title}
          intro={w.features.intro}
        >
          <FeaturesStep member={member} answered={progress.features} w={w} />
          {/* Or let the AI draft the pages from a few sentences (D351): nothing is on the site until the owner publishes. */}
          <div className="mt-8">
            <AdminTextScope texts={adminTexts(adminLangOf(member.account.adminLocale), ["home"])}>
              <Suspense fallback={null}>
                <StoreDraftsSection storeId={member.store.id} storeSlug={member.store.slug} offerStart />
              </Suspense>
            </AdminTextScope>
          </div>
        </SetupFrame>
      );
    case "details":
      return (
        <SetupFrame
          {...frame}
          title={w.details.title}
          intro={w.details.intro}
        >
          <DetailsStep member={member} w={w} />
        </SetupFrame>
      );
    case "countries":
      return (
        <SetupFrame
          {...frame}
          title={selling ? w.countries.title : w.countries.titleWebsite}
          intro={selling ? w.countries.intro : w.countries.introWebsite}
        >
          <CountriesStep member={member} w={w} />
        </SetupFrame>
      );
    case "bookings":
      return (
        <SetupFrame
          {...frame}
          title={w.bookings.title}
          intro={w.bookings.intro}
        >
          <BookingsStep member={member} progress={progress} w={w} />
        </SetupFrame>
      );
    case "payments":
      return (
        <SetupFrame
          {...frame}
          title={w.payments.title}
          intro={w.payments.intro}
        >
          <PaymentsStep member={member} w={w} />
        </SetupFrame>
      );
    case "products":
      return (
        <SetupFrame
          {...frame}
          title={w.products.title}
          intro={w.products.intro}
        >
          <ProductsStep member={member} progress={progress} w={w} />
        </SetupFrame>
      );
    case "launch":
      return (
        <SetupFrame
          {...frame}
          title={w.launch.title}
          intro={w.launch.intro}
        >
          <LaunchStep member={member} progress={progress} w={w} />
        </SetupFrame>
      );
  }
}

const moneyIn = (locale: string) => (minor: number, currency: string) => formatMoney(minor, currency, locale);

async function FeaturesStep({ member, answered, w }: { member: Membership; answered: boolean; w: SetupMessages }) {
  const { store } = member;
  const [facts, starter] = await Promise.all([featureFacts(store.id), starterTitleOf(store)]);
  // What switching off a feature that is on now would mean, for the form's tick (the Features page's confirmation, D178).
  const locale = store.markets[0]?.locale ?? "en";
  const warnings: QuestionWarning[] = QUESTION_FEATURES.filter((id) => featureOn(store, id)).flatMap((id) => {
    const lines = featureWarnings(id, facts, store, moneyIn(locale)).filter((line) => !line.includes("so it stops too") && !line.includes("so they stop too"));
    return lines.length > 0 ? [{ label: FEATURES_BY_ID[id].label, lines }] : [];
  });
  return (
    <FeatureQuestion
      action={chooseFeaturesAction.bind(null, store.slug)}
      answers={answersForFeatures(store)}
      warnings={warnings}
      w={w}
      note={starter && !answered ? fillWords(w.features.fromStarter, { name: starter }) : answered ? w.features.answered : null}
    />
  );
}

async function DetailsStep({ member, w }: { member: Membership; w: SetupMessages }) {
  const { store } = member;
  const countries = await listCountries();
  const d = store.details;
  return (
    <ActionForm action={saveDetailsAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <BusinessDetailsFields name={store.name} details={d} countries={countries} fallbackEmail={member.account.email} w={w.businessFields} />
      <div>
        <SubmitButton>{w.saveAndContinue}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function CountriesStep({ member, w }: { member: Membership; w: SetupMessages }) {
  const { store } = member;
  const countries = await listCountries();
  const several = featureOn(store, "countries");
  return (
    <CountriesForm
      action={saveCountriesAction.bind(null, store.slug)}
      countries={countries}
      chosen={store.keptMarkets.map((m) => m.code)}
      several={several}
      submitLabel={w.saveAndContinue}
      w={w.countriesForm}
      note={
        <p className="text-sm text-muted">
          {featureOn(store, "shop") && w.countries.priceNote}
          {!several && ` ${w.countries.severalNote}`}
        </p>
      }
    />
  );
}

async function PaymentsStep({ member, w }: { member: Membership; w: SetupMessages }) {
  const { store } = member;
  const settings = await getPaymentSettings(store);
  return (
    <div className="flex flex-col gap-4">
      {settings.modes.includes("test") ? (
        <p role="status" className="rounded-md border border-line p-3 text-sm">
          {w.payments.testOn}
        </p>
      ) : (
        <p role="status" className="rounded-md border border-line p-3 text-sm">
          {w.payments.notYet}
        </p>
      )}
      {settings.modes.includes("live") && (
        <AdminTextScope texts={adminTexts(adminLangOf(member.account.adminLocale), ["payments"])}>
          <StripeAccountPanel
            storeSlug={store.slug}
            mode="live"
            account={settings.accounts.live}
            isOwner={memberCan(member, "owner")}
            title={w.payments.realTitle}
            words={adminText(adminLangOf(member.account.adminLocale), "payments").stripe}
          />
        </AdminTextScope>
      )}
      <p className="text-sm text-muted">
        {w.payments.settingsBefore}{" "}
        <Link href={`/admin/${store.slug}/settings/payments`} className="underline">
          {w.payments.settingsLink}
        </Link>
        .
      </p>
      <div>
        <Link
          href={`/admin/${store.slug}/setup/products`}
          className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
        >
          {w.continue}
        </Link>
      </div>
    </div>
  );
}

function BookingsStep({ member, progress, w }: { member: Membership; progress: SetupProgress; w: SetupMessages }) {
  const { store } = member;
  const base = `/admin/${store.slug}`;
  const rows = [
    ...(featureOn(store, "appointments")
      ? [{ done: progress.counts.staff > 0, label: fillWords(w.bookings.staff, { count: progress.counts.staff }), href: `${base}/bookings/staff` }]
      : []),
    ...(featureOn(store, "bookings")
      ? [{ done: progress.counts.units > 0, label: fillWords(w.bookings.units, { count: progress.counts.units }), href: `${base}/bookings/units` }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.href} className="flex items-baseline gap-2">
            <span aria-hidden="true">{row.done ? "✓" : "○"}</span>
            <span className="flex-1">
              <span className="sr-only">{row.done ? w.done : w.notDone}</span>
              {row.label}
            </span>
            <Link href={row.href} className="underline">
              {row.done ? w.bookings.change : w.bookings.setUp}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        {fillWords(w.bookings.timeZone, { zone: store.timeZone })}{" "}
        <Link href={`${base}/settings/features`} className="underline">
          {w.bookings.features}
        </Link>
        .
      </p>
      <div>
        <Link
          href={`${base}/setup/${nextSetupStep("bookings", store)}`}
          className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
        >
          {w.continue}
        </Link>
      </div>
    </div>
  );
}

async function ProductsStep({ member, progress, w }: { member: Membership; progress: SetupProgress; w: SetupMessages }) {
  const { store } = member;
  const products = await listStoreProducts(store);
  return (
    <div className="flex flex-col gap-4">
      {products.length === 0 ? (
        <p className="text-sm">{w.products.none}</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {products.map((product) => (
            <li key={product.handle} className="flex justify-between gap-4 px-3 py-2">
              <span>{product.title}</span>
              <span className="text-muted">
                {product.status !== "active"
                  ? w.products.draft
                  : kindOffered(store, product.kind)
                    ? w.products.published
                    : fillWords(w.products.notShown, { feature: FEATURES_BY_ID[kindFeature(product.kind)!].label })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href={`/admin/${store.slug}/products/new`} className="underline">
          {w.products.addOwn}
        </Link>{" "}
        {w.products.addOwnAfter}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/admin/${store.slug}/setup/launch`}
          className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
        >
          {progress.counts.demoProducts > 0 ? w.products.keep : w.continue}
        </Link>
        {progress.counts.demoProducts > 0 && (
          <ActionForm action={removeDemoProductsAction.bind(null, store.slug)}>
            <SubmitButton variant="secondary">
              {countWords(progress.counts.demoProducts, w.products.remove)}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

async function LaunchStep({ member, progress, w }: { member: Membership; progress: SetupProgress; w: SetupMessages }) {
  // A premium theme live before opening is paid when the store opens (D286): said before the button that opens it.
  const owed = (await storeThemePurchases(member.store.id)).filter((purchase) => purchase.status === "owed");
  const { store } = member;
  // A website (the online shop off, D178) has no checkout or products to set up: it opens with its details and country.
  const selling = featureOn(store, "shop");
  const items = [
    { done: progress.features, label: w.launch.whatYouSell, href: "features", required: false },
    { done: progress.details, label: w.launch.details, href: "details", required: true },
    { done: progress.countries, label: selling ? w.launch.oneCountry : w.launch.yourCountry, href: "countries", required: true },
    ...(stepApplies("bookings", store) ? [{ done: progress.bookings, label: w.launch.bookings, href: "bookings", required: false }] : []),
    ...(selling
      ? [
          { done: progress.paymentsOn, label: w.launch.checkout, href: "payments", required: false },
          {
            done: progress.products,
            label: progress.counts.demoProducts > 0 ? w.launch.demoReplaced : w.launch.products,
            href: "products",
            required: false,
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item.href} className="flex items-baseline gap-2">
            <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
            <span className="flex-1">
              <span className="sr-only">{item.done ? w.done : w.notDone}</span>
              {item.label}
              {!item.required && !item.done && <span className="text-muted">{w.launch.canWait}</span>}
            </span>
            {!item.done && (
              <Link href={`/admin/${store.slug}/setup/${item.href}`} className="underline">
                {w.launch.finish}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {store.setupCompletedAt ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-brand p-4 text-sm">
          <p className="font-medium">
            {selling ? w.launch.openStore : w.launch.openWebsite}
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href={storeHref(store.slug, storeBase(store.slug))} className="underline">
              {w.launch.viewStore}
            </Link>
            <Link href={`/admin/${store.slug}`} className="underline">
              {w.launch.overview}
            </Link>
          </div>
        </div>
      ) : (
        <ActionForm action={openStoreAction.bind(null, store.slug)} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton disabled={!progress.readyToOpen}>{selling ? w.launch.openMyStore : w.launch.openMyWebsite}</SubmitButton>
            <Link href={storeHref(store.slug, storeBase(store.slug))} className="text-sm underline" target="_blank">
              {selling ? w.launch.previewStore : w.launch.previewWebsite}
            </Link>
          </div>
          {!progress.readyToOpen && (
            <p className="text-sm text-muted">{selling ? w.launch.notReadyStore : w.launch.notReadyWebsite}</p>
          )}
          {owed.map((purchase) => (
            <p key={purchase.id} className="text-sm" data-theme-price="">
              {fillWords(w.launch.themeCharge, { theme: purchase.title, price: priceText(purchase.price) })}
            </p>
          ))}
        </ActionForm>
      )}
    </div>
  );
}
