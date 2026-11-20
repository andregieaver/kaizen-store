import { storePartDrawer } from "@/components/store-part-frame";

import { AccountSection, SignInForm } from "./account-section";

/** What a page built for My account or the sign-in draws of the shop (D113): only the account's own sections (bloat review step 2.9). */
export const accountParts = storePartDrawer(({ part, store, market, query }) => {
  switch (part) {
    case "account":
      return <AccountSection store={store} market={market} query={query} />;
    case "sign_in":
      return <SignInForm store={store} market={market} query={query} />;
    default:
      return null;
  }
});
