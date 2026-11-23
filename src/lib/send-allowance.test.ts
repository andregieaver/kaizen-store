import { describe, expect, it } from "vitest";

import { allowanceVerdict, broadcastRefusal, type SendAllowance } from "./send-allowance";

/** The first price sheet's smallest size: 2,500 contacts, 10 emails each a month. */
const base: SendAllowance = { contacts: 1000, contactsAllowed: 2500, emails: 5000, emailsAllowed: 25000, next: { contacts: 10000 } };

describe("email automation's send allowance (D876)", () => {
  it("is fine, near at 80 % of either, and over past the contacts or at the month's emails", () => {
    expect(allowanceVerdict(base)).toBe("fine");
    expect(allowanceVerdict({ ...base, contacts: 2000 })).toBe("near");
    expect(allowanceVerdict({ ...base, emails: 20000 })).toBe("near");
    expect(allowanceVerdict({ ...base, contacts: 2501 })).toBe("over");
    expect(allowanceVerdict({ ...base, emails: 25000 })).toBe("over");
    // A size without a limit is never near.
    expect(allowanceVerdict({ ...base, contacts: 99999, contactsAllowed: null, emailsAllowed: null })).toBe("fine");
  });

  it("holds a new broadcast while the list is too big, or when it would pass the month's emails, and says which", () => {
    expect(broadcastRefusal(base, 1000)).toBeNull();
    expect(broadcastRefusal({ ...base, contacts: 2600 }, 10)).toBe(
      "Your list has 2600 contacts, and your email automation holds 2500. New newsletters wait until you move up; flows and order emails keep sending.",
    );
    expect(broadcastRefusal({ ...base, emails: 24500 }, 600)).toMatch(/^This would pass the 25000 marketing emails your email automation holds this month\./);
    expect(broadcastRefusal({ ...base, emails: 24500 }, 500)).toBeNull();
  });
});
