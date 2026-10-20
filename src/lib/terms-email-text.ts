/**
 * The words of the payment terms emails (wave 4 unit F, D293, `docs/wave-4-payments.md` 8): the reminder three days before an invoice on terms is due and
 * the notice the day after it was due, by language, joined into `emailText()` as `terms`. Hand-written in nb, sv, da and en (`HAND_WRITTEN_ONLY`:
 * `email:terms.`), sent only to the order's own address, and every sentence needs legal review before real use (a reminder may be a demand for payment
 * under national law; no interest, fee or collection step is named). Not legal advice. No imports: `email-text.ts` reads it.
 */

// legal: needs review
const en = {
  terms: {
    dueSubject: (store: string, number: string) => `${store}: invoice for order ${number} is due soon`,
    dueHeading: "Your invoice is due soon",
    dueIntro: (number: string, amount: string, day: string) => `A friendly reminder: ${amount} for order ${number} is due on ${day}.`,
    overdueSubject: (store: string, number: string) => `${store}: invoice for order ${number} is overdue`,
    overdueHeading: "Your invoice is overdue",
    overdueIntro: (number: string, amount: string, day: string) => `We have not received ${amount} for order ${number}, which was due on ${day}. Please pay it as soon as you can.`,
    howToPay: "You can pay from the order page, or as the invoice says.",
    alreadyPaid: "If you have paid in the last few days, thank you: you can ignore this email.",
  },
};

type TermsEmail = typeof en;

// legal: needs review
const nb: TermsEmail = {
  terms: {
    dueSubject: (store, number) => `${store}: fakturaen for ordre ${number} forfaller snart`,
    dueHeading: "Fakturaen din forfaller snart",
    dueIntro: (number, amount, day) => `En vennlig påminnelse: ${amount} for ordre ${number} forfaller ${day}.`,
    overdueSubject: (store, number) => `${store}: fakturaen for ordre ${number} har forfalt`,
    overdueHeading: "Fakturaen din har forfalt",
    overdueIntro: (number, amount, day) => `Vi har ikke mottatt ${amount} for ordre ${number}, som forfalt ${day}. Betal så snart du kan.`,
    howToPay: "Du kan betale fra ordresiden, eller slik fakturaen sier.",
    alreadyPaid: "Har du betalt de siste dagene, takk: da kan du se bort fra denne e-posten.",
  },
};

// legal: needs review
const sv: TermsEmail = {
  terms: {
    dueSubject: (store, number) => `${store}: fakturan för order ${number} förfaller snart`,
    dueHeading: "Din faktura förfaller snart",
    dueIntro: (number, amount, day) => `En vänlig påminnelse: ${amount} för order ${number} förfaller ${day}.`,
    overdueSubject: (store, number) => `${store}: fakturan för order ${number} har förfallit`,
    overdueHeading: "Din faktura har förfallit",
    overdueIntro: (number, amount, day) => `Vi har inte fått ${amount} för order ${number}, som förföll ${day}. Betala så snart du kan.`,
    howToPay: "Du kan betala från ordersidan, eller som fakturan anger.",
    alreadyPaid: "Har du betalat de senaste dagarna, tack: då kan du bortse från det här mejlet.",
  },
};

// legal: needs review
const da: TermsEmail = {
  terms: {
    dueSubject: (store, number) => `${store}: fakturaen for ordre ${number} forfalder snart`,
    dueHeading: "Din faktura forfalder snart",
    dueIntro: (number, amount, day) => `En venlig påmindelse: ${amount} for ordre ${number} forfalder ${day}.`,
    overdueSubject: (store, number) => `${store}: fakturaen for ordre ${number} er forfalden`,
    overdueHeading: "Din faktura er forfalden",
    overdueIntro: (number, amount, day) => `Vi har ikke modtaget ${amount} for ordre ${number}, som forfaldt ${day}. Betal venligst så snart du kan.`,
    howToPay: "Du kan betale fra ordresiden, eller som fakturaen angiver.",
    alreadyPaid: "Har du betalt inden for de seneste dage, tak: så kan du se bort fra denne e-mail.",
  },
};

export const TERMS_EMAIL_TEXT = { nb, sv, da, en };
