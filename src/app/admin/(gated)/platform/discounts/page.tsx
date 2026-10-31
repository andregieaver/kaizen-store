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
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { AdminAreas } from "@/components/admin/admin-areas";

export const metadata: Metadata = { title: "Discounts" };

const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount codes for stores' plans (D31). Each is a coupon and a
 * promotion code in Stripe; store owners type it on their Plan page.
 */
export default async function PlatformDiscountsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const t = adminText(adminLangOf(account.adminLocale), "platform");
  const w = t.discounts;
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const modes = platformModes();

  return (
    <AdminAreas areas={["discounts"]}>
    <>
      <PageHeader
        title={w.title}
        description={fillWords(w.description, { modes: modes.length > 0 ? fillWords(w.modes, { modes: modes.join(w.and) }) : "" })}
      />

      {discounts.length > 0 && (
        <Card compact>
          <List label={w.coupons}>
            {discounts.map((d) => (
              <ListRow key={d.id}>
                <RowLead
                  title={<span className="font-mono">{d.code}</span>}
                  href={`/admin/platform/discounts/${d.id}`}
                  sub={
                    <>
                      {platformDiscountSummary(d, money, adminText(adminLangOf(account.adminLocale), "billing").discount)}
                      {d.syncedModes.length > 0 ? fillWords(w.inStripe, { modes: d.syncedModes.join(", ") }) : w.notInStripe}
                      {d.syncError && <span className="block text-danger-text">{d.syncError}</span>}
                    </>
                  }
                />
                <RowFact className="hidden md:block">
                  {[d.expiresAt && fillWords(w.until, { date: d.expiresAt.slice(0, 10) }), d.maxRedemptions && fillWords(w.uses, { n: d.maxRedemptions })].filter(Boolean).join(" · ") || w.noLimits}
                </RowFact>
                <RowFact>{d.stores === 1 ? w.oneStore : fillWords(w.stores, { n: d.stores })}</RowFact>
                <Chip signal={d.active ? "positive" : "neutral"} dot>
                  {d.active ? w.on : w.off}
                </Chip>
                <RowActions>
                  <ActionForm action={setPlatformDiscountActiveAction.bind(null, d.id, !d.active)}>
                    <SubmitButton variant="secondary">{d.active ? w.switchOff : w.switchOn}</SubmitButton>
                  </ActionForm>
                  <ButtonLink href={`/admin/platform/discounts/${d.id}`} kind="quiet" size="dense">
                    {w.edit}<span className="sr-only"> {d.code}</span>
                  </ButtonLink>
                  <DeleteDiscountButton action={deletePlatformDiscountAction.bind(null, d.id)} code={d.code} compact question={deleteQuestion(d.code, d.stores, w)} />
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <Card title={w.newCode} compact>
        <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
          <PlatformDiscountFields discount={null} currencies={currencies} w={t.discountFields} />
          <SubmitButton>{w.make}</SubmitButton>
        </ActionForm>
      </Card>
    </>
    </AdminAreas>
  );
}
