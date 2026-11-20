import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminLink, Card, List, ListRow, PageHeader, RowActions, RowFact, RowLead, TextInput } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { EXTENSION_TRIAL_DAYS, WORKSPACE_EXTENSIONS } from "@/lib/extensions";
import { formatMoney } from "@/lib/money";
import { accountCurrency, getAccountBilling } from "@/server/account-billing";
import { listStores, listWorkspaces, requireAccount } from "@/server/auth";
import { accountExtensions } from "@/server/extensions";
import { ownedAccount } from "@/server/privacy-officers";
import { TRIAL_DAYS } from "@/server/store-trial";

import { openStoreAction, setExtensionAction, tryExtensionAction } from "../actions";

export const metadata: Metadata = { title: "Add to your account" };

/**
 * Add to your account (D748 E7 part three, `docs/extensions.md` 7), from the account menu: an online store and each extension the account
 * does not have, one press each. An account with no store opens its first one here with the plan's free trial; one with stores is sent to
 * Your stores. An extension never tried starts its free trial; one whose trial ended is added (the checkout, as on Extensions). An account
 * with only a workspace is never offered a store-only extension (A/B tests need a site).
 */
export default async function AddToAccountPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = HOME_WORDS[lang].add;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const own = await ownedAccount(account.id);
  if (!own) return <PageHeader title={w.title} description={w.ownerOnly} />;
  const [stores, workspaces, billing, currency] = await Promise.all([
    listStores(account),
    listWorkspaces(account),
    getAccountBilling(own.id),
    accountCurrency(own.id),
  ]);
  const extensions = await accountExtensions(own.id, currency);
  const storeless = !stores.some((store) => store.role === "owner");
  const offered = extensions.filter((e) => !storeless || WORKSPACE_EXTENSIONS.includes(e.id));
  const missing = offered.filter((e) => e.state === "absent");
  const has = offered.filter((e) => e.state !== "absent");
  const businessName = workspaces.find((place) => place.role === "owner")?.name ?? "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <Card title={w.storeTitle} description={fillWords(w.storeText, { days: TRIAL_DAYS })} className="max-w-3xl">
        {storeless ? (
          <ActionForm action={openStoreAction} className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
              {w.storeName}
              <TextInput name="name" required maxLength={80} defaultValue={businessName} />
            </label>
            <SubmitButton>{w.storeButton}</SubmitButton>
          </ActionForm>
        ) : (
          <AdminLink href="/admin/stores" className="font-medium underline underline-offset-2">
            {w.storeMore}
          </AdminLink>
        )}
      </Card>
      {missing.length > 0 ? (
        <List label={w.title}>
          {missing.map((e) => (
            <ListRow key={e.id}>
              <RowLead title={e.name} sub={e.description} />
              <RowFact
                sub={
                  e.priceFrom
                    ? fillWords(w.from, {
                        price: formatMoney(e.priceFrom.amountMinor, e.priceFrom.currency, locale),
                      })
                    : undefined
                }
              >
                {e.source === null ? fillWords(w.freeFor, { days: EXTENSION_TRIAL_DAYS }) : w.tried}
              </RowFact>
              <RowActions>
                {e.source === null ? (
                  <ActionForm action={tryExtensionAction.bind(null, e.id)}>
                    <SubmitButton>{w.try}</SubmitButton>
                  </ActionForm>
                ) : (
                  billing && (
                    <ActionForm action={setExtensionAction.bind(null, e.id, true)}>
                      <SubmitButton>{w.add}</SubmitButton>
                    </ActionForm>
                  )
                )}
              </RowActions>
            </ListRow>
          ))}
        </List>
      ) : (
        <p className="text-sm text-muted">{w.everything}</p>
      )}
      {has.length > 0 && missing.length > 0 && <p className="text-sm text-muted">{fillWords(w.has, { names: has.map((e) => e.name).join(", ") })}</p>}
    </div>
  );
}
