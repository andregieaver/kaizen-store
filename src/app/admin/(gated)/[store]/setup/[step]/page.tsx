import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SetupFrame } from "@/components/admin/setup-frame";
import { StripeKeysForm } from "@/components/admin/stripe-keys-form";
import { storeBase } from "@/lib/paths";
import { requireMember, type Membership } from "@/server/auth";
import { getPaymentSettings } from "@/server/settings";
import {
  getSetupProgress,
  isSetupStep,
  listStoreProducts,
  SETUP_STEPS,
  type SetupProgress,
} from "@/server/setup";
import { listCountries } from "@/server/stores";

import {
  openStoreAction,
  removeDemoProductsAction,
  saveCountriesAction,
  saveDetailsAction,
} from "../actions";

type Props = PageProps<"/admin/[store]/setup/[step]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { step } = await params;
  const found = SETUP_STEPS.find((s) => s.id === step);
  return { title: found ? `Setup: ${found.title}` : "Setup" };
}

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

export default async function SetupStepPage({ params }: Props) {
  const { store: slug, step } = await params;
  if (!isSetupStep(step)) notFound();
  const member = await requireMember(slug);
  const progress = await getSetupProgress(member.store);

  if (member.role !== "owner") {
    return (
      <p className="mx-auto max-w-2xl text-sm">
        Only an owner can set up {member.store.name}. Ask an owner to finish the setup.
      </p>
    );
  }

  const frame = { storeSlug: member.store.slug, storeName: member.store.name, step, progress };

  switch (step) {
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
          title="Where you sell"
          intro="Each country gets its own storefront in its own language and currency. You can change this at any time."
        >
          <CountriesStep member={member} />
        </SetupFrame>
      );
    case "payments":
      return (
        <SetupFrame
          {...frame}
          title="Payments"
          intro={
            <>
              Payments go through Stripe, straight to your own Stripe account. Start with test keys:
              they take no real money, so you can try the whole checkout safely.{" "}
              <a href="https://dashboard.stripe.com/register" className="underline" target="_blank" rel="noreferrer">
                Create a Stripe account
              </a>{" "}
              if you do not have one.
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

async function DetailsStep({ member }: { member: Membership }) {
  const { store } = member;
  const countries = await listCountries();
  const d = store.details;
  return (
    <ActionForm action={saveDetailsAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <label className={field}>
        Store name
        <input name="name" required maxLength={80} defaultValue={store.name} className={control} />
        <span className="font-normal text-muted">Shown at the top of every page.</span>
      </label>
      <label className={field}>
        Legal name of the business
        <input
          name="legalName"
          required
          autoComplete="organization"
          defaultValue={d.legalName ?? ""}
          placeholder="Kari Nordmann AS"
          className={control}
        />
      </label>
      <label className={field}>
        <span>
          Organisation number <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          name="organisationNumber"
          defaultValue={d.organisationNumber ?? ""}
          placeholder="123 456 789"
          className={control}
        />
      </label>
      <label className={field}>
        Contact email for shoppers
        <input
          type="email"
          name="contactEmail"
          required
          autoComplete="email"
          defaultValue={d.contactEmail ?? member.account.email}
          className={control}
        />
      </label>
      <label className={field}>
        Business address
        <textarea
          name="postalAddress"
          required
          rows={3}
          autoComplete="street-address"
          defaultValue={d.postalAddress ?? ""}
          placeholder={"Storgata 1\n0155 Oslo"}
          className={`${control} py-2`}
        />
      </label>
      <label className={field}>
        Country the business is registered in
        <select name="country" defaultValue={d.country ?? "NO"} className={control}>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function CountriesStep({ member }: { member: Membership }) {
  const { store } = member;
  const countries = await listCountries();
  const active = new Set(store.markets.map((m) => m.code));
  return (
    <ActionForm action={saveCountriesAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Countries you sell to</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {countries.map((country) => (
            <li key={country.code}>
              <label className="flex min-h-10 items-center gap-3 rounded-md border border-border px-3 text-sm has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="country"
                  value={country.code}
                  defaultChecked={active.has(country.code)}
                  className="size-4"
                />
                <span className="flex-1">{country.name}</span>
                <span className="text-muted">{country.currency}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="text-sm text-muted">
        A product shows in a country once it has a price there. The demo products have prices for
        Norway, Sweden and Denmark.
      </p>
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function PaymentsStep({ member }: { member: Membership }) {
  const { store } = member;
  const settings = await getPaymentSettings(store);
  return (
    <div className="flex flex-col gap-4">
      {!settings.encryptionKeyConfigured && (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Payment keys cannot be saved right now. Skip this step; you can add them later from
          payment settings.
        </p>
      )}
      <StripeKeysForm
        storeSlug={store.slug}
        mode="test"
        status={settings.credentials.test}
        disabled={!settings.encryptionKeyConfigured}
      />
      <p className="text-sm text-muted">
        Live keys, which payment methods each country offers, and switching Stripe on are in{" "}
        <Link href={`/admin/${store.slug}/settings/payments`} className="underline">
          payment settings
        </Link>
        . Checkout is not open yet on Kaizen; your keys will be ready when it is.
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
              <span className="text-muted">{product.status === "active" ? "On sale" : "Draft"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Adding and editing your own products is the next part of the admin we are building.
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
  const items = [
    { done: progress.details, label: "Business details", href: "details", required: true },
    { done: progress.countries, label: "At least one country", href: "countries", required: true },
    { done: progress.payments, label: "Stripe keys", href: "payments", required: false },
    {
      done: progress.products,
      label: progress.counts.demoProducts > 0 ? "Demo products replaced" : "Products",
      href: "products",
      required: false,
    },
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
          <p className="font-medium">Your store is open. Share its address with your first customers.</p>
          <div className="flex flex-wrap gap-4">
            <Link href={storeBase(store.slug)} className="underline">
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
            <SubmitButton disabled={!progress.readyToOpen}>Open my store</SubmitButton>
            <Link href={storeBase(store.slug)} className="text-sm underline" target="_blank">
              Preview the storefront
            </Link>
          </div>
          {!progress.readyToOpen && (
            <p className="text-sm text-muted">Add your business details and a country to open the store.</p>
          )}
        </ActionForm>
      )}
    </div>
  );
}
