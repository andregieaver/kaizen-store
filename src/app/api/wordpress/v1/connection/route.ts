import { revokeOwn, storesOf } from "@/server/wordpress";
import { asPlugin, json } from "@/server/wordpress-route";

/** Who the token is and how many stores it reaches: the plugin's "Test the connection". */
export async function GET(request: Request) {
  return asPlugin(request, async (caller) => json({ account: { email: caller.email }, stores: (await storesOf(caller.accountId)).length }));
}

/** The plugin's Disconnect: ends this connection, so the token stops working at once. */
export async function DELETE(request: Request) {
  return asPlugin(request, async (caller) => {
    await revokeOwn(caller);
    return json({ disconnected: true });
  });
}
