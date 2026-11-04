---
title: Finn og håndter bestillinger
summary: Finn en hvilken som helst bestilling med søk, filtre og lagrede visninger, åpne den for å se alt om den, og merk, arkiver, endre eller skriv notater på bestillinger.
track: owners
section: orders
kind: how-to
areas: [orders]
features: [shop]
plans: []
admin: /admin/{store}/orders
order: 10
checked: 2026-11-04
sources: [D173, D141, D174, D238]
---

## Listen over bestillinger

Åpne **Bestillinger** i menyen. [Bestillinger](/admin/{store}/orders) viser bestillingene dine, de nyeste først, 50 på hver side. En
bestilling kommer i listen så snart den er betalt.

Visningene øverst er den raskeste veien inn:

- **Alle**: alle bestillinger unntatt uferdige kjøp og arkivet.
- **Skal sendes**: betalte bestillinger med varer som fortsatt skal sendes. [Send bestillinger](/docs/owners/orders/send-orders)
  forklarer hvordan.
- **Venter på varer**: bestillinger med varer solgt på restordre som ikke er kommet inn ennå.
- **Skal leveres ut** og **Lokale leveringer**: bestillinger som hentes hos deg, eller som din egen sjåfør kjører ut.
- **Uferdige kjøp**: kjøp en kunde startet i kassen uten å betale.
- **Arkivert**: bestillinger du har flyttet ut av veien.

Bestillinger hører til nettbutikken, som er slått på med mindre du har slått den av under Innstillinger, Funksjoner.

## Finn en bestilling

Skriv i **Søk**: et bestillingsnummer, en e-postadresse, et navn, et produkt, et varenummer, et stikkord eller et sporingsnummer. Et søk
finner også arkiverte bestillinger. Bare de fem første ordene brukes.

For å snevre inn listen trykker du **Filtre, sortering og kolonner**. Du kan filtrere på **Betaling**, **Forsendelse**,
**Bestillingsstatus**, stikkord (**Merket med**), dagen den ble **Lagt inn**, **Marked** og **Laget av**, vise **Bare
gavebestillinger**, velge **Sorter** og velge hvilke **Kolonner** listen viser. Trykk **Bruk**. Filtrene som er på, vises over listen;
fjern dem ett og ett, eller trykk **Fjern alt**.

Søket og filtrene ligger i sidens adresse, så et bokmerke eller en lenke du sender en kollega, åpner den samme listen.

### Lagre en visning

Har du en liste du kommer tilbake til, trykker du **Lagre denne listen som en visning**, gir den et navn på opptil 40 tegn og trykker
**Lagre visningen**. Den tar vare på søket, filtrene, sorteringen og kolonnene. Under **Administrer lagrede visninger** gir du dem nytt
navn, flytter og sletter dem. En butikk kan ha opptil 30 lagrede visninger.

> [!NOTE]
> Alle i teamet som kan lese bestillinger, kan åpne en lagret visning. Ikke lagre et søk etter en persons navn.

## Siden til én bestilling

Trykk på en bestilling for å åpne den. Siden viser varene og summene, betalingen, kunden, sendingen, tilbakebetalinger, fakturaen og
kreditnotaene, returer og **Historikk**: alt som har skjedd med bestillingen, også hver e-post som er sendt.

- **Send bekreftelsen på nytt** sender ordrebekreftelsen til kunden én gang til.
- **Endre e-post eller adresse**, under **Kunde**, retter kundens e-post, adresse eller telefon.
- **Legg til et notat** lagrer et notat i bestillingens historikk. Bare ansatte ser det.

## Stikkord

Med stikkord grupperer du bestillinger på din egen måte, for eksempel *vip* eller *grossist*. På bestillingen skriver du dem under
**Stikkord**, skilt med komma, og trykker **Legg til**. Et stikkord har opptil 40 tegn, og store og små bokstaver er det samme: *VIP* og
*vip* er ett stikkord. Kundene ser aldri stikkord, så ikke skriv om en person i dem.

Filtrer listen på et stikkord med **Merket med**, eller søk etter det.

## Arkiver

Arkiver en bestilling du er ferdig med: trykk **Arkiver** på siden til bestillingen. Den forsvinner fra standardlisten, men ingenting
annet endres: ingen beløp, intet nummer, ingen faktura og ingen tall. Du finner den under **Arkivert** eller med et søk, og **Hent fra
arkivet** henter den tilbake. En retur på en arkivert bestilling henter den tilbake av seg selv.

En bestilling kan ikke arkiveres mens den er betalt og fortsatt har varer som skal sendes, hvis den aldri ble betalt, eller mens en retur
er åpen på den.

Vil du at det skal skje av seg selv, slår du på **Automatisk arkivering** under
[Innstillinger, Bestillinger](/admin/{store}/settings/orders). Den er av som standard. Den arkiverer bestillinger som er sendt (eller
ikke har noe å sende), ikke har noen åpen retur og ikke har hatt noe nytt på så mange dager du velger, fra 14 til 365.

## Mange bestillinger samtidig

Kryss av for bestillinger i listen, eller kryss av for hele siden og trykk **Velg alle … som passer**. Linjen som åpnes, tilbyr
**Legg til stikkord**, **Fjern stikkord**, **Arkiver**, **Hent fra arkivet**, **Merk som sendt**, **Skriv ut pakklister**, **Skriv ut
plukkliste**, **Klar til henting** og **Book etiketter**.

Opptil 250 bestillinger går om gangen, og 100 for utskrift og etiketter. Hver bestilling behandles for seg: en som ikke kan endres,
listes opp etterpå med grunnen og stopper ikke de andre.

## Endre varene i en bestilling

En betalt bestilling som ikke er sendt ennå, kan endres. På siden til bestillingen, under **Endre varene**, trykker du **Endre varer**.
Du kan senke et antall (0 tar varen av), legge til produkter til markedets pris eller en pris du skriver inn, og endre frakten. Velg en
grunn, og om varer som tas av, skal tilbake på lager.

Sammendraget viser bestillingen før og etter:

- **En lavere total** betales tilbake til kunden med en gang.
- **En høyere total** venter på kunden: send en betalingslenke, eller registrer at kunden har betalt deg på en annen måte. Bestillingen
  blir som den var til kunden betaler, og varene som legges til, holdes av i 7 dager.

Bestillingen beholder nummeret sitt. Varer som beholdes, beholder prisen og rabattene de ble solgt med. En bestilling med faktura får en
kreditnota for det som tas av, og en tilleggsfaktura for det som legges til.

Kan bestillingen ikke endres, står det hvorfor på kortet: for eksempel at noe allerede er sendt, eller at den har et abonnement eller en
booking. Betal da tilbake i stedet, slik
[Tilbakebetaling, kansellering og bytte](/docs/owners/orders/refunds-and-exchanges) viser.

## Gavehilsener

Slå på **Gavehilsener** under [Innstillinger, Bestillinger](/admin/{store}/settings/orders) for å la kundene merke en bestilling som
gave, med Til, Fra og en hilsen på opptil 300 tegn. Det er av som standard.

Bestillingen viser da et **Gave**-kort med hilsenen. **Skriv ut gavelapp** skriver den ut på en pakkseddel uten priser, til pakken.
Kaizena Flow sender aldri hilsenen til noen og tar den aldri med i e-posten om at bestillingen er sendt.

## E-post til kunder

Trykk **E-post til kunder** på Bestillinger for å se alle e-poster butikken har sendt, og om de kom fram: sendt, levert, mislyktes, eller
avvist fordi adressen ikke tar imot e-post. **Historikk** på hver bestilling viser dens egne.

Hvilke e-poster kundene får, velger du under [Innstillinger, Varsler](/admin/{store}/settings/notifications). Ordrebekreftelsen sendes
alltid. [Varsler](/docs/owners/team-and-settings/notifications) forklarer resten, og hvordan du skriver din egen tekst.

## Bestillingsnumre

Hver butikk nummererer bestillingene sine i én serie uten hull, slik noen land krever: i en ny butikk fra 1001. En bestilling slettes
aldri. En kansellert bestilling blir stående, kansellert, med nummeret sitt, og en endret bestilling beholder nummeret.

> [!TIP]
> Bestillinger hentet inn fra en annen butikk som historikk, nummereres **C-** og det gamle navnet. De står utenfor serien din og blir
> aldri betalt, sendt eller fakturert.
