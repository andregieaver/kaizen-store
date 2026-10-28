import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { paymentsEn, type PaymentsMessages } from "@/lib/admin-messages/payments.en";
import { Card, Chip } from "@/components/admin/ui";
import { WALLETS, walletWordOf, type WalletDomain, type WalletWord } from "@/lib/express-checkout";
import { methodStateOf, PAYMENT_METHODS, type CapabilityState, type MethodStateWord } from "@/lib/payment-methods";

const DOMAIN_SIGNAL: Record<WalletWord, "positive" | "warning" | "neutral" | "danger"> = {
  active: "positive",
  inactive: "danger",
  off: "warning",
  not_registered: "warning",
  not_read: "neutral",
};

const ACCOUNT_SIGNAL: Record<MethodStateWord, "positive" | "warning" | "neutral" | "danger"> = {
  active: "positive",
  pending: "warning",
  requested: "neutral",
  unavailable: "danger",
  not_read: "neutral",
};

/**
 * The Payments page's wallets (wave 10 unit J, D373): Apple Pay, Google Pay, Link and Klarna, each with what Stripe says of its capability on the
 * store's account (D291) and of each web address the store's shoppers pay on (`PaymentMethodDomain`, kept by `checkWalletDomains()`), with
 * Stripe's reason where one is not active. *Check again* registers any address missing and reads them all back.
 */
export function WalletsCard({
  hosts,
  domains,
  readAt,
  states,
  isOwner,
  action,
  words = paymentsEn.wallets,
  methodWords = paymentsEn.methods,
  locale = "en",
}: {
  hosts: readonly string[];
  domains: Record<string, WalletDomain> | null;
  readAt: string | null;
  states: Record<string, CapabilityState> | null;
  isOwner: boolean;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  words?: PaymentsMessages["wallets"];
  methodWords?: PaymentsMessages["methods"];
  locale?: string;
}) {
  const w = words;
  const accountState = (capability: string): MethodStateWord => {
    const method = PAYMENT_METHODS.find((m) => m.capability === capability);
    return method ? methodStateOf(states, method) : "not_read";
  };
  return (
    <Card title={w.title} description={w.description}>
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="py-2 pr-4">{w.wallet}</th>
                <th scope="col" className="py-2 pr-4">{w.account}</th>
                {hosts.map((host) => (
                  <th key={host} scope="col" className="py-2 pr-4 break-all">{host}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {WALLETS.map((wallet) => {
                const own = accountState(wallet.capability);
                return (
                  <tr key={wallet.id} data-wallet={wallet.id}>
                    <th scope="row" className="py-2 pr-4 text-left">{wallet.label}</th>
                    <td className="py-2 pr-4">
                      <Chip signal={ACCOUNT_SIGNAL[own]}>{methodWords.states[own]}</Chip>
                    </td>
                    {hosts.map((host) => {
                      const word = walletWordOf(domains, host, wallet.id);
                      const reason = domains?.[host]?.wallets[wallet.id]?.reason;
                      return (
                        <td key={host} className="py-2 pr-4" data-host={host}>
                          <Chip signal={DOMAIN_SIGNAL[word]}>{w.states[word]}</Chip>
                          {word === "inactive" && reason && <span className="mt-1 block text-caption text-muted">{reason}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          {readAt ? fillWords(w.checkedAt, { when: new Date(readAt).toLocaleString(locale) }) : w.neverRead} {w.expressNote}
        </p>
        {isOwner ? (
          <ActionForm action={action}>
            <SubmitButton>{w.check}</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{w.ownerOnly}</p>
        )}
      </div>
    </Card>
  );
}
