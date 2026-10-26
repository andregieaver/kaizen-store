/**
 * The words of the company approval emails (wave 6 unit C2, D321, `docs/wave-6-catalogue.md` C.2): to a company's approvers when an order waits for
 * them, and to the buyer when it was approved or declined, by language, joined into `emailText()` as `approval`. Hand-written in nb, sv, da and en
 * (`HAND_WRITTEN_ONLY`: `email:approval.`); never a store's staff in them, and no amount the order does not hold. No imports: `email-text.ts` reads it.
 */

const en = {
  approval: {
    waitingSubject: (store: string, number: string) => `${store}: order ${number} is waiting for your approval`,
    waitingHeading: "An order is waiting for your approval",
    waitingIntro: (buyer: string, number: string, amount: string, location: string) =>
      `${buyer} has placed order ${number} for ${location}, ${amount}, which is over your company's limit.`,
    waitingButton: "See orders to approve",
    waitingDays: (days: number) => `It waits ${days} days; after that it is cancelled.`,
    poLine: (po: string) => `PO number: ${po}`,
    approvedSubject: (store: string, number: string) => `${store}: order ${number} is approved`,
    approvedHeading: "Your order is approved",
    approvedIntro: (number: string) => `Your company has approved order ${number}.`,
    approvedPay: "Pay for it from Your company in your account, and it is sent.",
    approvedTerms: "It is confirmed on your company's payment terms: the invoice follows as usual.",
    approvedButton: "Go to Your company",
    declinedSubject: (store: string, number: string) => `${store}: order ${number} was declined`,
    declinedHeading: "Your order was declined",
    declinedIntro: (number: string) => `Your company did not approve order ${number}, so it is cancelled. Nothing was charged.`,
  },
};

type ApprovalEmail = typeof en;

const nb: ApprovalEmail = {
  approval: {
    waitingSubject: (store, number) => `${store}: ordre ${number} venter på godkjenningen din`,
    waitingHeading: "En ordre venter på godkjenningen din",
    waitingIntro: (buyer, number, amount, location) => `${buyer} har lagt inn ordre ${number} for ${location}, ${amount}, som er over bedriftens grense.`,
    waitingButton: "Se ordrer til godkjenning",
    waitingDays: (days) => `Den venter i ${days} dager; etter det blir den kansellert.`,
    poLine: (po) => `Innkjøpsordrenummer: ${po}`,
    approvedSubject: (store, number) => `${store}: ordre ${number} er godkjent`,
    approvedHeading: "Ordren din er godkjent",
    approvedIntro: (number) => `Bedriften din har godkjent ordre ${number}.`,
    approvedPay: "Betal for den under Din bedrift på kontoen din, så blir den sendt.",
    approvedTerms: "Den er bekreftet på bedriftens betalingsvilkår: fakturaen kommer som vanlig.",
    approvedButton: "Gå til Din bedrift",
    declinedSubject: (store, number) => `${store}: ordre ${number} ble avslått`,
    declinedHeading: "Ordren din ble avslått",
    declinedIntro: (number) => `Bedriften din godkjente ikke ordre ${number}, så den er kansellert. Ingenting ble belastet.`,
  },
};

const sv: ApprovalEmail = {
  approval: {
    waitingSubject: (store, number) => `${store}: order ${number} väntar på ditt godkännande`,
    waitingHeading: "En order väntar på ditt godkännande",
    waitingIntro: (buyer, number, amount, location) => `${buyer} har lagt order ${number} för ${location}, ${amount}, vilket är över företagets gräns.`,
    waitingButton: "Se order att godkänna",
    waitingDays: (days) => `Den väntar i ${days} dagar; därefter avbryts den.`,
    poLine: (po) => `Inköpsordernummer: ${po}`,
    approvedSubject: (store, number) => `${store}: order ${number} är godkänd`,
    approvedHeading: "Din order är godkänd",
    approvedIntro: (number) => `Ditt företag har godkänt order ${number}.`,
    approvedPay: "Betala för den under Ditt företag på ditt konto, så skickas den.",
    approvedTerms: "Den är bekräftad på företagets betalningsvillkor: fakturan kommer som vanligt.",
    approvedButton: "Gå till Ditt företag",
    declinedSubject: (store, number) => `${store}: order ${number} avslogs`,
    declinedHeading: "Din order avslogs",
    declinedIntro: (number) => `Ditt företag godkände inte order ${number}, så den är avbruten. Ingenting debiterades.`,
  },
};

const da: ApprovalEmail = {
  approval: {
    waitingSubject: (store, number) => `${store}: ordre ${number} venter på din godkendelse`,
    waitingHeading: "En ordre venter på din godkendelse",
    waitingIntro: (buyer, number, amount, location) => `${buyer} har afgivet ordre ${number} til ${location}, ${amount}, som er over virksomhedens grænse.`,
    waitingButton: "Se ordrer til godkendelse",
    waitingDays: (days) => `Den venter i ${days} dage; derefter bliver den annulleret.`,
    poLine: (po) => `Indkøbsordrenummer: ${po}`,
    approvedSubject: (store, number) => `${store}: ordre ${number} er godkendt`,
    approvedHeading: "Din ordre er godkendt",
    approvedIntro: (number) => `Din virksomhed har godkendt ordre ${number}.`,
    approvedPay: "Betal for den under Din virksomhed på din konto, så bliver den sendt.",
    approvedTerms: "Den er bekræftet på virksomhedens betalingsbetingelser: fakturaen kommer som sædvanligt.",
    approvedButton: "Gå til Din virksomhed",
    declinedSubject: (store, number) => `${store}: ordre ${number} blev afvist`,
    declinedHeading: "Din ordre blev afvist",
    declinedIntro: (number) => `Din virksomhed godkendte ikke ordre ${number}, så den er annulleret. Der blev ikke trukket noget.`,
  },
};

export const APPROVAL_EMAIL_TEXT = { nb, sv, da, en };
