import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { paymentsEn, type PaymentsMessages } from "@/lib/admin-messages/payments.en";
import { Card, Chip } from "@/components/admin/ui";
import {
  methodOn,
  methodStateOf,
  PAYMENT_METHODS,
  stateReason,
  type CapabilityState,
  type MethodChoice,
  type MethodStateWord,
} from "@/lib/payment-methods";

const STATE_SIGNAL: Record<MethodStateWord, "positive" | "warning" | "neutral" | "danger"> = {
  active: "positive",
  pending: "warning",
  requested: "neutral",
  unavailable: "danger",
  not_read: "neutral",
};

/** A country's name for the owner, in the admin's language. */
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The Payments page's methods (wave 4 unit D, D291): each method Kaizena Flow asks Stripe for, with what Stripe says of it on the store's account, and
 * a switch per country. Every box starts ticked; untick one and that country's checkout leaves the method out. Stripe still shows each shopper only
 * the methods that suit their country and currency among what is left. Cards are always on.
 */
export function PaymentMethodsCard({
  states,
  choices,
  markets,
  isOwner,
  action,
  words = paymentsEn.methods,
  locale = "en",
}: {
  states: Record<string, CapabilityState> | null;
  choices: readonly MethodChoice[];
  markets: readonly string[];
  isOwner: boolean;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The words, in the account's language (D312 A8), and its locale for country names; English unless given. */
  words?: PaymentsMessages["methods"];
  locale?: string;
}) {
  const w = words;
  return (
    <Card title={w.title} description={w.description}>
      <ActionForm action={action} className="flex flex-col gap-4">
        {markets.map((m) => (
          <input key={m} type="hidden" name="market" value={m} />
        ))}
        <fieldset disabled={!isOwner} className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-normal">{w.method}</th>
                <th scope="col" className="py-2 pr-3 font-normal">{w.atStripe}</th>
                {markets.map((m) => (
                  <th key={m} scope="col" className="px-2 py-2 text-center font-normal">
                    {countryName(m, locale)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PAYMENT_METHODS.map((method) => {
                const state = methodStateOf(states, method);
                const reason = state === "unavailable" ? stateReason(states?.[method.capability]?.reason, w.reasons) : null;
                const kind = w.kinds[method.type] ?? { label: method.label, where: method.where };
                return (
                  <tr key={method.type}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="block text-ink">{kind.label}</span>
                      <span className="block text-caption text-muted">
                        {kind.where}
                        {method.delayed && w.delayed}
                      </span>
                    </th>
                    <td className="py-2 pr-3">
                      <Chip signal={STATE_SIGNAL[state]} dot>
                        {w.states[state]}
                      </Chip>
                      {reason && <span className="mt-1 block text-caption text-muted">{reason}</span>}
                    </td>
                    {markets.map((m) => (
                      <td key={m} className="px-2 py-2 text-center">
                        {method.always ? (
                          <span className="text-caption text-muted">{w.always}</span>
                        ) : (
                          <input
                            type="checkbox"
                            name="on"
                            value={`${m}:${method.type}`}
                            defaultChecked={methodOn(choices, m, method.type)}
                            aria-label={fillWords(w.inCountry, { method: kind.label, country: countryName(m, locale) })}
                            className="size-4"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </fieldset>
        {isOwner && (
          <div>
            <SubmitButton>{w.save}</SubmitButton>
          </div>
        )}
        <p className="text-caption text-muted">{w.repeat}</p>
        <p className="text-caption text-muted">
          {w.notActive}{" "}
          <a href="https://dashboard.stripe.com/settings/payment_methods" className="underline" target="_blank" rel="noreferrer">
            {w.dashboard}
          </a>
          .
        </p>
      </ActionForm>
    </Card>
  );
}
