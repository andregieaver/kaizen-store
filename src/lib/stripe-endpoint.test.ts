import { describe, expect, it } from "vitest";

import { stripeEndpoint } from "./stripe-endpoint";

describe("the Stripe API's address (bloat review step 1.7)", () => {
  it("is Stripe's own unless the switch is on, the address is this machine's over http, and this is not Vercel", () => {
    expect(stripeEndpoint({})).toBeNull();
    expect(stripeEndpoint({ testUrl: "http://127.0.0.1:3913" })).toBeNull();
    expect(stripeEndpoint({ testUrl: "http://127.0.0.1:3913", allowTest: "1", vercel: "1" })).toBeNull();
    expect(stripeEndpoint({ testUrl: "https://127.0.0.1:3913", allowTest: "1" })).toBeNull();
    expect(stripeEndpoint({ testUrl: "http://example.com:3913", allowTest: "1" })).toBeNull();
    expect(stripeEndpoint({ testUrl: "not an address", allowTest: "1" })).toBeNull();
    expect(stripeEndpoint({ testUrl: "http://127.0.0.1:3913", allowTest: "true" })).toBeNull();
  });

  it("is the test server on this machine with the switch on and no Vercel", () => {
    expect(stripeEndpoint({ testUrl: "http://127.0.0.1:3913", allowTest: "1" })).toEqual({ host: "127.0.0.1", port: 3913, protocol: "http" });
    expect(stripeEndpoint({ testUrl: "http://localhost:3913", allowTest: "1", vercel: "" })).toEqual({ host: "localhost", port: 3913, protocol: "http" });
  });
});
