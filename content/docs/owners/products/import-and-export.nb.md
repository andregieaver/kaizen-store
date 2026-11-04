---
title: Import og eksport av produkter
summary: Last ned produktene dine som en CSV-fil, hent inn produkter fra en fil etter en sjekk som ikke endrer noe, og flytt inn fra Shopify eller WooCommerce.
track: owners
section: products
kind: how-to
areas: [products]
features: [shop]
plans: []
admin: /admin/{store}/products/import
order: 70
checked: 2026-11-04
sources: [D165, D327, D384, D445]
---

## Eksporter produktene dine

1. Åpne **Produkter** og trykk **Eksporter**.
2. Under **Hvilke produkter** beholder du **Alle produkter, også utkast og arkiverte**, eller velger bare de som er publisert, utkast
   eller arkivert, eller bare de i én kategori eller ett stikkord.
3. Velg **Filformat**: *Excel (Nordic)* for å åpne filen i Excel på norsk, svensk eller dansk, så æ, ø, å og tallene blir riktige;
   *Standard* for andre systemer.
4. La **Ta med adressene til bildene** være krysset av, eller fjern krysset for en mindre fil.
5. Trykk **Eksporter produkter**.

Filen har én rad for hver variant, med tekstene på alle språk, valg, priser for hvert land, lager, kostpris, opplysninger om
produktsikkerhet, kategorier, stikkord og bilder. En butikk med opptil 2 000 rader får filen med en gang. En større butikk får den
som en jobb på samme side, med en knapp, *Download*, når den er klar; filen tas vare på i 7 dager.

Filen har ikke med kjøpsvalg (abonnementer), nedlastingsfiler, bookinginnstillinger eller egendefinerte felt som ikke er enkle
verdier (bilder, filer, lenker og lignende). En import lar disse være som de er.

## Importer produkter

1. Åpne **Produkter** og trykk **Importer**.
2. Velg filen under **En CSV-fil med produkter** og trykk **Last opp og les filen**. En fil kan være på opptil 15 MB, med høyst 5 000
   produkter og 60 000 rader.
3. Under **Hva skal importen gjøre** velger du:
   - **Hva som skal gjøres**: opprett nye produkter og oppdater eksisterende, bare opprett, eller bare oppdater. Et produkt finnes
     etter adressenavnet (slutten av nettadressen) og en variant etter varenummeret.
   - **Et produkt som ikke kan publiseres**: lagre det som utkast og vis hvorfor, eller hopp over det.
   - **Produsent for nye fysiske produkter som ikke har noen i filen**.
   - **Varianter av et eksisterende produkt som ikke er i filen**: la dem være som de er, eller slå dem av. De slettes aldri.
4. Trykk **Sjekk filen**. Sjekken leser hver rad mot butikken slik den er nå, og viser hva importen ville gjort: hvor mange produkter
   som opprettes, oppdateres og står uendret, og problemene i hver rad. **Den endrer ingenting.** Trykk **Last ned problemene som
   CSV** for å rette dem i regnearket ditt.
5. Trykk **Importer …**, les hva som vil skje, og trykk **Ja, importer**.

Produktene lagres ett om gangen. Et produkt med en feil hoppes over og blir som det var, og de andre går videre. Resultatet viser hva
som ble opprettet, oppdatert, lagret som utkast eller hoppet over, hvor mange priser som ble endret, og hvor mange bilder som ble
hentet.

> [!TIP]
> Start med en eksport. Den viser kolonnene, og filen kan leses tilbake inn i Kaizena Flow som den er.

Endrer du et valg etter sjekken, trykker du **Sjekk filen igjen** før du importerer: importen bruker valgene den sist ble sjekket med.
Bare én produktimport kan være åpen om gangen, og du må ha tillatelse til å endre produkter for å importere.

### Dette endrer en fil

- **En tom celle tømmer verdien**, og en kolonne som ikke er i filen, røres ikke. En tom lagercelle beholder lageret.
- **Prisene** leses i hvert lands egen valuta og regnes aldri om. En pris som er den samme som i dag, skrives ikke; en endret pris
  står i produktets prishistorikk.
- **Bilder** på andre nettsteder hentes og lagres i mediebiblioteket ditt.
- **Lageret** settes fra filen når butikken har ett lagersted. Har den flere, importeres ikke lageret i filen, fordi filen ikke kan si
  hvilket lagersted tallet gjelder: bruk lagerfilen under Lager (se [Lager og lagersteder](/docs/owners/stock/stock-and-locations)).

### Dette gjør en import aldri

- sletter et produkt eller endrer adressenavnet til et produkt;
- flytter et varenummer fra ett produkt til et annet: et varenummer som hører til et annet produkt, er en feil;
- importerer en sammenligningspris: en rabatt vises for kundene bare målt mot den laveste prisen de siste 30 dagene, som Kaizena
  Flow henter fra sin egen prishistorikk;
- tar en *Vendor* fra Shopify som produsent, som er et valg du tar med vilje under produktsikkerhet, eller gjør *Charge tax* om til
  mva.-kategorien *Unntatt fra merverdiavgift*.

Du kan ikke angre en import som helhet. **Avbryt importen** på importens side stopper den: det som ble skrevet før den stoppet,
beholdes. Filen din oppbevares privat i 30 dager etter at importen er ferdig, og slettes så.

## Flytt inn fra en annen nettbutikk

En produkteksport fra **Shopify** eller **WooCommerce** kan leses som den er: last den opp under **Importer**, så kjenner Kaizena
Flow den igjen. Da spør den om litt mer før sjekken:

- **Er prisene i filen inkl. mva.?** Det finnes ikke noe standardvalg: et feil svar ville endret alle prisene.
- **Markedet for Price-kolonnen**, når du selger i flere land. Prisene leses i det landets valuta.
- **La hvert produkts gamle adresse (…) føre til siden her**, krysset av fra start, så lenker til den gamle butikkens produktsider
  fortsatt virker. En omdirigering som finnes fra før, beholdes, og en adresse som er i bruk her, tas aldri.

Fra Shopify setter kolonnen *Product Category* produktets standardkategori (se
[Kategorier og stikkord](/docs/owners/products/categories-and-tags)).

Fra WooCommerce blir et variabelt produkt ett produkt med variasjonene som varianter og egenskapene som valg. Prisen er salgsprisen så
lenge datoene for den gjelder, ellers den vanlige prisen. Kategoriene beholder nivåene sine. Et produkt som er publisert der, blir
publisert her; alt annet kommer inn som utkast. Grupperte og eksterne produkter hoppes over, og sjekken viser hver kolonne den ikke
leste, og hvorfor.

Flytter du en hel butikk fra Shopify? [Flytt inn](/admin/{store}/settings/moving), under Innstillinger, kobler til Shopify-butikken din
(den leser bare), viser hva den inneholder, sjekker de gamle lenkene og leder deg til importene. Bare butikkens eier kan bruke den.

Kunder og tidligere bestillinger har egne filer: [Importer kunder](/admin/{store}/customers/import) og
[Importer bestillingshistorikk](/admin/{store}/orders/history-import), begge for butikkens eier.

## Flere valg

- **Endre mange produkter uten en fil.** Kryss av produkter under [Produkter](/admin/{store}/products) og trykk på en masseendring:
  angi status, arkiver, legg til i eller fjern fra en kategori eller et stikkord, endre pris eller angi lager (med ett lagersted).
  **Rediger i rutenett** endrer priser, varenumre, lager og kostpris i en tabell. Du ser over hver endring før den skrives, og en
  masseendring kan angres i 7 dager.
- **Produkter er en del av nettbutikken**, som alle nye butikker starter med. Den slås av og på under Innstillinger, Funksjoner.
