import type { Metadata } from "next";
import { connection } from "next/server";


import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { listPlans, planCurrencies } from "@/server/billing";
import { campaignRuns } from "@/lib/plan-campaigns";
import { isPlanOfferKey, PLAN_OFFER_KEYS, planOfferDraft } from "@/lib/plan-offers";
import Link from "next/link";
import { CHIP_STRIP } from "@/lib/chip-strip";
import { listPlatformDiscounts } from "@/server/platform-discounts";
import { platformModes } from "@/server/stripe";

import { createPlatformDiscountAction, deletePlatformDiscountAction, setPlatformDiscountActiveAction } from "../actions";
import { deleteQuestion, PlatformDiscountFields } from "./discount-fields";
import { requirePlatformReader } from "@/server/auth";
import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { AdminAreas } from "@/components/admin/admin-areas";

export const metadata: Metadata = { title: "Discounts" };

const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount codes for stores' plans (D31). Each is a coupon and a
 * promotion code in Stripe; store owners type it on their Plan page.
 */
export default async function PlatformDiscountsPage({ searchParams }: PageProps<"/admin/platform/discounts">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const t = adminText(lang, "platform");
  const w = t.discounts;
  const [discounts, currencies, plans] = await Promise.all([listPlatformDiscounts(), planCurrencies(), listPlans()]);
  const modes = platformModes();
  const offered = plans.filter((plan) => plan.active).map((plan) => ({ id: plan.id, name: plan.name }));
  // A campaign's state (D524): coming up, running or ended.
  const now = new Date();
  const day = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "day", lang);
  const stateOf = (d: (typeof discounts)[number]) =>
    !d.campaign || !d.expiresAt
      ? null
      : new Date(d.expiresAt) <= now
        ? w.ended
        : campaignRuns({ active: d.active, startsAt: d.campaign.startsAt, expiresAt: d.expiresAt }, now)
          ? w.running
          : w.comingUp;

  // Round 16 (D650): a ready offer chosen above opens its form filled in.
  const asked = (await searchParams).offer;
  const offerKey = isPlanOfferKey(asked) ? asked : null;
  const draft = offerKey ? { ...planOfferDraft(offerKey, now), name: w.offers[offerKey].title } : null;
  const running = discounts.find((d) => d.campaign && campaignRuns({ active: d.active, startsAt: d.campaign.startsAt, expiresAt: d.expiresAt ?? d.campaign.startsAt }, now));
  const codesOn = discounts.filter((d) => !d.campaign && d.active).length;
  const lead =
    !running && codesOn === 0
      ? w.leadNone
      : [running && fillWords(w.leadRunning, { name: running.campaign!.name }), codesOn > 0 ? countWords(codesOn, w.leadCodes) : w.leadNoCodes].filter(Boolean).join(" ");
  const fold = `group ${CARD_CLASS}`;
  const summary = "flex min-h-12 cursor-pointer list-none items-center px-6 py-3 text-body text-ink [&::-webkit-details-marker]:hidden";
  return (
    <AdminAreas areas={["discounts"]}>
    <>
      <PageHeader
        title={w.title}
        meta={[lead]}
        description={fillWords(w.leadRest, { modes: modes.length > 0 ? fillWords(w.modes, { modes: modes.join(w.and) }) : "" })}
      />

      <section aria-labelledby="offers" className="flex flex-col gap-3">
        <h2 id="offers" className="text-title text-ink">
          {w.offersTitle}
        </h2>
        {/* On a phone the offers are a strip to swipe, each card the tap (round 17, D652); wider, a grid as before. */}
        <ul className={`snap-x snap-mandatory scroll-px-4 sm:scroll-px-0 ${CHIP_STRIP.replace("gap-2", "gap-3")} sm:grid sm:grid-cols-2 xl:grid-cols-4`}>
          {PLAN_OFFER_KEYS.map((key) => (
            <li key={key} className="w-56 shrink-0 snap-start sm:w-auto">
              <Link
                href={`/admin/platform/discounts?offer=${key}#${key === "weekend" ? "write-campaign" : "write-code"}`}
                scroll={false}
                className={`flex h-full flex-col gap-2 p-5 hover:bg-sunken ${CARD_CLASS}`}
              >
                <span className="text-body-strong text-ink">{w.offers[key].title}</span>
                <span className="flex-1 text-caption text-ink-2">{w.offers[key].sub}</span>
                <span className="mt-1 inline-flex min-h-10 items-center self-start rounded-pill border border-edge px-4 text-sm font-medium text-ink">
                  {key === "weekend" ? w.makeThisCampaign : w.makeThisCode}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {discounts.length === 0 ? (
        <Card title={w.liveTitle} compact>
          <p className="flex flex-col">
            <span className="text-body text-ink">{w.liveNone}</span>
            <span className="text-caption text-ink-2">{w.liveNoneSub}</span>
          </p>
        </Card>
      ) : (
        <Card title={w.liveTitle} compact>
          <List label={w.coupons}>
            {discounts.map((d) => (
              <ListRow key={d.id}>
                <RowLead
                  title={d.campaign ? d.campaign.name : <span className="font-mono">{d.code}</span>}
                  href={`/admin/platform/discounts/${d.id}`}
                  sub={
                    <>
                      {d.campaign && d.expiresAt && (
                        <span className="block">
                          {w.campaign} · {fillWords(w.campaignWhen, { from: day(d.campaign.startsAt), to: day(d.expiresAt) })} · {stateOf(d)}
                        </span>
                      )}
                      {platformDiscountSummary(d, money, adminText(adminLangOf(account.adminLocale), "billing").discount)}
                      {d.syncedModes.length > 0 ? fillWords(w.inStripe, { modes: d.syncedModes.join(", ") }) : w.notInStripe}
                      {d.syncError && <span className="block text-danger-text">{d.syncError}</span>}
                    </>
                  }
                />
                <RowFact className="hidden md:block">
                  {[d.expiresAt && fillWords(w.until, { date: day(d.expiresAt) }), d.maxRedemptions && fillWords(w.uses, { n: d.maxRedemptions })].filter(Boolean).join(" · ") || w.noLimits}
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
                  <DeleteDiscountButton action={deletePlatformDiscountAction.bind(null, d.id)} code={d.code} compact question={deleteQuestion(d.campaign?.name ?? d.code, d.stores, w)} />
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <details id="write-code" key={`code-${offerKey}`} open={draft !== null && !draft.campaign} className={fold}>
        <summary className={summary}>{w.writeCode}</summary>
        <div className="flex flex-col gap-4 px-6 pb-6">
          {draft && !draft.campaign && offerKey && <p role="status" className="text-sm text-ink-2">{fillWords(w.filledFrom, { title: w.offers[offerKey].title })}</p>}
          <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
            <PlatformDiscountFields discount={null} currencies={currencies} w={t.discountFields} draft={draft && !draft.campaign ? draft : null} />
            <SubmitButton>{w.make}</SubmitButton>
          </ActionForm>
        </div>
      </details>

      <details id="write-campaign" key={`campaign-${offerKey}`} open={draft?.campaign === true} className={fold}>
        <summary className={summary}>{w.writeCampaign}</summary>
        <div className="flex flex-col gap-4 px-6 pb-6">
          <p className="text-sm text-ink-2">{w.campaignDescription}</p>
          <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
            <PlatformDiscountFields discount={null} currencies={currencies} w={t.discountFields} campaign plans={offered} draft={draft?.campaign ? draft : null} />
            <SubmitButton>{w.makeCampaign}</SubmitButton>
          </ActionForm>
        </div>
      </details>
    </>
    </AdminAreas>
  );
}
