import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { handleMollieWebhook } from "@/server/payment-providers/mollie";

/**
 * Mollie's webhook for stores' Mollie payments (D292): Mollie posts only a payment's id, and Kaizena Flow fetches the payment from Mollie with the store's
 * own token before anything changes, so a forged call can at most make Kaizena Flow read a payment again. Mollie calls again on any answer but 200.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/mollie/[mode]">) {
  const { mode } = await params;
  if (!PAYMENT_MODES.includes(mode as PaymentModeName)) return new Response("Unknown mode", { status: 404 });
  const body = (await request.text()).slice(0, 2000);
  try {
    await handleMollieWebhook(mode as PaymentModeName, body);
  } catch {
    return new Response("Could not process the payment", { status: 500 });
  }
  return new Response(null, { status: 200 });
}
