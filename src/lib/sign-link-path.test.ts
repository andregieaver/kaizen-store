import { describe, expect, it } from "vitest";

import { isNoExtrasPath, isSignLinkPath } from "./pay-routes";

/** A contract's signing page (D695 step 3) holds a bearer token: no tracking, owner code, chat or referral capture is drawn there. */
describe("a contract's signing link", () => {
  it("is a path with no extras on both shapes of a store's address, its PDF too", () => {
    for (const path of ["/s/shop/no/account/sign/sig_abc", "/no/account/sign/sig_abc", "/s/shop/account/sign/sig_abc/pdf", "/account/sign/sig_abc"]) {
      expect(isSignLinkPath(path), path).toBe(true);
      expect(isNoExtrasPath(path), path).toBe(true);
    }
  });

  it("is not the account page or another store page", () => {
    for (const path of ["/s/shop/no/account", "/s/shop/no/account/sign", "/s/shop/no/sign/sig_abc", "/s/shop/no/p/sign"]) expect(isSignLinkPath(path), path).toBe(false);
  });
});
