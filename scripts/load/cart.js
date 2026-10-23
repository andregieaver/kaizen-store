// The cart and the checkout under load (D314, docs/capacity.md step 4.3). Adding to a cart is a server action, which k6 cannot call, so
// this loads the pages a shopper loads around buying (products, cart, checkout) and never pays. A full purchase under load is measured
// with Playwright against the same preview (e2e/), a few at a time.
// Run: k6 run -e TARGET=https://<preview> -e STORE=<slug> -e MARKET=no scripts/load/cart.js
import http from "k6/http";
import { check, sleep } from "k6";

import { target } from "./guard.js";

const BASE = `${target(__ENV.TARGET)}/s/${__ENV.STORE || "demo"}/${__ENV.MARKET || "no"}`;

export const options = {
  scenarios: { carts: { executor: "constant-arrival-rate", rate: 20, timeUnit: "1m", duration: "5m", preAllocatedVUs: 20, maxVUs: 100 } },
  thresholds: { http_req_failed: ["rate<0.02"], "http_req_duration{page:checkout}": ["p(95)<1500"] },
};

export default function shopper() {
  const jar = http.cookieJar();
  check(http.get(`${BASE}/products`), { "products 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/cart`, { jar, tags: { page: "cart" } }), { "cart 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/checkout`, { jar, tags: { page: "checkout" }, redirects: 0 }), { "checkout answered": (r) => r.status < 500 });
  sleep(2);
}
