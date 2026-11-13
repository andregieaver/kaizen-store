import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, ButtonLink, Card, Chip, KpiTile, List, ListRow, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { adsManagerLink } from "@/lib/ad-budgets";
import { amountText } from "@/lib/field-money";
import { formatMoney } from "@/lib/money";
import { adAccountOf, adOverview, isOverview } from "@/server/ad-accounts";

import { connectAdAccountAction, disconnectAdAccountAction, setAdLimitAction } from "./actions";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm";

/**
 * The store's Meta ad account, connected for its budgets (D585, step 1 of `docs/agent-spending.md`), on the Ads page. Homer sees what the
 * ads spent this month, where the month is heading at today's budgets, each budget, and one field: what the AI may let the account spend.
 * The connection (a new token, disconnecting) is folded away. Meta is read when the page is drawn, inside the page's own Suspense.
 */
export async function AdBudgetsCard({ storeId, storeSlug, owner, lang }: { storeId: string; storeSlug: string; owner: boolean; lang: AdminLang }) {
  const w = adminText(lang, "marketing").ads.budgets;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const account = await adAccountOf(storeId);

  if (!account) {
    return (
      <Card title={w.title} aside={<Chip dot>{adminText(lang, "marketing").ads.notConnected}</Chip>}>
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-sm text-ink-2">{w.intro}</p>
          {owner ? (
            <ActionForm action={connectAdAccountAction.bind(null, storeSlug)} className="flex flex-col gap-3" successMessage={w.connected}>
              <label className={label}>
                {w.account}
                <input name="account" className={`${input} font-mono`} required inputMode="numeric" autoComplete="off" />
              </label>
              <label className={label}>
                {w.token}
                <input name="token" type="password" autoComplete="off" className={`${input} font-mono`} required />
                <span className="text-caption text-muted">{w.tokenHelp}</span>
              </label>
              <div>
                <SubmitButton>{w.connect}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">{w.ownerOnly}</p>
          )}
        </div>
      </Card>
    );
  }

  const overview = await adOverview(storeId);
  const money = (minor: number) => formatMoney(minor, account.currency, locale);
  const ok = isOverview(overview);
  const over = ok && account.limitMinor !== null && overview.projectedMinor !== null && overview.projectedMinor > account.limitMinor;

  return (
    <Card
      title={w.title}
      description={`${w.platform} · ${account.name}`}
      aside={
        <Chip signal={ok && !overview.active ? "warning" : "positive"} dot>
          {ok && !overview.active ? w.notRunning : w.connected}
        </Chip>
      }
    >
      <div className="flex flex-col gap-5">
        {!ok ? (
          overview.problem !== "not_connected" && (
            <p className="text-sm text-warning-text">{fillWords(w.read[overview.problem], { code: String(("code" in overview && overview.code) || "?") })}</p>
          )
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile label={w.spent} value={money(overview.spentMinor)} />
              <KpiTile label={w.projected} value={overview.projectedMinor === null ? null : money(overview.projectedMinor)} context={overview.projectedMinor === null ? w.projectedUnknown : w.projectedHelp} />
              <KpiTile label={w.limitTile} value={account.limitMinor === null ? w.noLimit : money(account.limitMinor)} />
            </div>
            {over && <p className="text-sm text-warning-text">{w.overLimit}</p>}
            {overview.budgets.length === 0 ? (
              <p className="text-sm text-muted">{w.noBudgets}</p>
            ) : (
              <List label={w.title}>
                {overview.budgets.map((b) => (
                  <ListRow key={b.id}>
                    <RowLead title={b.name} sub={b.kind === "ad_set" && b.campaign ? fillWords(w.inCampaign, { campaign: b.campaign }) : null} />
                    <Chip signal={b.on ? "positive" : "neutral"} dot>
                      {b.on ? w.on : w.off}
                    </Chip>
                    <RowFact className="hidden sm:inline">{fillWords(w.spentShort, { amount: money(b.spentMinor) })}</RowFact>
                    <RowAmount>{b.dailyMinor === null ? w.lifetime : fillWords(w.perDay, { amount: money(b.dailyMinor) })}</RowAmount>
                  </ListRow>
                ))}
              </List>
            )}
          </>
        )}
        {owner ? (
          <ActionForm action={setAdLimitAction.bind(null, storeSlug)} className="flex max-w-xl flex-col gap-2" successMessage={w.limitSaved}>
            <label className={label}>
              {w.limit}
              <span className="flex items-center gap-2">
                <input name="limit" inputMode="decimal" defaultValue={account.limitMinor === null ? "" : amountText(account.limitMinor, account.currency)} className={`${input} max-w-48 tabular-nums`} />
                <span className="text-sm text-muted">{account.currency}</span>
              </span>
              <span className="text-caption text-muted">{fillWords(w.limitHelp, { currency: account.currency })}</span>
            </label>
            <div>
              <SubmitButton>{w.limitSave}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{w.ownerOnly}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={adsManagerLink(account.account)} target="_blank" rel="noopener noreferrer">
            {w.manage}
          </ButtonLink>
        </div>
        {owner && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-2">{w.connection}</summary>
            <ActionForm action={connectAdAccountAction.bind(null, storeSlug)} className="mt-3 flex max-w-xl flex-col gap-3" successMessage={w.limitSaved}>
              <label className={label}>
                {w.account}
                <input name="account" defaultValue={account.account} className={`${input} font-mono`} required autoComplete="off" />
              </label>
              <label className={label}>
                {w.token}
                <input name="token" type="password" autoComplete="off" className={`${input} font-mono`} />
                <span className="text-caption text-muted">{fillWords(w.tokenSaved, { hint: account.tokenHint })}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <SubmitButton>{w.update}</SubmitButton>
                <Button type="submit" kind="danger" formAction={disconnectAdAccountAction.bind(null, storeSlug)}>
                  {w.disconnect}
                </Button>
              </div>
            </ActionForm>
          </details>
        )}
      </div>
    </Card>
  );
}
