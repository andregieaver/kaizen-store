import type { Metadata } from "next";
import { connection } from "next/server";


import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { planCurrencies } from "@/server/billing";
import { listPlatformDiscounts } from "@/server/platform-discounts";
import { platformModes } from "@/server/stripe";

import { createPlatformDiscountAction, deletePlatformDiscountAction, setPlatformDiscountActiveAction } from "../actions";
import { deleteQuestion, PlatformDiscountFields } from "./discount-fields";
import { requirePlatformAdmin } from "@/server/auth";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Discounts" };

const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount codes for stores' plans (D31). Each is a coupon and a
 * promotion code in Stripe; store owners type it on their Plan page.
 */
export default async function PlatformDiscountsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const modes = platformModes();

  return (
    <>
      <PageHeader
        title="Discounts"
        description={<>Codes store owners use on their plan: a percentage or an amount off, once, for some months or for good. Kaizena Flow puts each in Stripe{modes.length > 0 ? ` (${modes.join(" and ")} mode)` : ""}, which applies it to the plan&apos;s invoices. A code can be changed or deleted at any time; plans that already have it keep what they got.</>}
      />

      {discounts.length > 0 && (
        <Card compact>
          <List label="Coupons">
            {discounts.map((d) => (
              <ListRow key={d.id}>
                <RowLead
                  title={<span className="font-mono">{d.code}</span>}
                  href={`/admin/platform/discounts/${d.id}`}
                  sub={
                    <>
                      {platformDiscountSummary(d, money)}
                      {d.syncedModes.length > 0 ? ` · in Stripe (${d.syncedModes.join(", ")})` : " · not in Stripe yet"}
                      {d.syncError && <span className="block text-danger-text">{d.syncError}</span>}
                    </>
                  }
                />
                <RowFact className="hidden md:block">
                  {[d.expiresAt && `Until ${d.expiresAt.slice(0, 10)}`, d.maxRedemptions && `${d.maxRedemptions} uses`].filter(Boolean).join(" · ") || "No limits"}
                </RowFact>
                <RowFact>{d.stores === 1 ? "1 store" : `${d.stores} stores`}</RowFact>
                <Chip signal={d.active ? "positive" : "neutral"} dot>
                  {d.active ? "On" : "Off"}
                </Chip>
                <RowActions>
                  <ActionForm action={setPlatformDiscountActiveAction.bind(null, d.id, !d.active)}>
                    <SubmitButton variant="secondary">{d.active ? "Switch off" : "Switch on"}</SubmitButton>
                  </ActionForm>
                  <ButtonLink href={`/admin/platform/discounts/${d.id}`} kind="quiet" size="dense">
                    Edit<span className="sr-only"> {d.code}</span>
                  </ButtonLink>
                  <DeleteDiscountButton action={deletePlatformDiscountAction.bind(null, d.id)} code={d.code} compact question={deleteQuestion(d.code, d.stores)} />
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <Card title="New code" compact>
        <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
          <PlatformDiscountFields discount={null} currencies={currencies} />
          <SubmitButton>Make code</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
