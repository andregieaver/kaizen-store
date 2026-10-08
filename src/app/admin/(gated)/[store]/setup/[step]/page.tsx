import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { BusinessDetailsFields } from "@/components/admin/business-details-fields";
import { CountriesForm } from "@/components/admin/countries-form";
import { FeatureQuestion, type QuestionWarning } from "@/components/admin/feature-question";
import { SetupFrame } from "@/components/admin/setup-frame";
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

import { answersForFeatures, QUESTION_FEATURES } from "@/lib/onboarding";
import { nextSetupStep, stepApplies } from "@/lib/setup-steps";
import { FEATURES_BY_ID, featureOn, featureWarnings, kindFeature, kindOffered } from "@/lib/store-features";
import { formatMoney } from "@/lib/money";
import {
  chooseFeaturesAction,
  openStoreAction,
  removeDemoProductsAction,
  saveCountriesAction,
  saveDetailsAction,
} from "../actions";

type Props = PageProps<"/admin/[store]/setup/[step]">;

export const metadata: Metadata = { title: "Set up your store" };


export default async function SetupStepPage({ params }: Props) {
  const { store: slug, step } = await params;
  if (!isSetupStep(step)) notFound();
  const member = await requireMemberAny(slug);
  const progress = await getSetupProgress(member.store);

  if (!memberCan(member, "owner")) {
    return (
      <p className="mx-auto max-w-2xl text-sm">
        Only an owner can set up {member.store.name}. Ask an owner to finish the setup.
      </p>
    );
  }

  // The wizard follows the store's features (D178 step 6): a step the store does not have resumes the wizard where it is.
  if (!stepApplies(step, member.store)) redirect(`/admin/${member.store.slug}/setup`);
  const steps = setupStepsFor(member.store);
  const frame = { storeSlug: member.store.slug, storeName: member.store.name, steps, step, progress };
  const selling = featureOn(member.store, "shop");

  switch (step) {
    case "features":
      return (
        <SetupFrame
          {...frame}
          title="What will you sell?"
          intro="Kaizen switches on what your store needs and keeps the rest out of your way. You can change all of it later under Settings, Features."
        >
          <FeaturesStep member={member} answered={progress.features} />
        </SetupFrame>
      );
    case "details":
      return (
        <SetupFrame
          {...frame}
          title="Your business"
          intro="Shoppers see these details in the footer, the terms of sale and every order confirmation. The law requires them, so fill in the business that sells, not the platform."
        >
          <DetailsStep member={member} />
        </SetupFrame>
      );
    case "countries":
      return (
        <SetupFrame
          {...frame}
          title={selling ? "Where you sell" : "Your country"}
          intro={
            selling
              ? "Each country gets its own storefront in its own language and currency. You can change this at any time."
              : "Your website is shown in your country's language. You can change this at any time."
          }
        >
          <CountriesStep member={member} />
        </SetupFrame>
      );
    case "bookings":
      return (
        <SetupFrame
          {...frame}
          title="Bookings"
          intro="Shoppers book times with the staff, and stays and rentals in the rooms and items, you set up here. Each has its own opening hours or calendar."
        >
          <BookingsStep member={member} progress={progress} />
        </SetupFrame>
      );
    case "payments":
      return (
        <SetupFrame
          {...frame}
          title="Payments"
          intro={
            <>
              You can test your whole checkout right away. Real payments need your own Stripe
              account, which you set up when you are ready to open.
            </>
          }
        >
          <PaymentsStep member={member} />
        </SetupFrame>
      );
    case "products":
      return (
        <SetupFrame
          {...frame}
          title="Products"
          intro="Your store starts with demo products so you can see how it looks and works. Keep them while you try things out, or remove them now."
        >
          <ProductsStep member={member} progress={progress} />
        </SetupFrame>
      );
    case "launch":
      return (
        <SetupFrame
          {...frame}
          title="Open your store"
          intro="Check what is done. Anything you skipped can be finished later from the overview."
        >
          <LaunchStep member={member} progress={progress} />
        </SetupFrame>
      );
  }
}

const moneyIn = (locale: string) => (minor: number, currency: string) => formatMoney(minor, currency, locale);

async function FeaturesStep({ member, answered }: { member: Membership; answered: boolean }) {
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
      note={
        starter && !answered
          ? `Your store was made from the store template ${starter}, so what it switches on is chosen. Change what you need.`
          : answered
            ? "This is what is switched on now."
            : null
      }
    />
  );
}

async function DetailsStep({ member }: { member: Membership }) {
  const { store } = member;
  const countries = await listCountries();
  const d = store.details;
  return (
    <ActionForm action={saveDetailsAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <BusinessDetailsFields name={store.name} details={d} countries={countries} fallbackEmail={member.account.email} />
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function CountriesStep({ member }: { member: Membership }) {
  const { store } = member;
  const countries = await listCountries();
  const several = featureOn(store, "countries");
  return (
    <CountriesForm
      action={saveCountriesAction.bind(null, store.slug)}
      countries={countries}
      chosen={store.keptMarkets.map((m) => m.code)}
      several={several}
      submitLabel="Save and continue"
      note={
        <p className="text-sm text-muted">
          {featureOn(store, "shop") && "A product shows in a country once it has a price there. The demo products have prices for Norway, Sweden and Denmark."}
          {!several && " To sell in more than one country, switch on Several countries under Settings, Features."}
        </p>
      }
    />
  );
}

async function PaymentsStep({ member }: { member: Membership }) {
  const { store } = member;
  const settings = await getPaymentSettings(store);
  return (
    <div className="flex flex-col gap-4">
      {settings.modes.includes("test") ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Test payments are on, with nothing to set up: Kaizen creates a test Stripe account for your
          store. Try your checkout with the card 4242 4242 4242 4242.
        </p>
      ) : (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Payments are not available on Kaizen yet. You can continue; your store is ready for them.
        </p>
      )}
      {settings.modes.includes("live") && (
        <StripeAccountPanel
          storeSlug={store.slug}
          mode="live"
          account={settings.accounts.live}
          isOwner={memberCan(member, "owner")}
          title="Real payments (when you are ready)"
        />
      )}
      <p className="text-sm text-muted">
        Invoices and payment methods are in{" "}
        <Link href={`/admin/${store.slug}/settings/payments`} className="underline">
          payment settings
        </Link>
        .
      </p>
      <div>
        <Link
          href={`/admin/${store.slug}/setup/products`}
          className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}

function BookingsStep({ member, progress }: { member: Membership; progress: SetupProgress }) {
  const { store } = member;
  const base = `/admin/${store.slug}`;
  const rows = [
    ...(featureOn(store, "appointments")
      ? [{ done: progress.counts.staff > 0, label: `Staff who take appointments (${progress.counts.staff})`, href: `${base}/bookings/staff` }]
      : []),
    ...(featureOn(store, "bookings")
      ? [{ done: progress.counts.units > 0, label: `Rooms and items to book (${progress.counts.units})`, href: `${base}/bookings/units` }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.href} className="flex items-baseline gap-2">
            <span aria-hidden="true">{row.done ? "✓" : "○"}</span>
            <span className="flex-1">
              <span className="sr-only">{row.done ? "Done: " : "Not done: "}</span>
              {row.label}
            </span>
            <Link href={row.href} className="underline">
              {row.done ? "Change" : "Set up"}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Times are shown in the store&apos;s time zone ({store.timeZone}), which you change under{" "}
        <Link href={`${base}/settings/features`} className="underline">
          Settings, Features
        </Link>
        .
      </p>
      <div>
        <Link
          href={`${base}/setup/${nextSetupStep("bookings", store)}`}
          className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}

async function ProductsStep({ member, progress }: { member: Membership; progress: SetupProgress }) {
  const { store } = member;
  const products = await listStoreProducts(store);
  return (
    <div className="flex flex-col gap-4">
      {products.length === 0 ? (
        <p className="text-sm">Your store has no products.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {products.map((product) => (
            <li key={product.handle} className="flex justify-between gap-4 px-3 py-2">
              <span>{product.title}</span>
              <span className="text-muted">
                {product.status !== "active"
                  ? "Draft"
                  : kindOffered(store, product.kind)
                    ? "Published"
                    : `Not shown: ${FEATURES_BY_ID[kindFeature(product.kind)!].label} is off`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href={`/admin/${store.slug}/products/new`} className="underline">
          Add your own product
        </Link>{" "}
        now, or later from Products in the menu.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/admin/${store.slug}/setup/launch`}
          className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          {progress.counts.demoProducts > 0 ? "Keep them for now" : "Continue"}
        </Link>
        {progress.counts.demoProducts > 0 && (
          <ActionForm action={removeDemoProductsAction.bind(null, store.slug)}>
            <SubmitButton variant="secondary">
              Remove the {progress.counts.demoProducts} demo products
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

function LaunchStep({ member, progress }: { member: Membership; progress: SetupProgress }) {
  const { store } = member;
  // A website (the online shop off, D178) has no checkout or products to set up: it opens with its details and country.
  const selling = featureOn(store, "shop");
  const items = [
    { done: progress.features, label: "What you sell", href: "features", required: false },
    { done: progress.details, label: "Business details", href: "details", required: true },
    { done: progress.countries, label: selling ? "At least one country" : "Your country", href: "countries", required: true },
    ...(stepApplies("bookings", store) ? [{ done: progress.bookings, label: "Staff, rooms or items to book", href: "bookings", required: false }] : []),
    ...(selling
      ? [
          { done: progress.paymentsOn, label: "Checkout switched on", href: "payments", required: false },
          {
            done: progress.products,
            label: progress.counts.demoProducts > 0 ? "Demo products replaced" : "Products",
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
              <span className="sr-only">{item.done ? "Done: " : "Not done: "}</span>
              {item.label}
              {!item.required && !item.done && <span className="text-muted"> (can wait)</span>}
            </span>
            {!item.done && (
              <Link href={`/admin/${store.slug}/setup/${item.href}`} className="underline">
                Finish
              </Link>
            )}
          </li>
        ))}
      </ul>
      {store.setupCompletedAt ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-foreground p-4 text-sm">
          <p className="font-medium">
            {selling ? "Your store is open. Share its address with your first customers." : "Your website is open. Share its address with your visitors."}
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href={storeHref(store.slug, storeBase(store.slug))} className="underline">
              View your store
            </Link>
            <Link href={`/admin/${store.slug}`} className="underline">
              Go to the overview
            </Link>
          </div>
        </div>
      ) : (
        <ActionForm action={openStoreAction.bind(null, store.slug)} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton disabled={!progress.readyToOpen}>{selling ? "Open my store" : "Open my website"}</SubmitButton>
            <Link href={storeHref(store.slug, storeBase(store.slug))} className="text-sm underline" target="_blank">
              {selling ? "Preview the storefront" : "Preview the website"}
            </Link>
          </div>
          {!progress.readyToOpen && (
            <p className="text-sm text-muted">Add your business details and a country to open {selling ? "the store" : "the website"}.</p>
          )}
        </ActionForm>
      )}
    </div>
  );
}
