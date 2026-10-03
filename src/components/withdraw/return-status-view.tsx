import { formatMoney } from "@/lib/money";
import { formatDeclaration, formatStoreDay } from "@/lib/return-time";
import { isEnded, type ReturnStatus } from "@/lib/return-status";
import type { ShopperReturn } from "@/server/returns";

import { declinedReason, type R } from "./withdraw-parts";

type Props = { m: R; ret: ShopperReturn; locale: string };

/** A web address only when it is one the shopper's browser may open: the store pastes it, and a page does not trust it. */
const safeHref = (value: string | null): string | null => (value && /^https:\/\/\S+$/.test(value) ? value : null);

/**
 * The status of one return for the shopper (D153, `docs/returns.md`): where it stands, what to do next and what came of it.
 * Read only. It shows the order number and the goods, never the shopper's email or address. Drawn from `getShopperReturn()`;
 * the page, and the tests, give it the same data.
 */
export function ReturnStatusView({ m, ret, locale }: Props) {
  const status = ret.status as ReturnStatus;
  const open = !isEnded(status);
  const day = (iso: string) => new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "long", timeZone: ret.timeZone }).format(new Date(iso));
  const labelHref = safeHref(ret.labelUrl);
  const refunded = ret.outcome === "refunded" && ret.refundMinor !== null && ret.refundedAt !== null;
  const stateWords: Record<string, string> = { done: m.stepDone, current: m.stepCurrent, skipped: m.stepSkipped };
  const where = ret.returnAddress;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-heading tracking-tight">{m.statusTitle(ret.number)}</h1>
        <p className="text-muted">
          {m.statusOrder(ret.orderNumber)} · {m.kind[ret.kind]}
        </p>
        <p className="text-sm text-muted">{m.statusMade(formatDeclaration(ret.createdAt, locale, ret.timeZone))}</p>
      </div>

      <p className="text-xl font-medium">{ret.nothingSent && status === "approved" ? m.nothingToSend : m.status[status]}</p>

      <ol aria-label={m.stepsLabel} className="flex flex-col gap-2 rounded-lg border border-border p-4">
        {ret.steps.map((step) => (
          <li key={step.step} aria-current={step.state === "current" ? "step" : undefined} className={step.state === "upcoming" || step.state === "skipped" ? "text-muted" : "font-medium"}>
            {m.steps[step.step as keyof typeof m.steps]}
            {stateWords[step.state] && <span className="sr-only">: {stateWords[step.state]}</span>}
          </li>
        ))}
      </ol>

      <section aria-labelledby="items-heading" className="flex flex-col gap-2">
        <h2 id="items-heading" className="font-medium">
          {m.itemsHeading}
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border px-4">
          {ret.lines.map((line, i) => (
            <li key={`${line.title}-${i}`} className="flex flex-col gap-0.5 py-3">
              <span className="flex flex-wrap justify-between gap-3">
                <span className="min-w-0 break-words">{line.title}</span>
                <span className="whitespace-nowrap">× {line.quantity}</span>
              </span>
              {line.decision === "decline" && <span className="text-sm text-muted">{m.declinedLine(declinedReason(m, line.declineReason))}</span>}
            </li>
          ))}
        </ul>
      </section>

      {status === "declined" && ret.decisionNote && (
        <section aria-labelledby="declined-heading" className="flex flex-col gap-1">
          <h2 id="declined-heading" className="font-medium">
            {m.declinedHeading}
          </h2>
          <p className="whitespace-pre-line break-words">{ret.decisionNote}</p>
        </section>
      )}

      {open && !ret.nothingSent && (status === "approved" || status === "in_transit") && (
        <section aria-labelledby="how-heading" className="flex flex-col gap-3">
          <h2 id="how-heading" className="font-medium">
            {m.howHeading}
          </h2>
          {ret.sendBackBy && <p>{m.done.sendBack(formatStoreDay(ret.sendBackBy, locale))}</p>}
          {ret.instructions && (
            <div>
              <h3 className="text-sm font-medium">{m.instructionsHeading}</h3>
              <p className="whitespace-pre-line break-words">{ret.instructions}</p>
            </div>
          )}
          {where && (
            <div>
              <h3 className="text-sm font-medium">{m.addressHeading}</h3>
              <address className="not-italic">
                {[where.name, where.street, `${where.postalCode} ${where.city}`, where.country].map((part) => (
                  <span key={part} className="block">
                    {part}
                  </span>
                ))}
              </address>
            </div>
          )}
          {labelHref && (
            <p>
              <a href={labelHref} target="_blank" rel="noreferrer" className="underline">
                {m.labelLink}
              </a>
            </p>
          )}
          <p className="text-sm text-muted">{m.whoPays[ret.whoPaysReturn]}</p>
        </section>
      )}

      {ret.kind === "withdrawal" && open && ret.refundBy && (
        <section className="flex flex-col gap-1">
          <p>{m.done.refundBy(day(ret.refundBy))}</p>
          {ret.nothingSent ? <p className="text-sm text-muted">{m.done.nothingSent}</p> : <p className="text-sm text-muted">{m.done.refundWait}</p>}
        </section>
      )}

      {refunded && <p role="status">{m.refunded(formatMoney(ret.refundMinor!, ret.currency, locale), day(ret.refundedAt!))}</p>}
      {ret.outcome === "no_refund" && <p>{m.noRefund}</p>}
      {ret.acknowledgementReference && (
        <p className="text-sm text-muted">
          {m.done.reference}: <span className="font-mono">{ret.acknowledgementReference}</span>
        </p>
      )}
    </>
  );
}

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : "en";
  } catch {
    return "en";
  }
}

