import { quoteBody, toLines } from "@/lib/wordpress-cart";
import { quoteCart } from "@/server/wordpress-shop";
import { asPluginForStore, json, problem } from "@/server/wordpress-route";

/** What a cart held on the site costs now: `{ market, lines: [{ variant_id, quantity }] }`; the lines with live price and stock, and a subtotal. */
export async function POST(request: Request, { params }: RouteContext<"/api/wordpress/v1/stores/[slug]/cart/quote">) {
  const { slug } = await params;
  const body = quoteBody.safeParse(await readJson(request));
  if (!body.success) return problem(400, "invalid_cart", "That cart could not be read.");
  return asPluginForStore(request, slug, async (_caller, store) => {
    const quote = await quoteCart(store, body.data.market || null, toLines(body.data.lines));
    return quote ? json(quote) : problem(404, "no_such_market", "No such market in that store.");
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text.length > 6_000 ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
