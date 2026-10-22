import { countWords, fillWords } from "@/lib/admin-fill";
import { ordersEn, type OrdersMessages } from "@/lib/admin-messages/orders.en";
import type { PickList } from "@/lib/pick-list";

/**
 * The pick list (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3), drawn only from `pickListData()`: what to take off the shelves for the selected orders. By product,
 * one row per variant with its title, SKU, the number of orders and the units still to send; by order, each order's number with its units to send per line. It holds no
 * price, name or address (the data has none), so nothing of the kind can be printed. Orders that cannot be picked are listed with the reason, and an order whose change
 * waits for the customer's payment is picked as it stands, with a warning. A staff document, in the account's language (D312 A4).
 */
export function PickListView({ list, words: w = ordersEn.pick }: { list: PickList; words?: OrdersMessages["pick"] }) {
  return (
    <article aria-label={w.title} className="flex flex-col gap-4 bg-white p-6 text-black print:p-0">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title text-ink">{w.title}</h2>
        <p className="text-sm">
          {countWords(list.totalUnits, w.units)} {countWords(list.orderCount, w.forOrders)} · {list.by === "product" ? w.byProduct : w.byOrder}
        </p>
      </header>
      {list.warnings.length > 0 && (
        <ul role="note" className="flex flex-col gap-1 border-2 border-black p-3 text-sm">
          {list.warnings.map((warning) => (
            <li key={warning.orderId}>
              #{warning.number}: {w.warnings[warning.reason]}
            </li>
          ))}
        </ul>
      )}
      {list.orderCount === 0 ? (
        <p>{w.nothingLeft}</p>
      ) : list.by === "product" ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th scope="col" className="py-2 pr-2">
                {w.picked}
              </th>
              <th scope="col" className="py-2 pr-2">
                {w.sku}
              </th>
              <th scope="col" className="py-2 pr-2">
                {w.product}
              </th>
              <th scope="col" className="py-2 pr-2 text-right">
                {w.orders}
              </th>
              <th scope="col" className="py-2 text-right">
                {w.unitsColumn}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.products.map((row) => (
              <tr key={row.variantId ?? `${row.sku}-${row.title}`} className="border-b border-neutral-line">
                <td className="py-2 pr-2">
                  <span aria-hidden="true" className="inline-block size-4 border border-black" />
                </td>
                <td className="py-2 pr-2 font-mono">{row.sku}</td>
                <td className="py-2 pr-2">{row.title}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.orders}</td>
                <td className="py-2 text-right text-lg font-medium tabular-nums">{row.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col gap-4">
          {list.orders.map((order) => (
            <section key={order.orderId} aria-label={fillWords(w.orderLabel, { number: order.number })} className="break-inside-avoid">
              <h3 className="border-b-2 border-black pb-1 text-body-strong text-ink">
                #{order.number} <span className="font-normal">· {countWords(order.units, w.units)}</span>
              </h3>
              <table className="w-full text-left text-sm">
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.lineId} className="border-b border-neutral-line">
                      <td className="w-8 py-1.5 pr-2">
                        <span aria-hidden="true" className="inline-block size-4 border border-black" />
                      </td>
                      <td className="w-14 py-1.5 pr-2 text-right font-medium tabular-nums">{line.units}</td>
                      <td className="py-1.5 pr-2">{line.title}</td>
                      <td className="py-1.5 text-right font-mono">{line.sku}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      {list.skipped.length > 0 && (
        <section aria-label={w.leftOut} className="text-sm">
          <p className="font-medium">
            {countWords(list.skipped.length, w.wereLeftOut)}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {list.skipped.map((s, i) => (
              <li key={`${i}-${s.orderId}`}>
                {s.number ? `#${s.number}` : w.notFound}: {w.skip[s.reason]}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs">{w.notListed}</p>
    </article>
  );
}
