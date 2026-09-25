import type { Metadata } from "next";
import { connection } from "next/server";

import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { planCurrencies } from "@/server/billing";
import { listPlatformDiscounts } from "@/server/platform-discounts";
import { platformModes } from "@/server/stripe";

import { createPlatformDiscountAction, deletePlatformDiscountAction, setPlatformDiscountActiveAction } from "../actions";
import { deleteQuestion, PlatformDiscountFields } from "./discount-fields";

export const metadata: Metadata = { title: "Discounts" };

const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount codes for stores' plans (D31). Each is a coupon and a
 * promotion code in Stripe; store owners type it on their Plan page.
 */
export default async function PlatformDiscountsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const modes = platformModes();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <p className="max-w-2xl text-sm text-muted">
          Codes store owners use on their plan: a percentage or an amount off, once, for some months or for good.
          Kaizen puts each in Stripe{modes.length > 0 ? ` (${modes.join(" and ")} mode)` : ""}, which applies it to the
          plan&apos;s invoices. A code can be changed or deleted at any time; plans that already have it keep what they got.
        </p>
      </div>

      {discounts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Code</th>
                <th scope="col" className="px-4 py-2 font-medium">Gives</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Limits</th>
                <th scope="col" className="px-4 py-2 font-medium">Stores</th>
                <th scope="col" className="px-4 py-2 font-medium">
                  <span className="sr-only">Switch</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono font-medium">{d.code}</span>
                    <span className="block text-xs text-muted">
                      {d.active ? "On" : "Off"}
                      {d.syncedModes.length > 0 ? ` · in Stripe (${d.syncedModes.join(", ")})` : " · not in Stripe yet"}
                    </span>
                    {d.syncError && <span className="block text-xs text-red-700">{d.syncError}</span>}
                  </td>
                  <td className="px-4 py-2">{platformDiscountSummary(d, money)}</td>
                  <td className="hidden px-4 py-2 md:table-cell">
                    {[d.expiresAt && `until ${d.expiresAt.slice(0, 10)}`, d.maxRedemptions && `${d.maxRedemptions} uses`]
                      .filter(Boolean)
                      .join(" · ") || "None"}
                  </td>
                  <td className="px-4 py-2">{d.stores}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <ActionForm action={setPlatformDiscountActiveAction.bind(null, d.id, !d.active)}>
                        <SubmitButton variant="secondary">{d.active ? "Switch off" : "Switch on"}</SubmitButton>
                      </ActionForm>
                      <Link
                        href={`/admin/platform/discounts/${d.id}`}
                        className="flex min-h-10 items-center rounded-md px-3 hover:bg-surface"
                      >
                        Edit<span className="sr-only"> {d.code}</span>
                      </Link>
                      <DeleteDiscountButton
                        action={deletePlatformDiscountAction.bind(null, d.id)}
                        code={d.code}
                        compact
                        question={deleteQuestion(d.code, d.stores)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="new-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="new-heading" className="mb-4 font-medium">
          New code
        </h2>
        <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
          <PlatformDiscountFields discount={null} currencies={currencies} />
          <SubmitButton>Make code</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
