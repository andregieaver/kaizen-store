import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, Chip, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { effectiveDispatch } from "@/lib/tax-profile";
import { customsMarkets, productsWithoutHsCode } from "@/server/customs";
import { memberCan, requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";
import { getTaxProfile, storeCountry } from "@/server/tax-profile";

import { saveCustomsAction } from "./actions";

export const metadata: Metadata = { title: "Duties and import VAT" };

/**
 * Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` section 4, I). Homer sees the countries his goods cross a customs border into,
 * each with one choice (the carrier collects on delivery, the default, or checkout collects with the order) and a Save; Lisa also finds the VAT
 * scheme tick, whether the platform's rates cover the country, and how many products lack an HS code. The estimate itself is the cart's.
 */
export default async function CustomsSettingsPage({ params }: PageProps<"/admin/[store]/settings/customs">) {
  const current = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { store } = current;
  const editor = memberCan(current, "settings:write");
  const lang = adminLangOf(current.account.adminLocale);
  const all = adminText(lang, "settings");
  const w = all.customs;
  const [profile, country, countries, missing] = await Promise.all([
    getTaxProfile(store.id),
    storeCountry(store.id),
    listCountries(),
    productsWithoutHsCode(store.id),
  ]);
  const dispatch = effectiveDispatch(profile, country);
  const markets = (await customsMarkets(store.id, dispatch)).filter((m) => m.crosses);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const missingHs = missing;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      {!editor && <p className="text-sm">{all.common.readOnly}</p>}
      <p className="text-sm">{dispatch ? fillWords(w.dispatchFrom, { country: countryName(dispatch) }) : w.dispatchMissing}</p>
      {dispatch && missingHs > 0 && markets.some((m) => m.mode === "ddp") && (
        <p className="text-sm text-warning-text" data-testid="customs-missing-hs">
          {countWords(missingHs, w.missingHs)}
        </p>
      )}
      {dispatch && (
        <AdminTextScope texts={adminTexts(lang, ["settings"])}>
          <Card title={w.choice}>
            {markets.length === 0 ? (
              <p className="text-sm text-muted">{w.none}</p>
            ) : (
              <List label={w.choice}>
                {markets.map((m) => (
                  <ListRow key={m.code}>
                    <RowLead
                      title={countryName(m.code)}
                      sub={!m.inTable ? <span className="text-warning-text">{w.notInTable}</span> : m.mode === "ddp" ? w.ddpHelp : w.dapHelp}
                    />
                    <Chip signal={m.mode === "ddp" ? "positive" : "neutral"}>{m.mode.toUpperCase()}</Chip>
                    {editor && (
                      <ActionForm action={saveCustomsAction.bind(null, store.slug)} className="flex flex-col gap-2" successMessage={all.common.saved}>
                        <input type="hidden" name="market" value={m.code} />
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="sr-only">{w.choice}</span>
                          <select name="mode" defaultValue={m.mode} data-testid={`customs-mode-${m.code}`}>
                            <option value="dap">{w.dap}</option>
                            <option value="ddp">{w.ddp}</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="vatScheme" defaultChecked={m.vatScheme} />
                          {w.vatScheme}
                        </label>
                        <div>
                          <SubmitButton>{all.common.save}</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </ListRow>
                ))}
              </List>
            )}
          </Card>
        </AdminTextScope>
      )}
      <p className="text-sm text-muted">{w.estimateNote}</p>
    </div>
  );
}
