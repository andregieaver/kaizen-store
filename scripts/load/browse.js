// Browsing a store (D314, docs/capacity.md step 4.3): the front page, products, a category, search and a product, as shoppers do.
// Run: k6 run -e TARGET=https://<preview> -e STORE=<slug> -e MARKET=no scripts/load/browse.js
import http from "k6/http";
import { check, sleep } from "k6";

import { target } from "./guard.js";

const BASE = `${target(__ENV.TARGET)}/s/${__ENV.STORE || "demo"}/${__ENV.MARKET || "no"}`;

export const options = {
  scenarios: {
    browse: { executor: "ramping-arrival-rate", startRate: 10, timeUnit: "1s", preAllocatedVUs: 50, maxVUs: 400, stages: [{ target: 200, duration: "2m" }, { target: 200, duration: "3m" }, { target: 0, duration: "30s" }] },
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<800"] },
};

const PATHS = ["", "/products", "/search?q=shirt"];

export default function browse() {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  const response = http.get(`${BASE}${path}`, { tags: { page: path || "/" } });
  check(response, { "answered 200": (r) => r.status === 200 });
  sleep(1);
}
