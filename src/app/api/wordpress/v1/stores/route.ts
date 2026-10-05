import { storesOf } from "@/server/wordpress";
import { asPlugin, json } from "@/server/wordpress-route";

/** The stores the connected account belongs to, with their markets: what the plugin's picker offers. */
export async function GET(request: Request) {
  return asPlugin(request, async (caller) => json({ stores: await storesOf(caller.accountId) }));
}
