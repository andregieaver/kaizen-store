/**
 * The words in Kaizen's emails to shoppers (D26), by language. English is
 * the fallback, as for the storefront.
 */
import { earnedText, type OrderBonus } from "./bonus-shopper";
import { registeredEmail } from "./ui-registry";

const text = {
  nb: {
    deliveries: {
      startedSubject: (store: string) => `Abonnementsboksen din fra ${store} er klar`,
      startedHeading: "Abonnementsboksen din er klar",
      startedIntro: (day: string, cutoff: string) =>
        `Vi leverer listen din hver ${day}. Du kan endre den til ${cutoff} før hver levering; endringer etter det gjelder neste.`,
      startedCharge:
        "Vi trekker kortet ditt for hver levering når den er på vei, for det den inneholder til dagens priser. Endrer du ingenting, blir neste levering lik den forrige.",
      startedCancel: "Du kan hoppe over en levering, sette den på pause eller avslutte når du vil, fra siden for abonnementsboksen.",
      preparedSubject: (store: string, date: string) => `Leveringen din fra ${store} ${date}`,
      preparedHeading: "Neste levering",
      preparedIntro: (date: string) => `Leveringen din ${date} blir pakket nå.`,
      preparedCharge: (amount: string) => `Vi trekker ${amount} fra kortet ditt når den er på vei.`,
      leftOutHeading: "Ikke med denne gangen",
      leftOutLine: (title: string, wanted: number, got: number) => (got > 0 ? `${title}: ${got} av ${wanted}` : `${title}: utsolgt`),
      nothingIntro: (date: string) =>
        `Ingenting på listen din var å få til leveringen ${date}, så det blir ingen levering og ingen trekk denne gangen.`,
      manage: "Se eller endre abonnementsboksen",
      cardSubject: (store: string, number: string) => `Betal leveringen ${number} fra ${store}`,
      cardHeading: "Kortet ditt ble ikke trukket",
      cardIntro: (number: string, amount: string) =>
        `Vi fikk ikke trukket ${amount} for leveringen ${number}. Betal her; kortet du betaler med, brukes til de neste leveringene.`,
      payNow: "Betal leveringen",
    },
    /** Angrerett og retur (D153): bekreftelsen på en angring, e-postene om returen og påminnelsen til butikken. Juridisk ordlyd: må kontrolleres av et menneske før bruk. */
    returns: {
      withdrawLine: "Angret du? Du har rett til å angre kjøpet innen 14 dager etter at du fikk varene.",
      costShopper: "Angrer du kjøpet, betaler du selv kostnaden ved å sende varene tilbake.",
      costStore: "Angrer du kjøpet, betaler butikken kostnaden ved å sende varene tilbake.",
      withdrawButton: "Angre avtalen",
      ackSubject: (store: string, number: string) => `Vi har mottatt angringen din for ordre ${number} hos ${store}`,
      ackHeading: "Vi har mottatt angringen din",
      ackIntro: (store: string, number: string, when: string) =>
        `${store} bekrefter at du har angret avtalen for ordre ${number}. Erklæringen din ble registrert ${when}.`,
      ackLinesHeading: "Varene angringen gjelder",
      ackReference: (reference: string) => `Referanse: ${reference}`,
      ackSendBack: (day: string) =>
        `Send varene tilbake uten ugrunnet opphold og senest ${day}, som er 14 dager etter at du ga beskjed om at du angrer.`,
      shopperPays: "Du dekker selv kostnaden ved å sende varene tilbake.",
      storePays: "Butikken dekker kostnaden ved å sende varene tilbake.",
      ackRefundHold: (day: string) =>
        `Vi betaler tilbake det du har betalt for varene uten ugrunnet opphold og senest ${day}, som er 14 dager etter at vi fikk beskjed om at du angrer. Vi kan holde tilbake pengene til vi har fått varene tilbake, eller til du har dokumentert at du har sendt dem.`,
      ackRefundNoHold: (day: string) =>
        `Vi betaler tilbake det du har betalt for varene uten ugrunnet opphold og senest ${day}, som er 14 dager etter at vi fikk beskjed om at du angrer.`,
      ackNothingSent: "Varene var ikke sendt da du angret, så du har ingenting å sende tilbake.",
      ackSealed: "For varer som er forseglet av helse- eller hygienehensyn, og forseglede lyd- eller bildeopptak og programvare, gjelder angreretten bare så lenge forseglingen ikke er brutt. Butikken sjekker det når varene kommer tilbake.",
      ackWholeOrder: "Angrer du hele bestillingen, betaler vi også tilbake den vanlige leveringen du har betalt for.",
      ackValue: "Du hefter bare for verdireduksjon hvis du har brukt varene mer enn nødvendig for å fastslå hva slags vare det er, hvilke egenskaper den har og hvordan den fungerer.",
      instructionsHeading: "Beskjed fra butikken",
      addressHeading: "Send varene til",
      statusButton: "Se status for returen",
      approvedSubject: (store: string, number: string) => `Returen din ${number} hos ${store} er godkjent`,
      approvedHeading: "Returen din er godkjent",
      approvedIntro: (number: string) => `Vi har godkjent retur ${number}. Slik sender du varene tilbake.`,
      labelButton: "Åpne returetiketten",
      declinedSubject: (store: string, number: string) => `Returforespørselen din ${number} hos ${store}`,
      declinedHeading: "Vi kan dessverre ikke ta imot denne returen",
      declinedIntro: (number: string) => `Beklager, men vi kan ikke ta imot returforespørsel ${number}.`,
      declinedReason: (reason: string) => `Begrunnelse: ${reason}`,
      declinedRights: "Dette påvirker ikke de lovfestede rettighetene dine, for eksempel retten til å reklamere på en feil.",
      receivedSubject: (store: string, number: string) => `Vi har mottatt returen din ${number} hos ${store}`,
      receivedHeading: "Vi har mottatt returen din",
      receivedIntro: (number: string) => `Varene i retur ${number} er kommet frem.`,
      receivedNext: "Vi kontrollerer varene og betaler deg tilbake så snart vi kan.",
      refundedSubject: (store: string, number: string) => `Refusjon for retur ${number} hos ${store}`,
      refundedHeading: "Vi har refundert deg",
      refundedIntro: (amount: string, number: string) => `Vi har refundert ${amount} for retur ${number}.`,
      refundedTiming: "Det tar vanligvis 5–10 virkedager før beløpet er tilbake på kontoen din.",
      rowGoods: "Varene",
      rowDeductions: "Fratrekk for verdireduksjon",
      rowShipping: "Levering refundert",
      rowReturnShipping: "Returfrakt",
      rowAdjustment: "Justering fra butikken",
      refundedNote: (note: string) => `Merknad fra butikken: ${note}`,
      deductionNote: (title: string, note: string) => `Fradrag for ${title}: ${note}`,
      rowTotal: "Refundert",
      overdueSubject: (store: string, number: string) => `Refusjon er forsinket: retur ${number} hos ${store}`,
      overdueHeading: "En refusjon er forsinket",
      overdueIntro: (number: string, date: string) =>
        `Retur ${number} skulle vært refundert innen ${date}. Fristen i loven er 14 dager etter at butikken fikk beskjed om angringen.`,
      overdueOpen: "Åpne returen",
    },
    orderSubject: (store: string, number: string) => `Ordrebekreftelse ${number} fra ${store}`,
    orderHeading: "Takk for bestillingen!",
    orderIntro: (number: string) => `Vi har mottatt betalingen for ordre ${number}.`,
    renewalSubject: (store: string, number: string) => `Abonnementet ditt er fornyet: ordre ${number} fra ${store}`,
    renewalIntro: (number: string) => `Abonnementet ditt er fornyet, og ordre ${number} er betalt.`,
    subtotal: "Sum varer",
    discount: "Rabatt",
    shipping: "Frakt",
    total: "Totalt",
    vat: "herav mva.",
    deliverTo: "Leveres til",
    seeOrder: "Se bestillingen",
    downloadsReady: "Filene dine er klare til nedlasting fra bestillingssiden.",
    subscription: (every: string, amount: string) =>
      `Abonnement: fornyes ${every.toLowerCase()} for ${amount} til du sier opp.`,
    manageSubscription: "Se eller endre abonnementet",
    account: "Min konto",
    questions: (email: string) => `Spørsmål? Svar på denne e-posten eller skriv til ${email}.`,
    shippedSubject: (store: string, number: string) => `Ordre ${number} fra ${store} er sendt`,
    shippedHeading: "Pakken er på vei!",
    shippedIntro: (number: string) => `Ordre ${number} er sendt.`,
    tracking: (carrier: string, number: string) => `Sporing: ${carrier} ${number}`.trim(),
    trackParcel: "Spor pakken",
    refundSubject: (store: string, number: string) => `Refusjon for ordre ${number} fra ${store}`,
    refundHeading: "Vi har refundert deg",
    refundIntro: (amount: string, number: string) =>
      `Vi har refundert ${amount} for ordre ${number}. Det tar vanligvis 5–10 virkedager før beløpet er tilbake på kontoen din.`,
    cancelledSubject: (store: string, number: string) => `Ordre ${number} fra ${store} er kansellert`,
    cancelledHeading: "Bestillingen er kansellert",
    cancelledIntro: (number: string, amount: string) =>
      `Ordre ${number} er kansellert, og ${amount} er refundert.`,
    cancelledUnpaidIntro: (number: string) => `Ordre ${number} er kansellert. Ingenting ble trukket.`,
    /** Appointments (D65). */
    bookingMovedSubject: (store: string, when: string) => `Ny tid hos ${store}: ${when}`,
    bookingMovedHeading: "Timen er flyttet",
    bookingMovedIntro: (when: string) => `Timen din er nå ${when}.`,
    bookingCancelledByYouSubject: (store: string, when: string) => `Du har avbestilt timen ${when} hos ${store}`,
    bookingCancelledByYouHeading: "Timen er avbestilt",
    bookingCancelledByYouIntro: (service: string, when: string, refund: string | null) =>
      `Du har avbestilt ${service} ${when}.${refund ? ` Vi betaler tilbake ${refund}; det tar vanligvis 5–10 virkedager.` : ""}`,
    appointmentsHeading: "Timen din",
    calendarNote: "Legg timen i kalenderen din med vedlegget.",
    bookingReminderSubject: (store: string, when: string) => `Påminnelse: timen din hos ${store} ${when}`,
    bookingReminderHeading: "Vi ses snart",
    bookingReminderIntro: (when: string) => `Dette er en påminnelse om timen din ${when}.`,
    bookingCancelledSubject: (store: string, when: string) => `Timen din hos ${store} ${when} er avlyst`,
    bookingCancelledHeading: "Timen er avlyst",
    bookingCancelledIntro: (service: string, when: string) =>
      `Vi har dessverre måttet avlyse ${service} ${when}. Svar på denne e-posten hvis du vil ha en ny tid eller har spørsmål om betalingen.`,
    codeSubject: (store: string) => `Innloggingskode for ${store}`,
    codeHeading: "Innloggingskoden din",
    codeIntro: "Skriv inn koden for å logge inn. Den virker i 10 minutter.",
    codeIgnore: "Ba du ikke om denne koden? Da kan du se bort fra e-posten.",
    resetSubject: (store: string) => `Nytt passord hos ${store}`,
    resetHeading: "Koden for nytt passord",
    resetIntro: "Skriv inn koden og velg et nytt passord. Den virker i 10 minutter.",
    welcomeSubject: (store: string) => `Velkommen til ${store}`,
    welcomeHeading: "Kontoen din er klar",
    welcomeIntro: (email: string) => `Du logger inn på Min konto med ${email} og passordet du valgte. Der ser du bestillinger og abonnementer, og kan endre opplysningene dine.`,
    welcomeButton: "Gå til Min konto",
    welcomeIgnore: "Opprettet du ikke denne kontoen? Svar på denne e-posten, så sletter butikken den.",
    company: {
      inviteSubject: (company: string, store: string) => `${company} inviterer deg til ${store}`,
      inviteHeading: (company: string) => `Du er invitert til ${company}`,
      inviteIntro: (inviter: string, company: string, store: string) =>
        `${inviter} har invitert deg til å bli med i kontoen til ${company} hos ${store}.`,
      inviteDiscount: (percent: string) => `Som ansatt får du ${percent} % rabatt på det du kjøper.`,
      inviteButton: "Godta invitasjonen",
      inviteExpires: (date: string) => `Invitasjonen kan godtas til ${date}.`,
      inviteIgnore: "Ventet du ikke denne? Ignorer e-posten, så skjer ingenting før du godtar.",
      joinedSubject: (store: string) => `Du er med hos ${store}`,
      joinedHeading: (company: string) => `Du er nå med i ${company}`,
      joinedNew: (email: string) => `Vi har opprettet en konto for ${email}. Bruk knappen under for å logge inn.`,
      joinedExisting: (email: string) => `Kontoen din (${email}) er nå knyttet til firmaet. Bruk knappen under for å logge inn.`,
      joinedDiscount: (percent: string) => `Du får ${percent} % rabatt på det du kjøper når du er logget inn.`,
      joinedButton: "Logg inn",
      joinedLinkNote: "Lenken virker én gang og i sju dager. Etterpå kan du logge inn med en kode fra Min konto.",
      endedSubject: (company: string) => `Du er ikke lenger med i ${company}`,
      endedHeading: "Firmarabatten din er avsluttet",
      endedIntro: (company: string, store: string) =>
        `Du er ikke lenger knyttet til ${company} hos ${store}, så firmarabatten gjelder ikke lenger. Kontoen din og bestillingene dine er som før.`,
    },
    /** The bonus program (D130): the credits on an order confirmation, and the reminder before credits expire. */
    bonus: {
      usedRow: "Bonuskreditt brukt",
      earnedLine: (amount: string, date: string) => `Du tjente ${amount} i bonuskreditt, som kan brukes fra ${date}.`,
      earnedNow: (amount: string) => `Du tjente ${amount} i bonuskreditt, som du kan bruke nå.`,
      expirySubject: (store: string, date: string) => `Bonuskreditten din hos ${store} utløper ${date}`,
      expiryHeading: "Bonuskreditten din utløper snart",
      expiryGreeting: (name: string) => `Hei, ${name}!`,
      expiryGreetingAnon: "Hei!",
      expiryIntro: (amount: string, date: string) => `${amount} av bonuskreditten din utløper ${date}.`,
      expiryHow: "Bruk den på neste bestilling: kreditten trekkes fra prisen på varer i kassen.",
      expiryButton: "Se bonuskreditten min",
    },
    /** The referral program (D131): the friend's welcome discount on an order confirmation, and the referrer's email when a friend's order earned credits. */
    affiliate: {
      discountRow: "Velkomstrabatt",
      earnedSubject: (store: string) => `Du har tjent bonuskreditt hos ${store}`,
      earnedHeading: "En venn bestilte via lenken din",
      earnedGreeting: (name: string) => `Hei, ${name}!`,
      earnedGreetingAnon: "Hei!",
      earnedLine: (amount: string, date: string) => `Du tjente ${amount} i bonuskreditt, som kan brukes fra ${date}.`,
      earnedNow: (amount: string) => `Du tjente ${amount} i bonuskreditt, som du kan bruke nå.`,
      earnedHow: "Takk for at du sprer ordet. Kreditten trekkes tilbake hvis bestillingen refunderes eller kanselleres.",
      earnedButton: "Se tipsene mine",
    },
    /** Work invoices (docs/work.md 4.7): the invoice, credit note and payment reminder emails. */
    work: {
      invoiceSubject: (store: string, number: string) => `Faktura ${number} fra ${store}`,
      invoiceHeading: (number: string) => `Faktura ${number}`,
      invoiceIntro: (store: string) => `${store} har sendt deg en faktura.`,
      invoiceAmount: "Beløp å betale",
      invoiceDue: "Forfallsdato",
      invoiceOpen: "Se fakturaen",
      invoiceHosted: "Fra lenken kan du se fakturaen, skrive den ut eller lagre den som PDF. Du trenger ikke logge inn.",
      creditSubject: (store: string, number: string) => `Kreditnota ${number} fra ${store}`,
      creditHeading: (number: string) => `Kreditnota ${number}`,
      creditIntro: (store: string, invoice: string) => `${store} har utstedt en kreditnota for faktura ${invoice}.`,
      creditAmount: "Kreditert beløp",
      creditOpen: "Se kreditnotaen",
      reminderSubject: (store: string, number: string) => `Påminnelse: faktura ${number} fra ${store}`,
      reminderHeading: "Betalingspåminnelse",
      reminderIntro: (number: string, due: string) => `Faktura ${number} med forfall ${due} er ifølge våre opplysninger ikke betalt. Har du allerede betalt, kan du se bort fra denne påminnelsen.`,
      reminderAmount: "Utestående beløp",
    },
    reminderSubject: (store: string, date: string) => `Abonnementet ditt hos ${store} fornyes ${date}`,
    reminderHeading: "Påminnelse om fornyelse",
    reminderIntro: (date: string, amount: string) =>
      `Abonnementet ditt fornyes ${date}, og du blir belastet ${amount}.`,
    reminderChange: "Du kan hoppe over, sette på pause, endre eller si opp før da.",
    trialSubject: (store: string, date: string) => `Prøveperioden din hos ${store} slutter ${date}`,
    trialHeading: "Prøveperioden nærmer seg slutten",
    trialIntro: (date: string, amount: string) =>
      `Prøveperioden slutter ${date}. Deretter fortsetter abonnementet, og du blir belastet ${amount}.`,
    changedSubject: (store: string) => `Abonnementet ditt hos ${store} er endret`,
    changedHeading: "Abonnementet er endret",
    changes: {
      cancel: (date: string) => `Abonnementet avsluttes ${date}. Du blir ikke belastet mer.`,
      resume: () => "Abonnementet fortsetter som før.",
      cancel_now: () => "Abonnementet er avsluttet.",
      pause: (date: string) => `Abonnementet er satt på pause til ${date}.`,
      unpause: () => "Pausen er avsluttet, og abonnementet fortsetter.",
      skip: (date: string) => `Neste levering er hoppet over. Neste belastning blir ${date}.`,
      change: () => "Innholdet i abonnementet er endret fra neste fornyelse.",
    },
  },
  sv: {
    deliveries: {
      startedSubject: (store: string) => `Din prenumerationsbox från ${store} är klar`,
      startedHeading: "Din prenumerationsbox är klar",
      startedIntro: (day: string, cutoff: string) =>
        `Vi levererar din lista varje ${day}. Du kan ändra den till ${cutoff} före varje leverans; ändringar efter det gäller nästa.`,
      startedCharge:
        "Vi drar pengarna från ditt kort för varje leverans när den är på väg, för det den innehåller till dagens priser. Ändrar du inget blir nästa leverans likadan som den förra.",
      startedCancel: "Du kan hoppa över en leverans, pausa eller avsluta när du vill, på sidan för din prenumerationsbox.",
      preparedSubject: (store: string, date: string) => `Din leverans från ${store} ${date}`,
      preparedHeading: "Nästa leverans",
      preparedIntro: (date: string) => `Din leverans ${date} packas nu.`,
      preparedCharge: (amount: string) => `Vi drar ${amount} från ditt kort när den är på väg.`,
      leftOutHeading: "Inte med den här gången",
      leftOutLine: (title: string, wanted: number, got: number) => (got > 0 ? `${title}: ${got} av ${wanted}` : `${title}: slutsåld`),
      nothingIntro: (date: string) =>
        `Inget på din lista gick att få till leveransen ${date}, så det blir ingen leverans och inget köp den här gången.`,
      manage: "Se eller ändra din prenumerationsbox",
      cardSubject: (store: string, number: string) => `Betala leveransen ${number} från ${store}`,
      cardHeading: "Ditt kort drogs inte",
      cardIntro: (number: string, amount: string) =>
        `Vi kunde inte dra ${amount} för leveransen ${number}. Betala här; kortet du betalar med används för kommande leveranser.`,
      payNow: "Betala leveransen",
    },
    /** Ångerrätt och retur (D153): bekräftelsen på en ångran, mejlen om returen och påminnelsen till butiken. Juridisk formulering: måste granskas av en människa före bruk. */
    returns: {
      withdrawLine: "Ångrat dig? Du har rätt att ångra köpet inom 14 dagar efter att du fick varorna.",
      costShopper: "Ångrar du köpet står du själv för kostnaden för att skicka tillbaka varorna.",
      costStore: "Ångrar du köpet står butiken för kostnaden för att skicka tillbaka varorna.",
      withdrawButton: "Ångra avtalet",
      ackSubject: (store: string, number: string) => `Vi har tagit emot din ångran för order ${number} hos ${store}`,
      ackHeading: "Vi har tagit emot din ångran",
      ackIntro: (store: string, number: string, when: string) =>
        `${store} bekräftar att du har ångrat avtalet för order ${number}. Ditt meddelande registrerades ${when}.`,
      ackLinesHeading: "Varorna ångran gäller",
      ackReference: (reference: string) => `Referens: ${reference}`,
      ackSendBack: (day: string) =>
        `Skicka tillbaka varorna utan onödigt dröjsmål och senast ${day}, som är 14 dagar efter att du meddelade att du ångrar dig.`,
      shopperPays: "Du betalar själv kostnaden för att skicka tillbaka varorna.",
      storePays: "Butiken betalar kostnaden för att skicka tillbaka varorna.",
      ackRefundHold: (day: string) =>
        `Vi betalar tillbaka det du har betalat för varorna utan onödigt dröjsmål och senast ${day}, som är 14 dagar efter att vi fick veta att du ångrar dig. Vi kan vänta med återbetalningen tills vi har fått tillbaka varorna eller du har visat att du har skickat dem.`,
      ackRefundNoHold: (day: string) =>
        `Vi betalar tillbaka det du har betalat för varorna utan onödigt dröjsmål och senast ${day}, som är 14 dagar efter att vi fick veta att du ångrar dig.`,
      ackNothingSent: "Varorna hade inte skickats när du ångrade dig, så du har inget att skicka tillbaka.",
      ackSealed: "För varor som är förseglade av hälso- eller hygienskäl, och förseglade ljud- eller bildupptagningar och programvara, gäller ångerrätten bara så länge förseglingen inte är bruten. Butiken kontrollerar det när varorna kommer tillbaka.",
      ackWholeOrder: "Ångrar du hela beställningen betalar vi också tillbaka den vanliga leveransen du har betalat för.",
      ackValue: "Du ansvarar bara för värdeminskning om du har hanterat varorna mer än vad som behövs för att fastställa deras art, egenskaper och funktion.",
      instructionsHeading: "Besked från butiken",
      addressHeading: "Skicka varorna till",
      statusButton: "Se status för returen",
      approvedSubject: (store: string, number: string) => `Din retur ${number} hos ${store} är godkänd`,
      approvedHeading: "Din retur är godkänd",
      approvedIntro: (number: string) => `Vi har godkänt retur ${number}. Så här skickar du tillbaka varorna.`,
      labelButton: "Öppna returetiketten",
      declinedSubject: (store: string, number: string) => `Din returförfrågan ${number} hos ${store}`,
      declinedHeading: "Vi kan tyvärr inte ta emot den här returen",
      declinedIntro: (number: string) => `Tyvärr kan vi inte ta emot returförfrågan ${number}.`,
      declinedReason: (reason: string) => `Motivering: ${reason}`,
      declinedRights: "Det här påverkar inte dina lagstadgade rättigheter, till exempel rätten att reklamera ett fel.",
      receivedSubject: (store: string, number: string) => `Vi har tagit emot din retur ${number} hos ${store}`,
      receivedHeading: "Vi har tagit emot din retur",
      receivedIntro: (number: string) => `Varorna i retur ${number} har kommit fram.`,
      receivedNext: "Vi kontrollerar varorna och betalar tillbaka så snart vi kan.",
      refundedSubject: (store: string, number: string) => `Återbetalning för retur ${number} hos ${store}`,
      refundedHeading: "Vi har återbetalat",
      refundedIntro: (amount: string, number: string) => `Vi har återbetalat ${amount} för retur ${number}.`,
      refundedTiming: "Det tar vanligtvis 5–10 arbetsdagar innan beloppet är tillbaka på ditt konto.",
      rowGoods: "Varorna",
      rowDeductions: "Avdrag för värdeminskning",
      rowShipping: "Leverans återbetald",
      rowReturnShipping: "Returfrakt",
      rowAdjustment: "Justering från butiken",
      refundedNote: (note: string) => `Meddelande från butiken: ${note}`,
      deductionNote: (title: string, note: string) => `Avdrag för ${title}: ${note}`,
      rowTotal: "Återbetalat",
      overdueSubject: (store: string, number: string) => `Försenad återbetalning: retur ${number} hos ${store}`,
      overdueHeading: "En återbetalning är försenad",
      overdueIntro: (number: string, date: string) =>
        `Retur ${number} skulle ha återbetalats senast ${date}. Lagens frist är 14 dagar efter att butiken fick veta att kunden ångrade sig.`,
      overdueOpen: "Öppna returen",
    },
    orderSubject: (store: string, number: string) => `Orderbekräftelse ${number} från ${store}`,
    orderHeading: "Tack för din beställning!",
    orderIntro: (number: string) => `Vi har tagit emot betalningen för order ${number}.`,
    renewalSubject: (store: string, number: string) => `Din prenumeration har förnyats: order ${number} från ${store}`,
    renewalIntro: (number: string) => `Din prenumeration har förnyats och order ${number} är betald.`,
    subtotal: "Summa varor",
    discount: "Rabatt",
    shipping: "Frakt",
    total: "Totalt",
    vat: "varav moms",
    deliverTo: "Levereras till",
    seeOrder: "Se beställningen",
    downloadsReady: "Dina filer är redo att laddas ned från beställningssidan.",
    subscription: (every: string, amount: string) =>
      `Prenumeration: förnyas ${every.toLowerCase()} för ${amount} tills du säger upp den.`,
    manageSubscription: "Se eller ändra prenumerationen",
    account: "Mitt konto",
    questions: (email: string) => `Frågor? Svara på det här mejlet eller skriv till ${email}.`,
    shippedSubject: (store: string, number: string) => `Order ${number} från ${store} har skickats`,
    shippedHeading: "Paketet är på väg!",
    shippedIntro: (number: string) => `Order ${number} har skickats.`,
    tracking: (carrier: string, number: string) => `Spårning: ${carrier} ${number}`.trim(),
    trackParcel: "Spåra paketet",
    refundSubject: (store: string, number: string) => `Återbetalning för order ${number} från ${store}`,
    refundHeading: "Vi har återbetalat dig",
    refundIntro: (amount: string, number: string) =>
      `Vi har återbetalat ${amount} för order ${number}. Det tar oftast 5–10 bankdagar innan beloppet syns på ditt konto.`,
    cancelledSubject: (store: string, number: string) => `Order ${number} från ${store} har avbrutits`,
    cancelledHeading: "Beställningen har avbrutits",
    cancelledIntro: (number: string, amount: string) =>
      `Order ${number} har avbrutits och ${amount} har återbetalats.`,
    cancelledUnpaidIntro: (number: string) => `Order ${number} är avbruten. Inget har dragits.`,
    /** Appointments (D65). */
    bookingMovedSubject: (store: string, when: string) => `Ny tid hos ${store}: ${when}`,
    bookingMovedHeading: "Tiden är flyttad",
    bookingMovedIntro: (when: string) => `Din tid är nu ${when}.`,
    bookingCancelledByYouSubject: (store: string, when: string) => `Du har avbokat tiden ${when} hos ${store}`,
    bookingCancelledByYouHeading: "Tiden är avbokad",
    bookingCancelledByYouIntro: (service: string, when: string, refund: string | null) =>
      `Du har avbokat ${service} ${when}.${refund ? ` Vi betalar tillbaka ${refund}; det tar oftast 5–10 bankdagar.` : ""}`,
    appointmentsHeading: "Din tid",
    calendarNote: "Lägg in tiden i din kalender med bilagan.",
    bookingReminderSubject: (store: string, when: string) => `Påminnelse: din tid hos ${store} ${when}`,
    bookingReminderHeading: "Vi ses snart",
    bookingReminderIntro: (when: string) => `Det här är en påminnelse om din tid ${when}.`,
    bookingCancelledSubject: (store: string, when: string) => `Din tid hos ${store} ${when} är inställd`,
    bookingCancelledHeading: "Tiden är inställd",
    bookingCancelledIntro: (service: string, when: string) =>
      `Vi har tyvärr fått ställa in ${service} ${when}. Svara på det här mejlet om du vill boka en ny tid eller har frågor om betalningen.`,
    codeSubject: (store: string) => `Inloggningskod för ${store}`,
    codeHeading: "Din inloggningskod",
    codeIntro: "Ange koden för att logga in. Den gäller i 10 minuter.",
    codeIgnore: "Bad du inte om koden? Då kan du bortse från mejlet.",
    resetSubject: (store: string) => `Nytt lösenord hos ${store}`,
    resetHeading: "Koden för nytt lösenord",
    resetIntro: "Ange koden och välj ett nytt lösenord. Den gäller i 10 minuter.",
    welcomeSubject: (store: string) => `Välkommen till ${store}`,
    welcomeHeading: "Ditt konto är klart",
    welcomeIntro: (email: string) => `Du loggar in på Mitt konto med ${email} och lösenordet du valde. Där ser du beställningar och prenumerationer och kan ändra dina uppgifter.`,
    welcomeButton: "Till Mitt konto",
    welcomeIgnore: "Skapade du inte kontot? Svara på mejlet, så tar butiken bort det.",
    company: {
      inviteSubject: (company: string, store: string) => `${company} bjuder in dig till ${store}`,
      inviteHeading: (company: string) => `Du är inbjuden till ${company}`,
      inviteIntro: (inviter: string, company: string, store: string) =>
        `${inviter} har bjudit in dig att gå med i ${company}s konto hos ${store}.`,
      inviteDiscount: (percent: string) => `Som anställd får du ${percent} % rabatt på det du köper.`,
      inviteButton: "Acceptera inbjudan",
      inviteExpires: (date: string) => `Inbjudan kan accepteras till ${date}.`,
      inviteIgnore: "Väntade du dig inte detta? Ignorera mejlet, så händer inget förrän du accepterar.",
      joinedSubject: (store: string) => `Du är med hos ${store}`,
      joinedHeading: (company: string) => `Du är nu med i ${company}`,
      joinedNew: (email: string) => `Vi har skapat ett konto för ${email}. Använd knappen nedan för att logga in.`,
      joinedExisting: (email: string) => `Ditt konto (${email}) är nu kopplat till företaget. Använd knappen nedan för att logga in.`,
      joinedDiscount: (percent: string) => `Du får ${percent} % rabatt på det du köper när du är inloggad.`,
      joinedButton: "Logga in",
      joinedLinkNote: "Länken fungerar en gång och i sju dagar. Därefter kan du logga in med en kod från Mitt konto.",
      endedSubject: (company: string) => `Du är inte längre med i ${company}`,
      endedHeading: "Din företagsrabatt har avslutats",
      endedIntro: (company: string, store: string) =>
        `Du är inte längre kopplad till ${company} hos ${store}, så företagsrabatten gäller inte längre. Ditt konto och dina beställningar är som förut.`,
    },
    /** The bonus program (D130): the credits on an order confirmation, and the reminder before credits expire. */
    bonus: {
      usedRow: "Bonuskredit använd",
      earnedLine: (amount: string, date: string) => `Du tjänade ${amount} i bonuskredit, som kan användas från ${date}.`,
      earnedNow: (amount: string) => `Du tjänade ${amount} i bonuskredit, som du kan använda nu.`,
      expirySubject: (store: string, date: string) => `Din bonuskredit hos ${store} går ut ${date}`,
      expiryHeading: "Din bonuskredit går snart ut",
      expiryGreeting: (name: string) => `Hej, ${name}!`,
      expiryGreetingAnon: "Hej!",
      expiryIntro: (amount: string, date: string) => `${amount} av din bonuskredit går ut ${date}.`,
      expiryHow: "Använd den på nästa beställning: krediten dras av från priset på varor i kassan.",
      expiryButton: "Se min bonuskredit",
    },
    /** The referral program (D131): the friend's welcome discount on an order confirmation, and the referrer's email when a friend's order earned credits. */
    affiliate: {
      discountRow: "Välkomstrabatt",
      earnedSubject: (store: string) => `Du har tjänat bonuskredit hos ${store}`,
      earnedHeading: "En vän beställde via din länk",
      earnedGreeting: (name: string) => `Hej, ${name}!`,
      earnedGreetingAnon: "Hej!",
      earnedLine: (amount: string, date: string) => `Du tjänade ${amount} i bonuskredit, som kan användas från ${date}.`,
      earnedNow: (amount: string) => `Du tjänade ${amount} i bonuskredit, som du kan använda nu.`,
      earnedHow: "Tack för att du sprider ordet. Krediten dras tillbaka om beställningen återbetalas eller avbeställs.",
      earnedButton: "Se mina tips",
    },
    /** Work invoices (docs/work.md 4.7): the invoice, credit note and payment reminder emails. */
    work: {
      invoiceSubject: (store: string, number: string) => `Faktura ${number} från ${store}`,
      invoiceHeading: (number: string) => `Faktura ${number}`,
      invoiceIntro: (store: string) => `${store} har skickat en faktura till dig.`,
      invoiceAmount: "Belopp att betala",
      invoiceDue: "Förfallodatum",
      invoiceOpen: "Visa fakturan",
      invoiceHosted: "Via länken kan du se fakturan, skriva ut den eller spara den som PDF. Du behöver inte logga in.",
      creditSubject: (store: string, number: string) => `Kreditfaktura ${number} från ${store}`,
      creditHeading: (number: string) => `Kreditfaktura ${number}`,
      creditIntro: (store: string, invoice: string) => `${store} har utfärdat en kreditfaktura för faktura ${invoice}.`,
      creditAmount: "Krediterat belopp",
      creditOpen: "Visa kreditfakturan",
      reminderSubject: (store: string, number: string) => `Påminnelse: faktura ${number} från ${store}`,
      reminderHeading: "Betalningspåminnelse",
      reminderIntro: (number: string, due: string) => `Faktura ${number} med förfallodag ${due} är enligt våra uppgifter inte betald. Har du redan betalat kan du bortse från denna påminnelse.`,
      reminderAmount: "Utestående belopp",
    },
    reminderSubject: (store: string, date: string) => `Din prenumeration hos ${store} förnyas ${date}`,
    reminderHeading: "Påminnelse om förnyelse",
    reminderIntro: (date: string, amount: string) =>
      `Din prenumeration förnyas ${date} och du debiteras ${amount}.`,
    reminderChange: "Du kan hoppa över, pausa, ändra eller säga upp före dess.",
    trialSubject: (store: string, date: string) => `Din provperiod hos ${store} slutar ${date}`,
    trialHeading: "Provperioden närmar sig sitt slut",
    trialIntro: (date: string, amount: string) =>
      `Provperioden slutar ${date}. Därefter fortsätter prenumerationen och du debiteras ${amount}.`,
    changedSubject: (store: string) => `Din prenumeration hos ${store} har ändrats`,
    changedHeading: "Prenumerationen har ändrats",
    changes: {
      cancel: (date: string) => `Prenumerationen avslutas ${date}. Du debiteras inte mer.`,
      resume: () => "Prenumerationen fortsätter som tidigare.",
      cancel_now: () => "Prenumerationen är avslutad.",
      pause: (date: string) => `Prenumerationen är pausad till ${date}.`,
      unpause: () => "Pausen är avslutad och prenumerationen fortsätter.",
      skip: (date: string) => `Nästa leverans hoppas över. Nästa debitering blir ${date}.`,
      change: () => "Innehållet i prenumerationen ändras från nästa förnyelse.",
    },
  },
  da: {
    deliveries: {
      startedSubject: (store: string) => `Din abonnementsboks fra ${store} er klar`,
      startedHeading: "Din abonnementsboks er klar",
      startedIntro: (day: string, cutoff: string) =>
        `Vi leverer din liste hver ${day}. Du kan ændre den indtil ${cutoff} før hver levering; ændringer derefter gælder den næste.`,
      startedCharge:
        "Vi trækker dit kort for hver levering, når den er på vej, for det den indeholder til dagens priser. Ændrer du intet, bliver næste levering som den forrige.",
      startedCancel: "Du kan springe en levering over, sætte den på pause eller afslutte når som helst på siden for din abonnementsboks.",
      preparedSubject: (store: string, date: string) => `Din levering fra ${store} ${date}`,
      preparedHeading: "Næste levering",
      preparedIntro: (date: string) => `Din levering ${date} bliver pakket nu.`,
      preparedCharge: (amount: string) => `Vi trækker ${amount} på dit kort, når den er på vej.`,
      leftOutHeading: "Ikke med denne gang",
      leftOutLine: (title: string, wanted: number, got: number) => (got > 0 ? `${title}: ${got} af ${wanted}` : `${title}: udsolgt`),
      nothingIntro: (date: string) =>
        `Intet på din liste kunne fås til leveringen ${date}, så der er ingen levering og intet træk denne gang.`,
      manage: "Se eller ændr din abonnementsboks",
      cardSubject: (store: string, number: string) => `Betal leveringen ${number} fra ${store}`,
      cardHeading: "Dit kort blev ikke trukket",
      cardIntro: (number: string, amount: string) =>
        `Vi kunne ikke trække ${amount} for leveringen ${number}. Betal her; kortet du betaler med, bruges til de næste leveringer.`,
      payNow: "Betal leveringen",
    },
    /** Fortrydelsesret og retur (D153): bekræftelsen på en fortrydelse, e-mails om returen og påmindelsen til butikken. Juridisk ordlyd: skal gennemgås af et menneske før brug. */
    returns: {
      withdrawLine: "Fortrudt? Du har ret til at fortryde købet inden for 14 dage efter, at du har fået varerne.",
      costShopper: "Fortryder du købet, betaler du selv for at sende varerne tilbage.",
      costStore: "Fortryder du købet, betaler butikken for at sende varerne tilbage.",
      withdrawButton: "Fortryd aftalen",
      ackSubject: (store: string, number: string) => `Vi har modtaget din fortrydelse af ordre ${number} hos ${store}`,
      ackHeading: "Vi har modtaget din fortrydelse",
      ackIntro: (store: string, number: string, when: string) =>
        `${store} bekræfter, at du har fortrudt aftalen for ordre ${number}. Din meddelelse blev registreret ${when}.`,
      ackLinesHeading: "Varerne fortrydelsen gælder",
      ackReference: (reference: string) => `Reference: ${reference}`,
      ackSendBack: (day: string) =>
        `Send varerne tilbage uden unødig forsinkelse og senest ${day}, som er 14 dage efter, at du gav besked om, at du fortryder.`,
      shopperPays: "Du betaler selv for at sende varerne tilbage.",
      storePays: "Butikken betaler for at sende varerne tilbage.",
      ackRefundHold: (day: string) =>
        `Vi betaler det, du har betalt for varerne, tilbage uden unødig forsinkelse og senest ${day}, som er 14 dage efter, at vi fik besked om, at du fortryder. Vi kan tilbageholde pengene, indtil vi har fået varerne tilbage, eller du har dokumenteret, at du har sendt dem.`,
      ackRefundNoHold: (day: string) =>
        `Vi betaler det, du har betalt for varerne, tilbage uden unødig forsinkelse og senest ${day}, som er 14 dage efter, at vi fik besked om, at du fortryder.`,
      ackNothingSent: "Varerne var ikke sendt, da du fortrød, så du har intet at sende tilbage.",
      ackSealed: "For varer, der er forseglet af hensyn til sundhed eller hygiejne, og forseglede lyd- eller billedoptagelser og software, gælder fortrydelsesretten kun, så længe forseglingen ikke er brudt. Butikken tjekker det, når varerne kommer tilbage.",
      ackWholeOrder: "Fortryder du hele ordren, betaler vi også den almindelige levering, du har betalt for, tilbage.",
      ackValue: "Du hæfter kun for værdiforringelse, hvis du har håndteret varerne mere, end der skulle til for at fastslå deres art, egenskaber og funktionsmåde.",
      instructionsHeading: "Besked fra butikken",
      addressHeading: "Send varerne til",
      statusButton: "Se status for returneringen",
      approvedSubject: (store: string, number: string) => `Din returnering ${number} hos ${store} er godkendt`,
      approvedHeading: "Din returnering er godkendt",
      approvedIntro: (number: string) => `Vi har godkendt returnering ${number}. Sådan sender du varerne tilbage.`,
      labelButton: "Åbn returlabelen",
      declinedSubject: (store: string, number: string) => `Din anmodning om returnering ${number} hos ${store}`,
      declinedHeading: "Vi kan desværre ikke modtage denne returnering",
      declinedIntro: (number: string) => `Beklager, men vi kan ikke modtage anmodning om returnering ${number}.`,
      declinedReason: (reason: string) => `Begrundelse: ${reason}`,
      declinedRights: "Det påvirker ikke dine lovbestemte rettigheder, for eksempel retten til at reklamere over en fejl.",
      receivedSubject: (store: string, number: string) => `Vi har modtaget din returnering ${number} hos ${store}`,
      receivedHeading: "Vi har modtaget din returnering",
      receivedIntro: (number: string) => `Varerne i returnering ${number} er kommet frem.`,
      receivedNext: "Vi kontrollerer varerne og betaler dig tilbage, så snart vi kan.",
      refundedSubject: (store: string, number: string) => `Tilbagebetaling for returnering ${number} hos ${store}`,
      refundedHeading: "Vi har tilbagebetalt dig",
      refundedIntro: (amount: string, number: string) => `Vi har tilbagebetalt ${amount} for returnering ${number}.`,
      refundedTiming: "Det tager normalt 5–10 hverdage, før beløbet er tilbage på din konto.",
      rowGoods: "Varerne",
      rowDeductions: "Fradrag for værdiforringelse",
      rowShipping: "Levering tilbagebetalt",
      rowReturnShipping: "Returfragt",
      rowAdjustment: "Justering fra butikken",
      refundedNote: (note: string) => `Bemærkning fra butikken: ${note}`,
      deductionNote: (title: string, note: string) => `Fradrag for ${title}: ${note}`,
      rowTotal: "Tilbagebetalt",
      overdueSubject: (store: string, number: string) => `Forsinket tilbagebetaling: returnering ${number} hos ${store}`,
      overdueHeading: "En tilbagebetaling er forsinket",
      overdueIntro: (number: string, date: string) =>
        `Returnering ${number} skulle have været tilbagebetalt senest ${date}. Lovens frist er 14 dage efter, at butikken fik besked om fortrydelsen.`,
      overdueOpen: "Åbn returneringen",
    },
    orderSubject: (store: string, number: string) => `Ordrebekræftelse ${number} fra ${store}`,
    orderHeading: "Tak for din bestilling!",
    orderIntro: (number: string) => `Vi har modtaget betalingen for ordre ${number}.`,
    renewalSubject: (store: string, number: string) => `Dit abonnement er fornyet: ordre ${number} fra ${store}`,
    renewalIntro: (number: string) => `Dit abonnement er fornyet, og ordre ${number} er betalt.`,
    subtotal: "Varer i alt",
    discount: "Rabat",
    shipping: "Fragt",
    total: "I alt",
    vat: "heraf moms",
    deliverTo: "Leveres til",
    seeOrder: "Se bestillingen",
    downloadsReady: "Dine filer er klar til download fra bestillingssiden.",
    subscription: (every: string, amount: string) =>
      `Abonnement: fornyes ${every.toLowerCase()} for ${amount}, indtil du opsiger det.`,
    manageSubscription: "Se eller ændr abonnementet",
    account: "Min konto",
    questions: (email: string) => `Spørgsmål? Svar på denne mail, eller skriv til ${email}.`,
    shippedSubject: (store: string, number: string) => `Ordre ${number} fra ${store} er sendt`,
    shippedHeading: "Pakken er på vej!",
    shippedIntro: (number: string) => `Ordre ${number} er sendt.`,
    tracking: (carrier: string, number: string) => `Sporing: ${carrier} ${number}`.trim(),
    trackParcel: "Spor pakken",
    refundSubject: (store: string, number: string) => `Refundering for ordre ${number} fra ${store}`,
    refundHeading: "Vi har refunderet dig",
    refundIntro: (amount: string, number: string) =>
      `Vi har refunderet ${amount} for ordre ${number}. Der går normalt 5–10 bankdage, før beløbet er tilbage på din konto.`,
    cancelledSubject: (store: string, number: string) => `Ordre ${number} fra ${store} er annulleret`,
    cancelledHeading: "Bestillingen er annulleret",
    cancelledIntro: (number: string, amount: string) =>
      `Ordre ${number} er annulleret, og ${amount} er refunderet.`,
    cancelledUnpaidIntro: (number: string) => `Ordre ${number} er annulleret. Intet blev trukket.`,
    /** Appointments (D65). */
    bookingMovedSubject: (store: string, when: string) => `Ny tid hos ${store}: ${when}`,
    bookingMovedHeading: "Tiden er flyttet",
    bookingMovedIntro: (when: string) => `Din tid er nu ${when}.`,
    bookingCancelledByYouSubject: (store: string, when: string) => `Du har afbestilt tiden ${when} hos ${store}`,
    bookingCancelledByYouHeading: "Tiden er afbestilt",
    bookingCancelledByYouIntro: (service: string, when: string, refund: string | null) =>
      `Du har afbestilt ${service} ${when}.${refund ? ` Vi betaler ${refund} tilbage; det tager normalt 5–10 hverdage.` : ""}`,
    appointmentsHeading: "Din tid",
    calendarNote: "Tilføj tiden til din kalender med vedhæftningen.",
    bookingReminderSubject: (store: string, when: string) => `Påmindelse: din tid hos ${store} ${when}`,
    bookingReminderHeading: "Vi ses snart",
    bookingReminderIntro: (when: string) => `Dette er en påmindelse om din tid ${when}.`,
    bookingCancelledSubject: (store: string, when: string) => `Din tid hos ${store} ${when} er aflyst`,
    bookingCancelledHeading: "Tiden er aflyst",
    bookingCancelledIntro: (service: string, when: string) =>
      `Vi har desværre måttet aflyse ${service} ${when}. Svar på denne e-mail, hvis du vil have en ny tid eller har spørgsmål om betalingen.`,
    codeSubject: (store: string) => `Loginkode til ${store}`,
    codeHeading: "Din loginkode",
    codeIntro: "Indtast koden for at logge ind. Den virker i 10 minutter.",
    codeIgnore: "Bad du ikke om koden? Så kan du se bort fra denne mail.",
    resetSubject: (store: string) => `Ny adgangskode hos ${store}`,
    resetHeading: "Koden til ny adgangskode",
    resetIntro: "Indtast koden, og vælg en ny adgangskode. Den virker i 10 minutter.",
    welcomeSubject: (store: string) => `Velkommen til ${store}`,
    welcomeHeading: "Din konto er klar",
    welcomeIntro: (email: string) => `Du logger ind på Min konto med ${email} og den adgangskode, du valgte. Der ser du ordrer og abonnementer og kan ændre dine oplysninger.`,
    welcomeButton: "Gå til Min konto",
    welcomeIgnore: "Oprettede du ikke kontoen? Svar på denne mail, så sletter butikken den.",
    company: {
      inviteSubject: (company: string, store: string) => `${company} inviterer dig til ${store}`,
      inviteHeading: (company: string) => `Du er inviteret til ${company}`,
      inviteIntro: (inviter: string, company: string, store: string) =>
        `${inviter} har inviteret dig til at være med i ${company}s konto hos ${store}.`,
      inviteDiscount: (percent: string) => `Som medarbejder får du ${percent} % rabat på det, du køber.`,
      inviteButton: "Acceptér invitationen",
      inviteExpires: (date: string) => `Invitationen kan accepteres til ${date}.`,
      inviteIgnore: "Ventede du ikke denne? Ignorer mailen, så sker der intet, før du accepterer.",
      joinedSubject: (store: string) => `Du er med hos ${store}`,
      joinedHeading: (company: string) => `Du er nu med i ${company}`,
      joinedNew: (email: string) => `Vi har oprettet en konto til ${email}. Brug knappen nedenfor til at logge ind.`,
      joinedExisting: (email: string) => `Din konto (${email}) er nu knyttet til virksomheden. Brug knappen nedenfor til at logge ind.`,
      joinedDiscount: (percent: string) => `Du får ${percent} % rabat på det, du køber, når du er logget ind.`,
      joinedButton: "Log ind",
      joinedLinkNote: "Linket virker én gang og i syv dage. Bagefter kan du logge ind med en kode fra Min konto.",
      endedSubject: (company: string) => `Du er ikke længere med i ${company}`,
      endedHeading: "Din virksomhedsrabat er ophørt",
      endedIntro: (company: string, store: string) =>
        `Du er ikke længere knyttet til ${company} hos ${store}, så virksomhedsrabatten gælder ikke længere. Din konto og dine ordrer er som før.`,
    },
    /** The bonus program (D130): the credits on an order confirmation, and the reminder before credits expire. */
    bonus: {
      usedRow: "Bonuskredit brugt",
      earnedLine: (amount: string, date: string) => `Du optjente ${amount} i bonuskredit, som kan bruges fra ${date}.`,
      earnedNow: (amount: string) => `Du optjente ${amount} i bonuskredit, som du kan bruge nu.`,
      expirySubject: (store: string, date: string) => `Din bonuskredit hos ${store} udløber ${date}`,
      expiryHeading: "Din bonuskredit udløber snart",
      expiryGreeting: (name: string) => `Hej, ${name}!`,
      expiryGreetingAnon: "Hej!",
      expiryIntro: (amount: string, date: string) => `${amount} af din bonuskredit udløber ${date}.`,
      expiryHow: "Brug den på din næste ordre: krediten trækkes fra prisen på varer i kassen.",
      expiryButton: "Se min bonuskredit",
    },
    /** The referral program (D131): the friend's welcome discount on an order confirmation, and the referrer's email when a friend's order earned credits. */
    affiliate: {
      discountRow: "Velkomstrabat",
      earnedSubject: (store: string) => `Du har optjent bonuskredit hos ${store}`,
      earnedHeading: "En ven bestilte via dit link",
      earnedGreeting: (name: string) => `Hej, ${name}!`,
      earnedGreetingAnon: "Hej!",
      earnedLine: (amount: string, date: string) => `Du optjente ${amount} i bonuskredit, som kan bruges fra ${date}.`,
      earnedNow: (amount: string) => `Du optjente ${amount} i bonuskredit, som du kan bruge nu.`,
      earnedHow: "Tak, fordi du spreder budskabet. Krediten trækkes tilbage, hvis ordren refunderes eller annulleres.",
      earnedButton: "Se mine anbefalinger",
    },
    /** Work invoices (docs/work.md 4.7): the invoice, credit note and payment reminder emails. */
    work: {
      invoiceSubject: (store: string, number: string) => `Faktura ${number} fra ${store}`,
      invoiceHeading: (number: string) => `Faktura ${number}`,
      invoiceIntro: (store: string) => `${store} har sendt dig en faktura.`,
      invoiceAmount: "Beløb til betaling",
      invoiceDue: "Forfaldsdato",
      invoiceOpen: "Se fakturaen",
      invoiceHosted: "Via linket kan du se fakturaen, udskrive den eller gemme den som PDF. Du behøver ikke logge ind.",
      creditSubject: (store: string, number: string) => `Kreditnota ${number} fra ${store}`,
      creditHeading: (number: string) => `Kreditnota ${number}`,
      creditIntro: (store: string, invoice: string) => `${store} har udstedt en kreditnota til faktura ${invoice}.`,
      creditAmount: "Krediteret beløb",
      creditOpen: "Se kreditnotaen",
      reminderSubject: (store: string, number: string) => `Påmindelse: faktura ${number} fra ${store}`,
      reminderHeading: "Betalingspåmindelse",
      reminderIntro: (number: string, due: string) => `Faktura ${number} med forfaldsdato ${due} er ifølge vores oplysninger ikke betalt. Har du allerede betalt, kan du se bort fra denne påmindelse.`,
      reminderAmount: "Udestående beløb",
    },
    reminderSubject: (store: string, date: string) => `Dit abonnement hos ${store} fornyes ${date}`,
    reminderHeading: "Påmindelse om fornyelse",
    reminderIntro: (date: string, amount: string) =>
      `Dit abonnement fornyes ${date}, og du bliver opkrævet ${amount}.`,
    reminderChange: "Du kan springe over, sætte på pause, ændre eller opsige inden da.",
    trialSubject: (store: string, date: string) => `Din prøveperiode hos ${store} slutter ${date}`,
    trialHeading: "Prøveperioden nærmer sig sin afslutning",
    trialIntro: (date: string, amount: string) =>
      `Prøveperioden slutter ${date}. Derefter fortsætter abonnementet, og du bliver opkrævet ${amount}.`,
    changedSubject: (store: string) => `Dit abonnement hos ${store} er ændret`,
    changedHeading: "Abonnementet er ændret",
    changes: {
      cancel: (date: string) => `Abonnementet slutter ${date}. Du bliver ikke opkrævet mere.`,
      resume: () => "Abonnementet fortsætter som før.",
      cancel_now: () => "Abonnementet er afsluttet.",
      pause: (date: string) => `Abonnementet er sat på pause til ${date}.`,
      unpause: () => "Pausen er slut, og abonnementet fortsætter.",
      skip: (date: string) => `Næste levering springes over. Næste opkrævning bliver ${date}.`,
      change: () => "Indholdet i abonnementet ændres fra næste fornyelse.",
    },
  },
  en: {
    deliveries: {
      startedSubject: (store: string) => `Your subscription box from ${store} is set up`,
      startedHeading: "Your subscription box is set up",
      startedIntro: (day: string, cutoff: string) =>
        `We deliver your list every ${day}. Change it until ${cutoff} before each delivery; changes after that go into the next one.`,
      startedCharge:
        "We charge your card for each delivery when it is on its way, for what it holds at that day's prices. If you change nothing, the next delivery is the same as the last.",
      startedCancel: "You can skip a delivery, pause or end your subscription box at any time on its page.",
      preparedSubject: (store: string, date: string) => `Your delivery from ${store} on ${date}`,
      preparedHeading: "Your next delivery",
      preparedIntro: (date: string) => `Your delivery on ${date} is being packed.`,
      preparedCharge: (amount: string) => `We charge ${amount} to your card when it is on its way.`,
      leftOutHeading: "Not in this delivery",
      leftOutLine: (title: string, wanted: number, got: number) => (got > 0 ? `${title}: ${got} of ${wanted}` : `${title}: sold out`),
      nothingIntro: (date: string) =>
        `Nothing on your list could be had for the delivery on ${date}, so there is no delivery and no charge this time.`,
      manage: "See or change your subscription box",
      cardSubject: (store: string, number: string) => `Please pay for your delivery ${number} from ${store}`,
      cardHeading: "Your card was not charged",
      cardIntro: (number: string, amount: string) =>
        `We could not charge ${amount} for delivery ${number}. Please pay here; the card you pay with is used for your next deliveries.`,
      payNow: "Pay for the delivery",
    },
    /** Withdrawal and returns (D153): the acknowledgement of a withdrawal, the return's emails and the staff reminder. Legal wording: needs human review before real use. */
    returns: {
      withdrawLine: "Changed your mind? You have a right to withdraw from the purchase within 14 days of receiving the goods.",
      costShopper: "If you withdraw from the purchase, you pay the cost of sending the goods back.",
      costStore: "If you withdraw from the purchase, the store pays the cost of sending the goods back.",
      withdrawButton: "Withdraw from the contract",
      ackSubject: (store: string, number: string) => `Your withdrawal for order ${number} at ${store} has been received`,
      ackHeading: "We have received your withdrawal",
      ackIntro: (store: string, number: string, when: string) =>
        `${store} confirms that you withdrew from the contract for order ${number}. Your declaration was registered on ${when}.`,
      ackLinesHeading: "The goods your withdrawal covers",
      ackReference: (reference: string) => `Reference: ${reference}`,
      ackSendBack: (day: string) =>
        `Send the goods back without undue delay and no later than ${day}, which is 14 days after you gave notice that you are withdrawing.`,
      shopperPays: "You pay the cost of sending the goods back.",
      storePays: "The store pays the cost of sending the goods back.",
      ackRefundHold: (day: string) =>
        `We will refund what you paid for the goods without undue delay and no later than ${day}, which is 14 days after we were told you are withdrawing. We may hold the refund back until we have the goods back or you have shown that you sent them.`,
      ackRefundNoHold: (day: string) =>
        `We will refund what you paid for the goods without undue delay and no later than ${day}, which is 14 days after we were told you are withdrawing.`,
      ackNothingSent: "The goods had not been sent when you withdrew, so you have nothing to send back.",
      ackSealed: "For goods sealed for health or hygiene reasons, and sealed audio, video or software, the right of withdrawal lasts only while the seal is unbroken. The store checks this when the goods come back.",
      ackWholeOrder: "If you withdraw from the whole order, we also refund the standard delivery you paid for.",
      ackValue: "You are only liable for a reduction in the value of the goods if you handled them more than was needed to establish their nature, characteristics and functioning.",
      instructionsHeading: "Instructions from the store",
      addressHeading: "Send the goods to",
      statusButton: "See the status of your return",
      approvedSubject: (store: string, number: string) => `Your return ${number} at ${store} is approved`,
      approvedHeading: "Your return is approved",
      approvedIntro: (number: string) => `We have approved return ${number}. Here is how to send the goods back.`,
      labelButton: "Open the return label",
      declinedSubject: (store: string, number: string) => `Your return request ${number} at ${store}`,
      declinedHeading: "We cannot accept this return",
      declinedIntro: (number: string) => `We are sorry, but we cannot accept return request ${number}.`,
      declinedReason: (reason: string) => `Reason: ${reason}`,
      declinedRights: "This does not affect your statutory rights, such as your right to make a complaint about a defect.",
      receivedSubject: (store: string, number: string) => `We have received your return ${number} at ${store}`,
      receivedHeading: "We have received your return",
      receivedIntro: (number: string) => `The goods for return ${number} have arrived.`,
      receivedNext: "We will check the goods and refund you as soon as we can.",
      refundedSubject: (store: string, number: string) => `Refund for return ${number} at ${store}`,
      refundedHeading: "We have refunded you",
      refundedIntro: (amount: string, number: string) => `We have refunded ${amount} for return ${number}.`,
      refundedTiming: "It usually takes 5–10 working days before the amount is back in your account.",
      rowGoods: "The goods",
      rowDeductions: "Deduction for reduced value",
      rowShipping: "Delivery refunded",
      rowReturnShipping: "Return shipping",
      rowAdjustment: "Adjustment by the store",
      refundedNote: (note: string) => `Note from the store: ${note}`,
      deductionNote: (title: string, note: string) => `Deduction for ${title}: ${note}`,
      rowTotal: "Refunded",
      overdueSubject: (store: string, number: string) => `Refund overdue: return ${number} at ${store}`,
      overdueHeading: "A refund is overdue",
      overdueIntro: (number: string, date: string) =>
        `Return ${number} should have been refunded by ${date}. The legal deadline is 14 days after the store was told of the withdrawal.`,
      overdueOpen: "Open the return",
    },
    orderSubject: (store: string, number: string) => `Order confirmation ${number} from ${store}`,
    orderHeading: "Thank you for your order!",
    orderIntro: (number: string) => `We have received the payment for order ${number}.`,
    renewalSubject: (store: string, number: string) => `Your subscription has renewed: order ${number} from ${store}`,
    renewalIntro: (number: string) => `Your subscription has renewed, and order ${number} is paid.`,
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Shipping",
    total: "Total",
    vat: "incl. VAT",
    deliverTo: "Delivered to",
    seeOrder: "See the order",
    downloadsReady: "Your files are ready to download from the order page.",
    subscription: (every: string, amount: string) =>
      `Subscription: renews ${every.toLowerCase()} at ${amount} until you cancel.`,
    manageSubscription: "See or change the subscription",
    account: "My account",
    questions: (email: string) => `Questions? Reply to this email or write to ${email}.`,
    shippedSubject: (store: string, number: string) => `Order ${number} from ${store} is on its way`,
    shippedHeading: "Your parcel is on its way!",
    shippedIntro: (number: string) => `Order ${number} has been sent.`,
    tracking: (carrier: string, number: string) => `Tracking: ${carrier} ${number}`.trim(),
    trackParcel: "Track the parcel",
    refundSubject: (store: string, number: string) => `Refund for order ${number} from ${store}`,
    refundHeading: "We have refunded you",
    refundIntro: (amount: string, number: string) =>
      `We have refunded ${amount} for order ${number}. It usually takes 5–10 working days to reach your account.`,
    cancelledSubject: (store: string, number: string) => `Order ${number} from ${store} is cancelled`,
    cancelledHeading: "Your order is cancelled",
    cancelledIntro: (number: string, amount: string) =>
      `Order ${number} is cancelled and ${amount} has been refunded.`,
    cancelledUnpaidIntro: (number: string) => `Order ${number} is cancelled. Nothing was charged.`,
    /** Appointments (D65). */
    bookingMovedSubject: (store: string, when: string) => `New time at ${store}: ${when}`,
    bookingMovedHeading: "Your appointment has moved",
    bookingMovedIntro: (when: string) => `Your appointment is now on ${when}.`,
    bookingCancelledByYouSubject: (store: string, when: string) => `You have cancelled your appointment on ${when} at ${store}`,
    bookingCancelledByYouHeading: "Your appointment is cancelled",
    bookingCancelledByYouIntro: (service: string, when: string, refund: string | null) =>
      `You have cancelled ${service} on ${when}.${refund ? ` We are paying back ${refund}; it usually takes 5–10 working days.` : ""}`,
    appointmentsHeading: "Your appointment",
    calendarNote: "Add it to your calendar with the attached file.",
    bookingReminderSubject: (store: string, when: string) => `Reminder: your appointment at ${store}, ${when}`,
    bookingReminderHeading: "See you soon",
    bookingReminderIntro: (when: string) => `This is a reminder of your appointment on ${when}.`,
    bookingCancelledSubject: (store: string, when: string) => `Your appointment at ${store} on ${when} is cancelled`,
    bookingCancelledHeading: "Your appointment is cancelled",
    bookingCancelledIntro: (service: string, when: string) =>
      `We have had to cancel ${service} on ${when}. Reply to this email to book a new time or with any questions about your payment.`,
    codeSubject: (store: string) => `Sign-in code for ${store}`,
    codeHeading: "Your sign-in code",
    codeIntro: "Enter the code to sign in. It works for 10 minutes.",
    codeIgnore: "Did not ask for this code? You can ignore this email.",
    resetSubject: (store: string) => `New password at ${store}`,
    resetHeading: "Your code for a new password",
    resetIntro: "Enter the code and choose a new password. It works for 10 minutes.",
    welcomeSubject: (store: string) => `Welcome to ${store}`,
    welcomeHeading: "Your account is ready",
    welcomeIntro: (email: string) => `Sign in to My account with ${email} and the password you chose. There you see your orders and subscriptions, and can change your details.`,
    welcomeButton: "Go to My account",
    welcomeIgnore: "Did not open this account? Reply to this email and the store deletes it.",
    company: {
      inviteSubject: (company: string, store: string) => `${company} invites you to ${store}`,
      inviteHeading: (company: string) => `You are invited to ${company}`,
      inviteIntro: (inviter: string, company: string, store: string) =>
        `${inviter} has invited you to join the ${company} account at ${store}.`,
      inviteDiscount: (percent: string) => `As an employee you get ${percent} % off what you buy.`,
      inviteButton: "Accept the invitation",
      inviteExpires: (date: string) => `The invitation can be accepted until ${date}.`,
      inviteIgnore: "Not expecting this? Ignore the email and nothing happens until you accept.",
      joinedSubject: (store: string) => `You have joined at ${store}`,
      joinedHeading: (company: string) => `You are now part of ${company}`,
      joinedNew: (email: string) => `We have opened an account for ${email}. Use the button below to sign in.`,
      joinedExisting: (email: string) => `Your account (${email}) is now linked to the company. Use the button below to sign in.`,
      joinedDiscount: (percent: string) => `You get ${percent} % off what you buy while you are signed in.`,
      joinedButton: "Sign in",
      joinedLinkNote: "The link works once, for seven days. After that you can sign in with a code from My account.",
      endedSubject: (company: string) => `You are no longer part of ${company}`,
      endedHeading: "Your company discount has ended",
      endedIntro: (company: string, store: string) =>
        `You are no longer linked to ${company} at ${store}, so the company discount no longer applies. Your account and orders are as before.`,
    },
    /** The bonus program (D130): the credits on an order confirmation, and the reminder before credits expire. */
    bonus: {
      usedRow: "Bonus credits used",
      earnedLine: (amount: string, date: string) => `You earned ${amount} in bonus credits, usable from ${date}.`,
      earnedNow: (amount: string) => `You earned ${amount} in bonus credits, ready to use.`,
      expirySubject: (store: string, date: string) => `Your bonus credits at ${store} expire on ${date}`,
      expiryHeading: "Your bonus credits are about to expire",
      expiryGreeting: (name: string) => `Hello, ${name}!`,
      expiryGreetingAnon: "Hello!",
      expiryIntro: (amount: string, date: string) => `${amount} of your bonus credits expires on ${date}.`,
      expiryHow: "Use them on your next order: they come off the price of goods at checkout.",
      expiryButton: "See my bonus credits",
    },
    /** The referral program (D131): the friend's welcome discount on an order confirmation, and the referrer's email when a friend's order earned credits. */
    affiliate: {
      discountRow: "Welcome discount",
      earnedSubject: (store: string) => `You earned bonus credits at ${store}`,
      earnedHeading: "A friend ordered through your link",
      earnedGreeting: (name: string) => `Hi, ${name}!`,
      earnedGreetingAnon: "Hi!",
      earnedLine: (amount: string, date: string) => `You earned ${amount} in bonus credits, usable from ${date}.`,
      earnedNow: (amount: string) => `You earned ${amount} in bonus credits, ready to use.`,
      earnedHow: "Thank you for spreading the word. The credits are taken back if the order is refunded or cancelled.",
      earnedButton: "See my referrals",
    },
    /** Work invoices (docs/work.md 4.7): the invoice, credit note and payment reminder emails. */
    work: {
      invoiceSubject: (store: string, number: string) => `Invoice ${number} from ${store}`,
      invoiceHeading: (number: string) => `Invoice ${number}`,
      invoiceIntro: (store: string) => `${store} has sent you an invoice.`,
      invoiceAmount: "Amount due",
      invoiceDue: "Due date",
      invoiceOpen: "View the invoice",
      invoiceHosted: "From the link you can view the invoice, print it or save it as a PDF. You do not need to sign in.",
      creditSubject: (store: string, number: string) => `Credit note ${number} from ${store}`,
      creditHeading: (number: string) => `Credit note ${number}`,
      creditIntro: (store: string, invoice: string) => `${store} has issued a credit note against invoice ${invoice}.`,
      creditAmount: "Credited amount",
      creditOpen: "View the credit note",
      reminderSubject: (store: string, number: string) => `Reminder: invoice ${number} from ${store}`,
      reminderHeading: "Payment reminder",
      reminderIntro: (number: string, due: string) => `Invoice ${number}, due ${due}, has not been paid according to our records. If you have already paid it, please ignore this reminder.`,
      reminderAmount: "Amount outstanding",
    },
    reminderSubject: (store: string, date: string) => `Your subscription at ${store} renews on ${date}`,
    reminderHeading: "Renewal reminder",
    reminderIntro: (date: string, amount: string) =>
      `Your subscription renews on ${date}, and you will be charged ${amount}.`,
    reminderChange: "You can skip, pause, change or cancel before then.",
    trialSubject: (store: string, date: string) => `Your trial at ${store} ends on ${date}`,
    trialHeading: "Your trial is ending soon",
    trialIntro: (date: string, amount: string) =>
      `Your trial ends on ${date}. The subscription then continues, and you will be charged ${amount}.`,
    changedSubject: (store: string) => `Your subscription at ${store} has changed`,
    changedHeading: "Your subscription has changed",
    changes: {
      cancel: (date: string) => `The subscription ends on ${date}. You will not be charged again.`,
      resume: () => "The subscription continues as before.",
      cancel_now: () => "The subscription has ended.",
      pause: (date: string) => `The subscription is paused until ${date}.`,
      unpause: () => "The pause is over and the subscription continues.",
      skip: (date: string) => `The next delivery is skipped. The next charge is on ${date}.`,
      change: () => "What the subscription holds changes from the next renewal.",
    },
  },
};

export type EmailText = (typeof text)["en"];

export function emailText(lang: string): EmailText {
  if (lang in text) return text[lang as keyof typeof text];
  // A language translated by AI and kept as data (D111), English for what it lacks.
  return (registeredEmail(lang) as EmailText | undefined) ?? text.en;
}

// ---------------------------------------------------------------------------
// The bonus program (D130)
// ---------------------------------------------------------------------------

/**
 * The credits on an order confirmation: the row for what was used, among the totals. `money` formats the order's
 * currency; nothing when no credits were used.
 */
export function orderBonusRows(
  text: EmailText,
  bonus: OrderBonus | null | undefined,
  money: (minor: number) => string,
): { label: string; value: string; muted: boolean }[] {
  return bonus && bonus.usedMinor > 0 ? [{ label: text.bonus.usedRow, value: `−${money(bonus.usedMinor)}`, muted: true }] : [];
}

/** The friendly line under an order confirmation's totals about the credits it earned, or null. `date` formats a day. */
export function orderBonusEarned(
  text: EmailText,
  bonus: OrderBonus | null | undefined,
  money: (minor: number) => string,
  date: (iso: string) => string,
  now?: Date,
): string | null {
  return earnedText(bonus, { money, date, line: text.bonus.earnedLine, ready: text.bonus.earnedNow }, now);
}

/** The friend's welcome discount (D131) on an order confirmation, among the totals: nothing when there was none. */
export function orderReferralRows(
  text: EmailText,
  referralMinor: number,
  money: (minor: number) => string,
): { label: string; value: string; muted: boolean }[] {
  return referralMinor > 0 ? [{ label: text.affiliate.discountRow, value: `−${money(referralMinor)}`, muted: true }] : [];
}

/** What the referrer's email (a friend's order earned them credits) needs, as they read it: the sender formats the amounts and dates. */
export type AffiliateRewardData = {
  store: string;
  /** The referrer's name; empty when there is none. */
  customerName: string;
  /** What they earned, formatted. */
  amount: string;
  /** When the credits can be used, formatted; null when they already can be. */
  usableFrom: string | null;
  /** The full address of Refer a friend. */
  url: string;
};

/** The words of the email to a referrer when a friend's order has earned them credits: never who the friend is. */
export function affiliateRewardText(text: EmailText, data: AffiliateRewardData) {
  const a = text.affiliate;
  const name = data.customerName.trim().split(/\s+/)[0] ?? "";
  const earned = data.usableFrom ? a.earnedLine(data.amount, data.usableFrom) : a.earnedNow(data.amount);
  return {
    subject: a.earnedSubject(data.store),
    preview: earned,
    heading: a.earnedHeading,
    paragraphs: [name ? a.earnedGreeting(name) : a.earnedGreetingAnon, earned, a.earnedHow],
    button: { text: a.earnedButton, url: data.url },
  };
}

/**
 * What the reminder before credits expire needs, all as the shopper reads it: the amounts and dates are formatted by
 * the sender in the customer's own market (`formatMoney`, the locale's date), `url` is the full address of My account's
 * bonus credits page (`storeSiteUrl()` + `marketPath(…, "/account/bonus")`).
 */
export type BonusExpiryData = {
  store: string;
  /** The customer's name; empty when there is none. */
  customerName: string;
  /** The amount that expires, formatted. */
  amount: string;
  /** The day it expires, formatted. */
  expiresOn: string;
  url: string;
};

/** The words of the expiry reminder: subject, greeting and paragraphs, and the button to the account page. */
export function bonusExpiryText(text: EmailText, data: BonusExpiryData) {
  const b = text.bonus;
  const name = data.customerName.trim().split(/\s+/)[0] ?? "";
  const intro = b.expiryIntro(data.amount, data.expiresOn);
  return {
    subject: b.expirySubject(data.store, data.expiresOn),
    preview: intro,
    heading: b.expiryHeading,
    paragraphs: [name ? b.expiryGreeting(name) : b.expiryGreetingAnon, intro, b.expiryHow],
    button: { text: b.expiryButton, url: data.url },
  };
}
