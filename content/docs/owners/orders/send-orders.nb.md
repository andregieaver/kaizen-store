---
title: Send bestillinger
summary: Merk en bestilling som sendt med sporingsnummeret, send den i flere pakker, skriv ut pakklister og plukklister, og book etiketter hos transportøren.
track: owners
section: orders
kind: how-to
areas: [orders, shipping]
features: [shop]
plans: []
admin: /admin/{store}/orders/{id}
order: 20
checked: 2026-11-05
sources: [D174, D238, D372, D374, D153, D289, D458, D459]
---

## Se hva som skal sendes

Åpne **Bestillinger** og velg visningen **Skal sendes**: betalte bestillinger med varer som fortsatt skal sendes. Bestillinger hører til
nettbutikken, som slås på under Innstillinger, Funksjoner.

## Merk en bestilling som sendt

1. Åpne bestillingen. Under **Send bestillingen** ser du for hver vare hvor mange som er bestilt, sendt og angret, og hvor mange som
   fortsatt skal sendes.
2. Velg **Transportør** og skriv inn **Sporingsnummer**, hvis du har et. For en transportør som ikke står i listen, velger du **Annen** og
   limer inn **Sporingslenke**.
3. La **Si fra til kunden** være krysset av: kunden får en e-post om hva som er i pakken og hvordan den kan følges.
4. Trykk **Send denne pakken**.

Bestillingen er sendt. Pakken står som **Pakke 1**, med sporingen, sin egen **Pakkseddel** og **Send e-post på nytt** for å sende
e-posten én gang til.

## Send en del nå og resten senere

Er bare en del av bestillingen klar, setter du ned tallene under **I denne pakken** før du trykker **Send denne pakken**. 0 holder en vare
utenfor denne pakken. Bestillingen er da **Delvis sendt** og blir stående under **Skal sendes**.

Send resten senere med **Send en pakke til**. Hver pakke har sin egen sporing, sin egen e-post som lister opp hva som er i den, og sin
egen pakkseddel, og kundens bestillingsside viser pakkene og hva som kommer senere.

Skal noen varer aldri sendes, for eksempel fordi de er utsolgt, betaler du dem tilbake og lar **Disse enhetene ble ikke sendt** være
krysset av. Se [Tilbakebetaling, kansellering og bytte](/docs/owners/orders/refunds-and-exchanges).

## Pakklister og plukklister

- **Pakkseddel**, øverst på en bestilling, skriver ut det som fortsatt skal sendes, uten priser. På en gavebestilling heter knappen
  **Skriv ut gavelapp**, og kjøperens gavehilsen skrives også ut.
- For flere bestillinger krysser du av for dem på Bestillinger og velger **Skriv ut pakklister**: hver bestilling på sin egen side og på
  sitt eget språk.
- **Skriv ut plukkliste** viser hva som skal tas ut av hyllene for bestillingene du har krysset av for, etter produkt eller etter
  bestilling, sortert etter varenummer, navn eller flest enheter.

Pakklister og plukklister tar høyst 100 bestillinger. Plukklisten endrer ingenting: merk bestillingene som sendt når de er pakket.

## Book en etikett hos transportøren

Med en transportør koblet til (se [Transportører](/docs/owners/shipping/carriers)) tilbyr bestillingen en booking under **Send
bestillingen**: **Book med Posten / Bring**, og **Book med Helthjem**, **Book med Porterbuddy** eller **Book med Instabox** når kunden
valgte den transportøren i kassen. **Book med DHL Express**, **UPS**, **PostNord**, **DHL Paket** og **nShift** vises når kunden valgte
dem, eller valgte din egen frakt: da velger du tjenesten, og du kan be transportøren hente pakken. Bookingen merker pakken som sendt med sporingsnummeret, og **Skriv ut etikett** åpner etiketten for utskrift.

For å booke en del av bestillingen setter du ned tallene før du booker, og veier den pakken: vekten som vises, er anslått ut fra hele
bestillingen. Book resten rett etterpå som en egen pakke.

> [!NOTE]
> Mens en transportør er i testmiljøet sitt, er en booking bare en test: ingenting sendes, og bestillingen merkes ikke som sendt. PostNord
> kan ennå ikke booke etiketter fra Kaizena Flow: book hos PostNord og skriv inn sporingsnummeret.

### Etiketter for mange bestillinger

Kryss av for bestillingene på Bestillinger og velg **Book etiketter**. Det som gjenstår av hver bestilling, bookes som én pakke, hos
transportøren kunden valgte i kassen, eller som Posten / Brings pakke levert hjem når kunden ikke valgte noen. Vekten hentes fra
produktene. Hver bestilling merkes som sendt, og bestillinger som ikke kan bookes, listes opp med grunnen, for eksempel et produkt uten
vekt.

Kundene får e-post bare hvis du krysser av for **Gi beskjed til kundene**. Trykk så **Skriv ut de … etikettene**: de åpnes etter hverandre
i nettleserens PDF-visning. Høyst 100 bestillinger går om gangen.

## Hva kunden får vite

- **Bestilling sendt**: e-posten når du krysser av for **Si fra til kunden**.
- **Ute for levering (transportør)** og **Levert (transportør)**: av som standard. Slå dem på under
  [Innstillinger, Varsler](/admin/{store}/settings/notifications). I dag er det bare sporingen fra Posten / Bring som sender dem; sporing
  fra andre transportører vises på bestillingen og på kundens bestillingsside, men sender ingen e-post.

Kaizena Flow sjekker sporingen av pakker fra en tilkoblet transportør med noen minutters mellomrom; **Sjekk nå** spør med en gang. Den
slutter å følge en pakke 30 dager etter at den ble sendt.

Slår du av e-posten **Bestilling sendt**, er avkrysningsboksen på bestillingen også av, med en lenke til Varsler.

## Når kunden har fått varene

Kundens 14 dager med angrerett starter den dagen de mottar varene, ved den siste pakken når de kommer i flere deler. Med Posten / Bring
registreres den dagen fra sporingen. Ellers trykker du **Merk varene som mottatt av kunden** under **Returer og angringer** på
bestillingen og oppgir dagen. Bruk sporingen eller det kunden sier, aldri dagen du sendte det. Mer under
[Returer og angrerett](/docs/owners/orders/returns-and-withdrawals).

## Angre en pakke

Merket du en pakke som sendt ved en feil? Trykk **Angre «sendt»** på den, gjerne med en grunn. Varene går tilbake til det som gjenstår å
sende, og pakken blir stående i historikken, merket som angret. En pakke booket med UPS, DHL Paket eller nShift kanselleres hos
transportøren også, hvis den ikke er levert inn: meldingen sier om transportøren kansellerte den. Tre ting gjøres ikke for deg:

- en booking hos en annen transportør kanselleres ikke: kanseller den hos transportøren;
- kunden får ingen e-post: si fra selv hvis kunden har fått beskjed om at den er på vei;
- en registrert mottaksdag fjernes: registrer den igjen når varene kommer fram.

En pakke kan ikke angres når det er gjort en retur eller angring etter den.

## Flere valg

- **Sett behandlingen på vent** holder igjen en bestilling, med en grunn. Ingenting av den kan sendes eller leveres ut før du trykker
  **Frigi**. Regler under [Innstillinger, Automatisering](/admin/{store}/settings/automation) kan sette bestillinger på vent av seg
  selv.
- **Merk som sendt** på flere avkryssede bestillinger merker dem som sendt uten sporingsnummer. En delvis sendt bestilling sender resten
  som én pakke; bestillinger som ikke kan sendes, hoppes over og listes opp.
- **Belastes ved sending.** Når kortet belastes idet bestillingen sendes (**Ta betalt** under Innstillinger, Bestillinger), står det
  **Belast og send** på knappen: når du registrerer den første pakken, belastes kortet.
- **Venter på varer.** En bestilling med varer solgt på restordre sier fra om det; send den når varene er på plass.
- **En endring som venter på betaling** stopper sendingen til kunden betaler den, eller den kanselleres eller utløper.
- **Henting og lokal levering** leveres ut med **Klar til henting**, **Hentet** og **Ute for levering**: se
  [Henting og lokal levering](/docs/owners/shipping/pickup-and-local-delivery).
