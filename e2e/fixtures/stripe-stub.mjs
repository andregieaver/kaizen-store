// A stand-in for Stripe's API, for the end-to-end build (bloat review step 1.7): the only fake on the payment path, and it is told it
// is one. The app reaches it only through STRIPE_TEST_URL with STRIPE_ALLOW_TEST_URL=1 (`stripeEndpoint()` in src/lib/stripe-endpoint.ts:
// this machine's own address, never on Vercel), which playwright.config.ts sets for the app it starts. It answers the server's calls on
// the checkout's way to its payment step, each with the least the code reads:
//   POST /v1/checkout/sessions   a session for Stripe's form in the page (ui_mode 'elements'): its id and client secret
//   POST /v1/coupons             a discount code's coupon for that checkout: its id
//   GET  /__health               for Playwright to know it is up
// Every other path answers 404 with a Stripe-shaped error and is written to standard error, so a call it lacks is seen at once. No card
// data exists here: Stripe's form takes cards, and the tests never reach it.
//   STRIPE_STUB_PORT=3913 node e2e/fixtures/stripe-stub.mjs
import { randomBytes } from "node:crypto";
import http from "node:http";

const port = Number(process.env.STRIPE_STUB_PORT ?? 3913);

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "request-id": `req_e2e_${randomBytes(6).toString("hex")}` });
  res.end(JSON.stringify(body));
};

/** A form-encoded body as Stripe's SDK sends it (only the flat fields this stand-in reads). */
const fieldsOf = (raw) => Object.fromEntries(new URLSearchParams(raw));

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/__health") return send(res, 200, { ok: true });
      if (path === "/v1/checkout/sessions" && req.method === "POST") {
        const fields = fieldsOf(raw);
        const id = `cs_test_e2e_${randomBytes(12).toString("hex")}`;
        return send(res, 200, {
          id,
          object: "checkout.session",
          client_secret: `${id}_secret_e2e`,
          client_reference_id: fields.client_reference_id ?? null,
          ui_mode: fields.ui_mode ?? "hosted",
          url: null,
          status: "open",
          payment_status: "unpaid",
          livemode: false,
        });
      }
      if (path === "/v1/coupons" && req.method === "POST") {
        return send(res, 200, { id: `cs_test_e2e_coupon_${randomBytes(6).toString("hex")}`, object: "coupon", livemode: false });
      }
      process.stderr.write(`stripe stand-in: no answer for ${req.method} ${path}\n`);
      return send(res, 404, {
        error: { type: "invalid_request_error", message: `The stand-in does not serve ${req.method} ${path}`, code: "resource_missing" },
      });
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Stripe stand-in on http://127.0.0.1:${port}`));
