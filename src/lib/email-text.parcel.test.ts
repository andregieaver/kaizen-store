import { describe, expect, it } from "vitest";

import { emailText } from "./email-text";

/**
 * The parcel emails (D238, spec section 8 item 1): an order sent in several parcels gets one email per parcel, so the subject speaks of a parcel of the
 * order and never says the order itself was delivered. Under CRD Art. 9(2)(b) the withdrawal period of goods delivered separately runs from the last
 * parcel; a subject saying "the order has been delivered" after the first could mislead about that. Needs human legal review before real use.
 */

const PARCEL = { nb: /\bEn pakke fra ordre 1042\b/, sv: /\bEtt paket från order 1042\b/, da: /\bEn pakke fra ordre 1042\b/, en: /\bA parcel from order 1042\b/ };
const ORDER_DELIVERED = {
  nb: /^Ordre 1042 .*er levert/,
  sv: /^Order 1042 .*har levererats/,
  da: /^Ordre 1042 .*er leveret/,
  en: /^Order 1042 .*has been delivered/,
};

describe("the parcel emails' subjects", () => {
  for (const lang of ["nb", "sv", "da", "en"] as const) {
    it(`speak of one parcel of the order in ${lang}`, () => {
      const t = emailText(lang);
      for (const subject of [t.parcelOutSubject("Butikken", "1042"), t.parcelDeliveredSubject("Butikken", "1042")]) {
        expect(subject).toMatch(PARCEL[lang]);
        expect(subject).toContain("Butikken");
        expect(subject).not.toMatch(ORDER_DELIVERED[lang]);
      }
    });
  }
});
