import { t } from "@/lib/i18n";
import { returnLabel } from "@/server/return-labels";
import { resolveAfterSaleShop } from "@/server/shop";

const PRIVATE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } as const;

/** The HTML entities of a text put into the small answer pages. */
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain page in the market's language: what the shopper reads when the label cannot be given now (never the carrier's answer or a stack trace). */
function sentencePage(status: number, lang: string, words: string): Response {
  const body = `<!doctype html><html lang="${escape(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(words)}</title></head><body style="font-family:system-ui,sans-serif;margin:2rem auto;max-width:36rem;padding:0 1rem"><p>${escape(words)}</p></body></html>`;
  return new Response(body, { status, headers: { ...PRIVATE, "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * The return label for the shopper (wave 3, D239, `docs/wave-3-exchanges.md` 2.4): `/s/{store}/{market}/returns/{token}/label`, opened from the return's status
 * page and from the `return.label_ready` email. The return's token is the whole access: an unknown or another store's token, an ended return and a return with
 * no booked label are the same 404 as the status page. The label is fetched by `returnLabel()` from the carrier's own host only, with the store's keys, and
 * answered as it came: it is never stored, attached or cached (`no-store`). At most `LABEL_FETCHES_PER_HOUR` an hour per return (429, a page saying so); the
 * carrier failing is a page saying to try again in a moment (503). No cookie is read or set.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/returns/[token]/label">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) return new Response("Not found", { status: 404, headers: PRIVATE });
  const words = t(shop.market.lang).returnLabel;
  const label = await returnLabel(shop.store.id, token);
  if (!label.ok) {
    if (label.status === 429) return sentencePage(429, shop.market.lang, words.tooMany);
    if (label.status === 503) return sentencePage(503, shop.market.lang, words.unavailable);
    return new Response("Not found", { status: 404, headers: PRIVATE });
  }
  return new Response(new Uint8Array(label.pdf), {
    headers: {
      ...PRIVATE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label.filename}"`,
      "Content-Length": String(label.pdf.length),
    },
  });
}
