---
title: Sett opp betalinger
summary: Prøv kassen med testbetalinger med en gang, sett opp din egen Stripe-konto for ekte betalinger, og velg når kundens kort belastes.
track: owners
section: payments
kind: how-to
areas: [payments, setup]
features: []
plans: []
admin: /admin/{store}/settings/payments
order: 10
checked: 2026-11-04
sources: [D15, D17, D20, D289, D292]
---

## Slik virker betalinger

Kundene betaler virksomheten din direkte, gjennom butikkens egen Stripe-konto, og Stripe utbetaler pengene til banken din. Alt om
betalinger stilles inn på én side: åpne **Innstillinger** i menyen og velg [Betalinger](/admin/{store}/settings/payments), under Salg.
Bare butikkens eiere kan åpne siden, og hver endring står under **Siste endringer** nederst, med hvem som gjorde den.

## Testbetalinger

En ny butikk tar imot testbetalinger fra start, uten at du trenger å sette opp noe: Kaizena Flow oppretter en Stripe-testkonto for
butikken. **Testbetalinger** på Betalinger sier *Klar* når den er på plass.

Prøv kassen slik en kunde ville gjort:

1. Legg noe i handlekurven i butikken og gå til kassen.
2. Betal med kortet `4242 4242 4242 4242`, en hvilken som helst dato fram i tid og en hvilken som helst CVC.
3. Åpne **Bestillinger** i administrasjonen: testbestillingen ligger der. Ingen ekte penger flyttes.

Så lenge butikken tar imot testbetalinger, sier nettbutikken at den er i testmodus.

## Ta imot ekte betalinger

Ekte betalinger krever din egen Stripe-konto. Sett den opp når du er klar til å åpne.

1. På Betalinger, under **Ekte betalinger**, trykker du **Sett opp Stripe**.
2. Svar på spørsmålene fra Stripe på siden: hvem som driver virksomheten, og hvor utbetalingene skal gå. Det tar omtrent ti minutter; ha
   organisasjonsnummeret og bankkontoen klare. Stripe lagrer svarene underveis, så du kan gjøre deg ferdig senere.
3. Vent til Stripe har kontrollert opplysningene. Linjen under **Ekte betalinger** viser hvor langt det har kommet:
   - *Stripe trenger noen flere opplysninger før butikken kan ta imot betalinger.* Svar på det Stripe fortsatt spør om.
   - *Stripe kontrollerer opplysningene dine.* Dette tar vanligvis noen minutter, av og til en dag eller to.
   - *Klar: butikken kan ta imot betalinger.*
4. Under **Kassen** velger du **Live** som **Modus**, lar **Kundene kan betale** være krysset av og trykker **Lagre**.

Fra da av betaler kundene med ekte penger. Til kontoen er klar, står det *Live (sett opp Stripe ovenfor først)*, og valget kan ikke
velges.

> [!NOTE]
> Finnes det ikke noe kort for **Ekte betalinger**, og **Kassen** sier *Ekte betalinger åpner når Kaizena Flow går live*, tilbys ikke
> ekte betalinger ennå. Butikken tar imot testbetalinger til de gjør det.

### Stripe-kontoen etterpå

Når kontoen er klar, åpner **Virksomhets- og bankopplysninger** på Betalinger opplysningene dine hos Stripe, for eksempel bankkontoen
utbetalingene går til. **Åpne Stripe-dashbordet ditt** fører til Stripes egne sider for utbetalinger, tilbakebetalinger, kvitteringer og
betalingsmetoder.

Vil du stanse betalingene en stund, fjerner du haken ved **Kundene kan betale** og trykker **Lagre**.

## Velg når kortet belastes

Kortet belastes når bestillingen legges inn, med mindre du velger noe annet. For å belaste det senere åpner du **Innstillinger**, velger
[Bestillinger](/admin/{store}/settings/orders) under Salg, og velger under **Ta betalt**:

- **Når bestillingen legges inn**: kortet belastes i kassen. Det vanlige valget.
- **Når bestillingen sendes**: beløpet reserveres på kortet i kassen og belastes når du registrerer den første pakken.
- **Når du belaster det**: beløpet reserveres på kortet i kassen og belastes når du trykker **Belast** på bestillingen.

Trykk **Lagre**. Bare eieren kan endre dette, og det gjelder bestillinger som legges inn fra da av.

### Når et beløp er reservert

- Bestillingen viser *Beløpet er reservert, skal belastes*. Den er ikke et salg i tallene dine, og ingen faktura utstedes før du
  belaster.
- På bestillingen belaster **Belast** kortet. Du kan belaste mindre enn det som er reservert: resten frigis og krediteres.
  **Kanseller og frigi** kansellerer bestillingen i stedet, og ingenting belastes.
- Et beløp er reservert i opptil 7 dager. Du får en e-post dagen før reservasjonen slutter, og en bestilling som ikke er belastet innen
  da, kanselleres, og varene frigjøres.
- Abonnementer, bookinger, depositum, vertenes oppføringer og nedlastinger belastes alltid i kassen, det samme gjør utkast til
  bestillinger, endringer av bestillinger, bytter og abonnementsbokser.

For å finne bestillingene som venter, filtrerer du **Bestillinger** på **Betaling**: *Beløpet er reservert, skal belastes*.

## Flere valg

### Fakturaer fra Stripe

Under **Kassen** får du Stripe til å sende en faktura med virksomhetens opplysninger og merverdiavgiften inkludert med **Send en faktura
(PDF) på e-post med hver bestilling**. Stripe tar et lite gebyr per faktura. Mens Kaizena Flow lager fakturaene dine, brukes ikke dette:
hver betalte bestilling får i stedet en nummerert faktura fra butikken (se
[Fakturaer og kreditnotaer](/docs/owners/orders/invoices-and-credit-notes)).

### Mollie

Når Kaizena Flow tilbyr det, kan du med et **Mollie**-kort på Betalinger ta imot betalinger gjennom din egen Mollie-konto i stedet for
Stripe: PayPal, Vipps, Swish, MobilePay, iDEAL, Bancontact og flere.

1. Trykk **Koble til Mollie** og godkjenn Kaizena Flow hos Mollie.
2. Under **Kundene betaler med** velger du Mollie for **Testbetalinger**, **Ekte betalinger** eller begge, og trykker **Lagre**.
3. Under **Metoder hos Mollie** trykker du **Aktiver** ved en metode du vil ha. Den vises som *Aktiv* når Mollie har slått den på. Vipps
   og MobilePay krever din egen avtale med dem, og Swish en virksomhet i EØS.

Greit å vite før du kobler til:

- Kundene betaler på Mollies egen side. Kaizena Flow spør først om navn, e-post og leveringsadresse.
- Kaizena Flows gebyr tas av hver Mollie-betaling og gis ikke tilbake når du gjør en tilbakebetaling.
- Abonnementer, depositum og vertenes oppføringer betales fortsatt gjennom Stripe.
- Klarna og andre metoder for å betale senere viser *Tilbys ikke ennå*.

**Koble fra Mollie** setter kassene tilbake på Stripe.

### Neste steg

- [Betalingsmetoder](/docs/owners/payments/payment-methods): hvilke metoder kassen tilbyr i hvert land, og lommebøker.
- [Utbetalinger og gebyrer](/docs/owners/payments/payouts-and-fees): hva som kommer inn på kontoen din, og hva som trekkes underveis.
