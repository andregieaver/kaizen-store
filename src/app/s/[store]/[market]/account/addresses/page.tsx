import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { accountsShown } from "@/lib/customer-accounts";
import { addressLine, type SavedAddress } from "@/lib/customer-addresses";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { listAddresses } from "@/server/customer-addresses";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { defaultAddressAction, removeAddressAction, saveAddressAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/addresses">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Saved addresses (wave 5 unit J1, D304): the shopper's list, add, change, remove and the defaults checkout starts with. */
export default async function AddressesPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/addresses");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Addresses params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Addresses({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  // Customer accounts off (D365): the account's own pages are not there.
  if (!accountsShown(shop.store)) notFound();
  const { store, market } = shop;
  const account = marketPath(store.slug, market.slug, "/account");
  const customer = await getCustomer(store.id);
  if (!customer) redirect(account);
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const texts = t(market.lang);
  const m = texts.account.addresses;
  const addresses = await listAddresses(store.id, customer.id);
  const editing = addresses.find((a) => a.id === one("edit"));
  const adding = one("add") === "1" || addresses.length === 0;
  const notice = one("done") === "saved" ? m.saved : one("done") === "removed" ? m.removed : null;
  const problem = one("problem") === "too_many" ? m.tooMany : one("problem") === "missing" ? m.missing : null;
  const page = marketPath(store.slug, market.slug, "/account/addresses");

  return (
    <>
      <div>
        <Link href={account} className="text-sm underline">
          ← {texts.account.title}
        </Link>
        <h1 className="mt-2 text-3xl font-heading tracking-tight">{m.title}</h1>
        <p className="text-sm text-muted">{m.intro}</p>
      </div>
      {notice && <p role="status">{notice}</p>}
      {problem && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}

      {addresses.length === 0 ? (
        <p>{m.none}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 p-4">
              {a.label && <p className="font-medium">{a.label}</p>}
              <p>{a.address.name}</p>
              <p>{addressLine(a.address)}</p>
              <p className="text-sm text-muted">
                {[a.isDefaultShipping && m.defaultShipping, a.isDefaultBilling && m.defaultBilling].filter(Boolean).join(" · ")}
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <Link href={`${page}?edit=${a.id}`} className="underline">
                  {m.edit}
                </Link>
                {!a.isDefaultShipping && (
                  <form action={defaultAddressAction.bind(null, store.slug, market.slug, a.id, "shipping")}>
                    <button className="underline">{m.makeShipping}</button>
                  </form>
                )}
                {!a.isDefaultBilling && (
                  <form action={defaultAddressAction.bind(null, store.slug, market.slug, a.id, "billing")}>
                    <button className="underline">{m.makeBilling}</button>
                  </form>
                )}
                <form action={removeAddressAction.bind(null, store.slug, market.slug, a.id)}>
                  <button className="underline">{m.remove}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing || adding ? (
        <AddressForm store={store.slug} market={market.slug} country={market.code} address={editing} m={m} first={addresses.length === 0} />
      ) : (
        <Link href={`${page}?add=1`} className="button-primary rounded-button self-start px-4 py-2">
          {m.add}
        </Link>
      )}
    </>
  );
}

function AddressForm({
  store,
  market,
  country,
  address,
  m,
  first,
}: {
  store: string;
  market: string;
  country: string;
  address?: SavedAddress;
  m: ReturnType<typeof t>["account"]["addresses"];
  first: boolean;
}) {
  const field = "min-h-11 w-full rounded-md border border-border bg-background px-3";
  const a = address?.address;
  return (
    <form action={saveAddressAction.bind(null, store, market)} className="flex flex-col gap-3">
      <h2 className="text-xl font-heading">{address ? m.edit : m.add}</h2>
      {address && <input type="hidden" name="id" value={address.id} />}
      <input type="hidden" name="country" value={a?.country ?? country} />
      {(
        [
          ["name", m.name, a?.name, "name", false, 120],
          ["line1", m.line1, a?.line1, "address-line1", true, 200],
          ["line2", m.line2, a?.line2, "address-line2", false, 200],
          ["postalCode", m.postalCode, a?.postalCode, "postal-code", true, 20],
          ["city", m.city, a?.city, "address-level2", true, 100],
        ] as const
      ).map(([name, label, value, autoComplete, required, max]) => (
        <label key={name} className="flex flex-col gap-1 text-sm">
          {label}
          <input name={name} defaultValue={value ?? ""} required={required} maxLength={max} autoComplete={autoComplete} className={field} />
        </label>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        {m.label}
        <input name="label" defaultValue={address?.label ?? ""} maxLength={40} placeholder={m.labelHint} className={field} />
      </label>
      {!first && !address?.isDefaultShipping && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="defaultShipping" className="size-4" />
          {m.makeShipping}
        </label>
      )}
      <button className="button-primary rounded-button self-start px-4 py-2">{m.save}</button>
    </form>
  );
}
