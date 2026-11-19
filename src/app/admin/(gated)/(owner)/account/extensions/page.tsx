import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { EXTENSION_TRIAL_DAYS } from "@/lib/extensions";
import { formatMoney } from "@/lib/money";
import { accountCurrency, getAccountBilling } from "@/server/account-billing";
import { bundleHints } from "@/server/account-cover";
import { requireAccount } from "@/server/auth";
import { accountExtensions, extensionsLaunchedAt, type AccountExtension } from "@/server/extensions";
import { ownedAccount } from "@/server/privacy-officers";

import { setExtensionAction, tryExtensionAction } from "../actions";

export const metadata: Metadata = { title: "Extensions" };

/**
 * Account → Extensions (D748 step E5, section 5 of the spec): every extension with the account's standing (in its plan, added, a free trial
 * until when, running until when, read-only, not added), its price from, and one press: try it free, add it, or end one added on its own.
 * Adding needs the account billed through its account (E4); until extensions are sold, every account has every one and nothing is offered.
 */
export default async function ExtensionsPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "screens").accountExtensions;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const own = await ownedAccount(account.id);
  if (!own) return <PageHeader title={w.title} description={w.ownerOnly} />;
  const [launchedAt, billing, currency] = await Promise.all([extensionsLaunchedAt(), getAccountBilling(own.id), accountCurrency(own.id)]);
  const extensions = await accountExtensions(own.id, currency);
  const launched = launchedAt !== null && launchedAt <= new Date();
  // Paid for now, on its own or in a bundle: ended from here; anything else not in the plan can be added.
  const paid = (e: AccountExtension) => (e.source === "bought" || e.source === "bundle") && e.state === "active";
  const addable = (e: AccountExtension) => e.source !== "plan" && e.state !== "platform" && !paid(e);
  // When the cheapest way to add one is a bundle, the row says so (E6: the checkout buys that answer).
  const hints =
    launched && billing && currency
      ? await bundleHints(own.id, { currency, interval: billing.price?.interval ?? "month", planId: billing.planId }, extensions.filter(addable).map((e) => e.id))
      : {};
  const money = (minor: number) => formatMoney(minor, currency ?? "EUR", locale);
  const day = (iso: string | null) => adminDate(PLATFORM_TIME_ZONE, iso, "long", lang);
  const stateLine = (e: AccountExtension) =>
    e.source === "legacy"
      ? w.states.legacy
      : e.source === "plan"
        ? w.states.included
        : e.state === "trial"
          ? fillWords(w.states.trial, { date: day(e.trialEndsAt) })
          : e.state === "grace"
            ? fillWords(w.states.grace, { date: day(e.graceEndsAt) })
            : w.states[e.state];

  return (
    <>
      <PageHeader title={w.title} description={fillWords(w.description, { days: EXTENSION_TRIAL_DAYS })} />
      {!launched && <p className="rounded-panel border border-line bg-card p-4 text-sm">{w.notLaunched}</p>}
      <List label={w.title}>
        {extensions.map((e) => (
          <ListRow key={e.id}>
            <RowLead title={e.name} sub={e.description} />
            <RowFact
              sub={
                hints[e.id]
                  ? fillWords(w.bundleHint, { bundle: hints[e.id]!.bundle, price: money(hints[e.id]!.amountMinor), saving: money(hints[e.id]!.savingMinor) })
                  : e.priceFrom
                    ? fillWords(w.from, { price: formatMoney(e.priceFrom.amountMinor, e.priceFrom.currency, locale) })
                    : undefined
              }
            >
              <Chip signal={e.state === "read_only" || e.state === "grace" ? "warning" : e.state === "absent" ? "neutral" : "positive"} dot>
                {stateLine(e)}
              </Chip>
            </RowFact>
            {launched && (
              <RowActions>
                {e.state === "absent" && e.source === null && (
                  <ActionForm action={tryExtensionAction.bind(null, e.id)}>
                    <SubmitButton>{w.try}</SubmitButton>
                  </ActionForm>
                )}
                {billing && addable(e) && (
                  <ActionForm action={setExtensionAction.bind(null, e.id, true)}>
                    <SubmitButton variant={e.state === "absent" && e.source === null ? "secondary" : "primary"}>{w.add}</SubmitButton>
                  </ActionForm>
                )}
                {billing && paid(e) && (
                  <ActionForm action={setExtensionAction.bind(null, e.id, false)}>
                    <SubmitButton variant="secondary">{w.end}</SubmitButton>
                  </ActionForm>
                )}
              </RowActions>
            )}
          </ListRow>
        ))}
      </List>
    </>
  );
}
