import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import {
  METHOD_STATE_WORDS,
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

/** A country's name for the owner (the admin is English). */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames("en", { type: "region" }).of(code) ?? code;
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
}: {
  states: Record<string, CapabilityState> | null;
  choices: readonly MethodChoice[];
  markets: readonly string[];
  isOwner: boolean;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  return (
    <Card
      title="Payment methods"
      description="Stripe shows each shopper the methods that suit their country and currency. Untick a method to leave it out of a country's checkout."
    >
      <ActionForm action={action} className="flex flex-col gap-4">
        {markets.map((m) => (
          <input key={m} type="hidden" name="market" value={m} />
        ))}
        <fieldset disabled={!isOwner} className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Payment methods, what Stripe says of each, and the countries that offer them</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-normal">Method</th>
                <th scope="col" className="py-2 pr-3 font-normal">At Stripe</th>
                {markets.map((m) => (
                  <th key={m} scope="col" className="px-2 py-2 text-center font-normal">
                    {countryName(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PAYMENT_METHODS.map((method) => {
                const state = methodStateOf(states, method);
                const reason = state === "unavailable" ? stateReason(states?.[method.capability]?.reason) : null;
                return (
                  <tr key={method.type}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="block text-ink">{method.label}</span>
                      <span className="block text-caption text-muted">
                        {method.where}
                        {method.delayed && ". The money arrives in a few days; the order waits with its stock held."}
                      </span>
                    </th>
                    <td className="py-2 pr-3">
                      <Chip signal={STATE_SIGNAL[state]} dot>
                        {METHOD_STATE_WORDS[state]}
                      </Chip>
                      {reason && <span className="mt-1 block text-caption text-muted">{reason}</span>}
                    </td>
                    {markets.map((m) => (
                      <td key={m} className="px-2 py-2 text-center">
                        {method.always ? (
                          <span className="text-caption text-muted">Always</span>
                        ) : (
                          <input
                            type="checkbox"
                            name="on"
                            value={`${m}:${method.type}`}
                            defaultChecked={methodOn(choices, m, method.type)}
                            aria-label={`${method.label} in ${countryName(m)}`}
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
            <SubmitButton>Save</SubmitButton>
          </div>
        )}
        <p className="text-caption text-muted">
          Subscriptions take only the methods Stripe allows for repeat payments, such as cards and SEPA Direct Debit; subscription boxes take cards.
        </p>
        <p className="text-caption text-muted">
          A method Stripe has not made active is not shown to shoppers, whatever is ticked. Wallets, Swish and the rest of Stripe&apos;s methods are in your{" "}
          <a href="https://dashboard.stripe.com/settings/payment_methods" className="underline" target="_blank" rel="noreferrer">
            Stripe Dashboard
          </a>
          .
        </p>
      </ActionForm>
    </Card>
  );
}
