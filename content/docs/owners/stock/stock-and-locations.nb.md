---
title: Lager og lagersteder
summary: Se og endre lageret for hver variant på hvert lagersted, flytt varer mellom lagersteder, før opp det du kjøper fra leverandører, og få varsel når lageret blir lavt.
track: owners
section: stock
kind: how-to
areas: [stock, products, orders]
features: [shop]
plans: []
admin: /admin/{store}/inventory
order: 10
checked: 2026-11-04
sources: [D172, D370, D383, D397, D416]
---

## Se lageret ditt

Åpne **Produkter** og velg [Lager](/admin/{store}/inventory). Der er det én rad for hver variant av varene du sender; digitale
produkter har ikke lager og blir aldri utsolgt.

| Kolonne | Hva den betyr |
|---|---|
| **På lager** | Det du har telt, og som en betalt bestilling ikke har tatt ennå. |
| **Holdt** | Det utsjekkinger som pågår, holder av. |
| **Tilgjengelig** | På lager minus holdt: det som fortsatt kan selges. |
| **Skyldt** | Enheter solgt på restordre i betalte bestillinger som ikke er sendt ennå. |

Øverst teller **Det som trenger et blikk** variantene som er på eller under nivået for lavt lager, utsolgt, skyldt på restordre og
under null. **Vis dem** lister dem opp. Søk etter tittel, adresse eller varenummer, eller filtrer på lagersted.

## Endre et lagertall

1. I variantens rad skriver du det opptelte tallet under **Sett til**, eller en endring under **Juster med**, for eksempel `+5` eller
   `-2`.
2. Trykk **Se over endringene**. Ingenting er lagret ennå: hver rad vises før og etter.
3. Velg en **Begrunnelse**: Retting, Opptelling, Mottatt, Skadet, Tyveri eller svinn, eller Kampanje eller gave. Skriv gjerne et kort
   **Notat**, men ikke om en person.
4. Trykk **Lagre endringene**.

Hver rad lagres for seg. En rad der lageret har endret seg siden du åpnet siden, for eksempel ved et salg, blir latt være og listet
opp, så et salg blir aldri angret. En endring du gjør, tar aldri lageret under 0. Du må ha tillatelse til å endre produkter for å
endre lageret; andre kan lese siden.

Hver endring tas vare på i 24 måneder under **Historikk**: når, hvilken variant og hvilket lagersted, endringen, det nye tallet,
begrunnelsen, og hvem eller hva som gjorde den (en ansatt, en bestilling, en retur, en fil eller KI-assistenten). En endring kan ikke
redigeres: en feil endring rettes med en ny. **Historikk** i enden av en rad viser endringene for den varianten.

> [!TIP]
> Du kan også sette lageret i produktredigeringen, under **Pris og lager**. Med flere lagersteder har hver variant der ett felt per
> lagersted.

## Lager på flere steder

Har du varer på mer enn ett sted, legger du til hvert av dem under fanen **Lagersteder**. Hver variant har sitt eget lager på hvert
lagersted, og butikken selger summen av de aktive.

- **Legg til lagersted**: et navn, for eksempel *Bergen-butikken*, og landet. Et nytt lagersted kommer sist. En butikk kan ha opptil
  20.
- **Flytt opp** og **Flytt ned** bestemmer rekkefølgen bestillinger tar varer i.
- **Gi nytt navn** endrer navnet eller landet.
- **Deaktiver** tar lageret på et sted av salg. Først ser du hvor mange enheter som ikke lenger blir til salgs, og det avvises så
  lenge utsjekkinger holder av varer der. Ingenting slettes: **Aktiver igjen** gjør enhetene til salgs igjen.
- **Stopp nettordrer herfra** holder lageret på et sted utenfor nettbutikken. Det telles, flyttes og mottas fortsatt.

En butikk har alltid ett aktivt lagersted som tar nettordrer, og et lagersted slettes aldri. Bare butikkens eier kan deaktivere,
aktivere igjen eller stoppe nettordrer.

Med flere lagersteder viser listen under Lager summen for hver variant. Åpne **Lagersteder for …** under en rad for å se og endre
tallene på hvert sted, eller filtrer listen på ett lagersted.

### Hvilket lagersted en bestilling tar fra

Har du mer enn ett aktivt lagersted, velger du under **Slik velger ordrer lagersted**:

- **I rekkefølgen under**: fra det øverste lagerstedet først.
- **Lagersteder i leveringslandet først, så rekkefølgen under**.

Uansett holdes en bestilling samlet på ett lagersted når ett sted kan levere alt. Ellers tas den sted for sted i den rekkefølgen, og
det som selges på restordre, legges på det første lagerstedet som fører varianten.

## Flytt varer mellom lagersteder

Under fanen **Overføringer** trykker du **Ny overføring**.

1. Velg **Fra** og **Til**, og legg inn linjer: et **Varenummer** og **Enheter**. **Legg til en linje** gir en linje til, eller
   **Legg til linjer fra en CSV-fil** leser en fil med kolonnene SKU og Quantity.
2. Trykk **Lagre som utkast**. Ingenting flyttes ennå.
3. Åpne overføringen og trykk **Send den**. Enhetene går ut fra det første stedet med en gang og er ikke til salgs noe sted før de er
   telt inn. Enheter som utsjekkinger holder av, sendes aldri: en linje med for få ledige enheter avvises, og du får vite hvor mange
   som er ledige.
4. Når de kommer, skriver du enhetene som kom, under **Tell inn enheter** og trykker **Tell dem inn**. En levering kan telles inn i
   deler.

**Kanseller overføringen** setter enhetene som ikke er telt inn, tilbake der de kom fra. Under fanen Lagersteder vises enheter på vei
som **Innkommende**.

## Før opp det du kjøper inn

Under fanen **Innkjøpsordrer** trykker du **Ny innkjøpsordre**.

1. Fyll inn **Leverandør**, **Leverandørens referanse (valgfritt)**, **Valuta** leverandøren fakturerer i, hvor varene **Kommer
   til**, og når de er **Ventet (valgfritt)**.
2. Legg inn linjer: et varenummer, antall enheter og **Kostpris per enhet**. En CSV-fil med kolonnene SKU, Quantity og Unit cost går
   også.
3. Trykk **Lagre som utkast**, og **Merk som bestilt** når du bestiller. Fra da av ligger leverandør, valuta, sted og linjer fast.
4. Når varene kommer, bruker du **Tell inn enheter**. Lageret går opp på det stedet, og hver variants kostpris blir det én enhet
   kostet på denne ordren, regnet om til hovedvalutaen din etter butikkens valutakurser. Hver endring av en kostpris tas vare på.

Finnes det ingen valutakurs for leverandørens valuta, blir kostprisen som den var, og siden sier det. **Kanseller innkjøpsordren**
beholder det som allerede er telt inn. Innkjøpsordrer er dine egne oversikter: ingenting sendes til leverandøren.

> [!TIP]
> Når [statusrapporten](/docs/owners/analytics/reports-targets-and-alerts) sier at varer er i ferd med å gå tomme, åpner **Forbered
> innkjøp** en innkjøpsordre som er fylt ut for deg: variantene som blir lave innen 37 dager i takten fra de siste 30, med kostpris og
> leverandøren du brukte sist. Sjekk den og trykk **Lagre som utkast**.

## Varsel om lavt lager

Sett et nivå for en variant, så får butikkens eiere én e-post når lageret går ned til det nivået, ikke én for hvert salg.

- I produktredigeringen åpner du **Lagerregler for …** under varianten og fyller inn **Varsle meg når lageret er på eller under**.
- Under Lager krysser du av varianter, fyller inn **Varsle meg på eller under** og trykker **Sett nivå for lavt lager**.

En variant som allerede er på eller under nivået når du setter det, teller med en gang.

## Flere valg

- **Lagerfiler.** **Eksport** under Lager skriver én rad for hver variant på hvert aktive lagersted. Vil du telle, endrer du kolonnen
  `on_hand` og tar filen tilbake under **Import**: trykk **Sjekk filen** for å se hva den ville gjort, rad for rad (den endrer
  ingenting), og så **Importer …** og **Ja, importer**. La kolonnen `on_hand_was` stå slik eksporten skrev den: en rad der lageret
  har endret seg siden, for eksempel ved et salg, blir latt være i stedet for å angre salget. Filen kan også sette `reason`,
  `stock_policy`, `backorder_days` og `low_stock_threshold`. En import lager aldri en variant, et lagersted eller et produkt, sletter
  aldri noe og skriver aldri et tall under null. Høyst 20 000 rader i en fil.
- **Mange produkter samtidig.** Med ett lagersted krysser du av produkter under [Produkter](/admin/{store}/products) og trykker
  **Angi lager**: et tall setter lageret for hver variant, og `+5` eller `-3` endrer det.
- **Tilbakebetalinger og returer** kan legge enheter tilbake på lager, der de ble tatt fra eller på et lagersted du velger. Se
  [Tilbakebetaling, kansellering og bytte](/docs/owners/orders/refunds-and-exchanges).
- **Selge når varen er utsolgt**, og forhåndsbestillinger: se
  [Forhåndsbestilling og restordre](/docs/owners/stock/pre-orders-and-backorders).
- **Lager er en del av nettbutikken**, som alle nye butikker starter med. Den slås av og på under Innstillinger, Funksjoner.
