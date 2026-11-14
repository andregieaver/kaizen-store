import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, KpiTile, List, ListRow, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { amountText } from "@/lib/field-money";
import { formatMoney } from "@/lib/money";
import { listPurchases, monthTaken, type AgentPurchase } from "@/server/agent-purchases";
import { airwallexCardsLink, getWallet, listCardholders, walletOffered } from "@/server/card-wallet";
import type { Store } from "@/server/stores";

import { cancelPurchaseAction, chooseCardholderAction, connectWalletAction, disconnectWalletAction, setWalletLimitAction, setWalletPausedAction } from "./wallet-actions";

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const OPEN = new Set(["issuing", "card_ready", "spent"]);

/**
 * The AI wallet on the Autopilot settings (D599, step 2 of `docs/agent-spending.md`). Homer connects Airwallex with one button, sets one
 * amount (what the AI's cards may take in a month) and sees each purchase: ready to pay with its card's last four digits, charged, or done.
 * Choosing whose app the cards appear in is asked only when there is more than one person; the pause (which closes open cards) and
 * disconnecting are one step away. A purchase is made only by the AI manager on the owner's yes.
 */
export async function WalletCard({ store, lang, outcome }: { store: Store; lang: AdminLang; outcome?: string }) {
  const w = adminText(lang, "assistant").autopilot.wallet;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const slug = store.slug;
  const [wallet, purchases] = await Promise.all([getWallet(store.id), listPurchases(store.id, 20)]);
  const offered = walletOffered();
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone }).format(new Date(iso));
  const note = outcome ? w.outcomes[outcome] : undefined;

  const connectButton = (
    <ActionForm action={connectWalletAction.bind(null, slug)}>
      <SubmitButton>{w.connect}</SubmitButton>
    </ActionForm>
  );

  let body: React.ReactNode;
  if (!wallet) {
    body = offered ? connectButton : <p className="text-sm text-muted">{w.notOffered}</p>;
  } else if (wallet.state === "auth_failed") {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-warning-text">{w.authFailed}</p>
        {offered && connectButton}
      </div>
    );
  } else if (wallet.state === "choose") {
    const holders = await listCardholders(store.id);
    const ready = holders.ok ? holders.cardholders.filter((c) => c.active) : [];
    body =
      ready.length === 0 ? (
        <p className="text-sm text-ink-2">{holders.ok ? w.noCardholders : w.problems.unreachable}</p>
      ) : (
        <ActionForm action={chooseCardholderAction.bind(null, slug)} successMessage={w.saved} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="text-body-strong text-ink">{w.chooseTitle}</legend>
            {ready.map((c, i) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="radio" name="cardholder" value={c.id} defaultChecked={i === 0} />
                {c.name}
              </label>
            ))}
            <span className="text-caption text-muted">{w.chooseHelp}</span>
          </fieldset>
          <div>
            <SubmitButton>{w.choose}</SubmitButton>
          </div>
        </ActionForm>
      );
  } else {
    const taken = await monthTaken(store.id, wallet.currency, store.timeZone);
    body = (
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <KpiTile
            label={w.thisMonth}
            value={wallet.limitMinor === null ? null : fillWords(w.takenOf, { taken: money(taken, wallet.currency), limit: money(wallet.limitMinor, wallet.currency) })}
            context={wallet.limitMinor === null ? w.noLimitYet : undefined}
          />
          <KpiTile label={w.cardsFor} value={wallet.cardholderName} />
        </div>
        <ActionForm action={setWalletLimitAction.bind(null, slug)} successMessage={w.saved} className="flex max-w-xl flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {w.limit}
            <span className="flex items-center gap-2">
              <input name="limit" inputMode="decimal" defaultValue={wallet.limitMinor === null ? "" : amountText(wallet.limitMinor, wallet.currency)} className={`${input} max-w-48 tabular-nums`} />
              <span className="text-sm text-muted">{wallet.currency}</span>
            </span>
            <span className="text-caption text-muted">{fillWords(w.limitHelp, { currency: wallet.currency })}</span>
          </label>
          <div>
            <SubmitButton>{w.limitSave}</SubmitButton>
          </div>
        </ActionForm>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={airwallexCardsLink(wallet.mode)} target="_blank" rel="noopener noreferrer">
            {w.openAirwallex}
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <Card
      title={w.title}
      description={w.intro}
      aside={
        wallet ? (
          <span className="flex flex-wrap gap-1">
            {wallet.mode === "sandbox" && <Chip signal="insight">{w.sandbox}</Chip>}
            <Chip signal={wallet.state === "auth_failed" || wallet.paused ? "warning" : "positive"} dot>
              {wallet.paused ? w.paused : w.connected}
            </Chip>
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {note && <p className="text-sm text-ink-2">{note}</p>}
        {body}
        {purchases.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{w.purchases}</h3>
            <List label={w.purchases}>
              {purchases.map((p) => (
                <PurchaseRow key={p.id} p={p} slug={slug} words={w} money={money} when={when} />
              ))}
            </List>
          </div>
        ) : (
          wallet?.state === "on" && <p className="text-sm text-muted">{w.noPurchases}</p>
        )}
        {wallet && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-2">{w.connection}</summary>
            <div className="mt-3 flex flex-col gap-3">
              <ActionForm action={setWalletPausedAction.bind(null, slug, !wallet.paused)} successMessage={w.saved} className="flex flex-col gap-1">
                <div>
                  <SubmitButton variant="secondary">{wallet.paused ? w.resume : w.pause}</SubmitButton>
                </div>
                {!wallet.paused && <span className="text-caption text-muted">{w.pauseHelp}</span>}
              </ActionForm>
              <ActionForm action={disconnectWalletAction.bind(null, slug)} className="flex flex-col gap-1">
                <div>
                  <SubmitButton variant="secondary">{w.disconnect}</SubmitButton>
                </div>
                <span className="text-caption text-muted">{w.disconnectHelp}</span>
              </ActionForm>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

type Words = ReturnType<typeof adminText<"assistant">>["autopilot"]["wallet"];

function PurchaseRow({ p, slug, words: w, money, when }: { p: AgentPurchase; slug: string; words: Words; money: (minor: number, currency: string) => string; when: (iso: string) => string }) {
  const open = OPEN.has(p.status);
  return (
    <ListRow>
      <RowLead
        title={p.what}
        sub={
          <>
            {p.merchant}
            {p.cardLast4 && ` · ${fillWords(w.card, { last4: p.cardLast4 })}`}
            {p.status === "card_ready" && ` · ${fillWords(w.until, { time: when(p.activeTo) })}`}
            {p.status === "card_ready" && <span className="block">{fillWords(w.payHint, { merchant: p.merchant })}</span>}
          </>
        }
      />
      <Chip signal={p.status === "card_ready" ? "insight" : p.status === "failed" ? "warning" : p.status === "spent" || p.status === "closed" ? "positive" : "neutral"} dot>
        {w.statuses[p.status]}
      </Chip>
      <RowFact className="hidden sm:inline">{fillWords(w.upTo, { amount: money(p.amountMinor, p.currency) })}</RowFact>
      <RowAmount>{p.spentMinor > 0 ? fillWords(w.spent, { amount: money(p.spentMinor, p.currency) }) : "—"}</RowAmount>
      {open && (
        <ActionForm action={cancelPurchaseAction.bind(null, slug, p.id)} successMessage={w.cancelled}>
          <SubmitButton variant="secondary">{w.cancel}</SubmitButton>
        </ActionForm>
      )}
    </ListRow>
  );
}
