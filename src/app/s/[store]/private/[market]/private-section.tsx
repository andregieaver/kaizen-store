import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { safeBack } from "@/lib/private-mode";
import { storeHome } from "@/lib/paths";
import type { StoreQuery } from "@/lib/store-parts";
import type { Store } from "@/server/stores";

/**
 * A private store's landing page (D339): the store's name, a line, and the password field while a password lets visitors in. A plain form
 * posted to `/api/private/unlock` on the store's own host, which sets the pass and sends the visitor back where they asked (`to`); it works
 * without JavaScript. A wrong password comes back with `?wrong=1`, too many tries with `?wait=1`.
 */
export async function PrivateSection({ store, market, query }: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  const params = await query;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const words = t(market.lang).privateStore;
  const to = safeBack(one(params.to), storeHome(store.slug));
  const wrong = one(params.wrong) === "1";
  const wait = one(params.wait) === "1";
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 py-12 text-center" data-private-landing="">
      <h1 className="font-heading text-2xl">{store.name}</h1>
      <p>{words.closed}</p>
      {store.privatePassword && (
        <form method="post" action="/api/private/unlock" className="flex flex-col gap-3 text-left">
          <input type="hidden" name="store" value={store.slug} />
          <input type="hidden" name="market" value={market.slug} />
          <input type="hidden" name="to" value={to} />
          <p className="text-center">{words.askPassword}</p>
          <label className="flex flex-col gap-1 text-sm">
            {words.password}
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              aria-invalid={wrong || undefined}
              aria-describedby={wrong || wait ? "private-problem" : undefined}
              className="rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          {(wrong || wait) && (
            <p id="private-problem" role="alert" className="text-sm text-red-700 dark:text-red-400">
              {wait ? words.tooMany : words.wrong}
            </p>
          )}
          <button type="submit" className="button-primary rounded-button px-4 py-2">
            {words.enter}
          </button>
        </form>
      )}
    </section>
  );
}
