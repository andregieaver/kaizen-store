---
title: Tilbakebetaling, kansellering og bytte
summary: Betal tilbake hele eller deler av en bestilling til kortet eller som tilgodelapp, kanseller en bestilling før den er sendt, og bytt returnerte varer i andre.
track: owners
section: orders
kind: how-to
areas: [orders, returns, payments]
features: [shop]
plans: []
admin: /admin/{store}/orders/{id}
order: 50
checked: 2026-11-04
sources: [D174, D364, D239, D381, D289, D173]
---

## Betal tilbake en bestilling

Åpne bestillingen. Under **Tilbakebetaling**:

1. Skriv inn **Beløp å betale tilbake**, eller trykk **Alt som er igjen (…)**.
2. Under **Betal tilbake til** beholder du **Den opprinnelige betalingen**, eller velger **Tilgodelapp**.
3. Skriv en **Grunn** hvis du vil. Den er for dine egne notater.
4. Under **Legg tilbake på lager** oppgir du hvor mange av hver vare som skal tilbake på lager. Har du flere lagersteder, velger du hvor.
5. La **Send kunden e-post om tilbakebetalingen** være krysset av for å si fra til kunden.
6. Trykk **Betal tilbake**.

En tilbakebetaling til den opprinnelige betalingen går tilbake til kundens kort eller betalingsmetode gjennom Stripe, og Kaizena Flows
gebyr på beløpet som betales tilbake, får du igjen. Du kan betale tilbake i deler, så ofte du vil, til ingenting er igjen. Hver
tilbakebetaling som går gjennom, får en kreditnota: se [Fakturaer og kreditnotaer](/docs/owners/orders/invoices-and-credit-notes).

For varer som kommer tilbake ved en angring eller en retur, betaler du tilbake fra returen i stedet, slik
[Returer og angrerett](/docs/owners/orders/returns-and-withdrawals) viser: den regner ut beløpet for deg.

Bestillinger hører til nettbutikken, som slås på under Innstillinger, Funksjoner.

### Tilgodelapp

**Tilgodelapp** gir pengene tilbake som et av butikkens gavekort. Koden sendes på e-post til bestillingens egen adresse og vises deg én
gang, så du kan gi den videre hvis e-posten ikke kommer fram. Den regnes som en tilbakebetaling overalt, også med kreditnota. Stripe blir
ikke spurt, så Kaizena Flows gebyr betales ikke tilbake. Se [Gavekort](/docs/owners/marketing/gift-cards) for hvordan kundene bruker den.

### Varer du ikke kommer til å sende

Skal en del av en betalt bestilling aldri sendes, for eksempel fordi den er utsolgt, betaler du den tilbake med **Disse enhetene ble ikke
sendt: ta dem ut av det som gjenstår å sende** krysset av. Enhetene tas ut av det som gjenstår å sende, så bestillingen venter ikke lenger
på dem. Er det ingenting å betale tilbake, lukker den samme boksen bare enhetene. Slik stopper du også resten av en delvis sendt
bestilling.

### Betalt utenfor Kaizena Flow

Har kunden betalt deg med bankoverføring eller kontanter, sender Kaizena Flow ingen penger: betal kunden tilbake selv, og trykk så
**Registrer tilbakebetalingen**. Bare eieren kan registrere den, med mindre eieren lar ansatte gjøre det under Innstillinger,
Bestillinger.

## Kanseller en bestilling

En betalt bestilling der ingenting er sendt ennå, kan kanselleres. Under **Kanseller bestillingen** skriver du en grunn hvis du vil, lar
**Send kunden e-post om at bestillingen er kansellert** være krysset av, og trykker **Kanseller bestillingen**. Det som er igjen, betales
tilbake, alle varene legges tilbake på lager, og eventuelle nedlastingslenker stoppes.

- **Er noe allerede sendt?** Da kan den ikke kanselleres: betal tilbake enhetene som ikke er sendt, som ovenfor.
- **Venter en endring på kundens betaling?** Kanseller endringen først.

### Bestillinger som ikke er belastet ennå

- **Beløpet er reservert, skal belastes.** Når butikken belaster kortet idet bestillingen sendes eller når du belaster det selv (**Ta
  betalt** under Innstillinger, Bestillinger), viser bestillingen dette kortet. **Kanseller og frigi** kansellerer bestillingen og
  frigir reservasjonen: ingenting belastes. En bestilling som ikke er belastet før reservasjonen slutter, kanselleres av seg selv.
- **Bestillingen fra et utkast som venter på betaling** kanselleres når du åpner utkastet igjen, eller når lenken utløper. Se
  [Utkast til bestillinger og tilbud](/docs/owners/orders/draft-orders-and-quotes).

En kansellert bestilling slettes aldri: den beholder nummeret sitt.

## Bytte

I stedet for penger tilbake kan tilgodet fra en retur betale for andre varer. Eiere slår på **Tilby bytter** under **Bytter** i
[Innstillinger, Returer](/admin/{store}/settings/returns). Da kan kundene be om et bytte på siden for returen sin, og du kan foreslå et.

1. Åpne returen. Under **Bytte** trykker du **Foreslå et bytte**.
2. Trykk **Legg til et produkt** under **Erstatninger**. Du kan senke prisen på en erstatning, aldri sette den opp.
3. Velg **Frakt for den nye bestillingen** og sjekk **Leveringsadresse**.
4. Sammendraget holder erstatningene opp mot tilgodet fra returen: penger tilbake til kunden, et likt bytte, eller en betaling som skal
   kreves inn.
5. Trykk **Send til kunden**. Kunden bekrefter på en egen side. For å sende det selv trykker du **Lag en lenke å dele**.
6. Når kunden har bekreftet, trykker du **Gjennomfør byttet** der du ellers ville betalt tilbake returen. Den nye bestillingen lages med
   sitt eget nummer, og varene holdes av. Resten av tilgodet betales tilbake med en gang, eller kunden får en lenke på e-post for å betale
   mellomlegget.

Ingenting holdes av eller belastes før du gjennomfører byttet. Til kunden bekrefter, betales returen tilbake som vanlig.

> [!NOTE]
> Et bytte ved en angring går på e-post til bestillingens egen adresse, og bare kundens egen bekreftelse gjelder. For en
> returforespørsel kan du også trykke **Registrer kundens samtykke** når kunden har sagt ja på telefon, i brev eller ansikt til ansikt.

Den opprinnelige bestillingen får en kreditnota for varene som returneres, og den nye bestillingen sin egen faktura. Noen bestillinger
kan ikke byttes, for eksempel en som er solgt med omvendt avgiftsplikt eller som har et abonnement eller en booking: returen sier hvorfor,
og du betaler tilbake i stedet.

## Det du skylder kundene

Tilgodelapper og gavekort er, som bonuspoeng, penger du skylder til kundene bruker dem. Under **Analyse**, **Økonomi** viser tabellen
**Skyldig til kunder** hver av dem fra starten av en periode til slutten, og hva kundene har nå, hver valuta på sin egen rad. Se
[Analyse](/docs/owners/analytics/analytics).

## Flere valg

- **Endre varene** i en betalt bestilling som ikke er sendt ennå, og en lavere total betales tilbake med en gang: se
  [Finn og håndter bestillinger](/docs/owners/orders/manage-orders).
- Mislykkes tilbakebetalingen for en slik endring, viser bestillingen hva kunden fortsatt har til gode. Filteret **Forsendelse**,
  **Tilbakebetaling for endring skyldes**, på Bestillinger finner dem.
- En tilbakebetaling gjort direkte i Stripe registreres på bestillingen, med kreditnota.
