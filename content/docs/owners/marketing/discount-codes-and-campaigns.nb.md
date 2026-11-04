---
title: Rabattkoder og kampanjer
summary: Gi rabatt med en kode kundene skriver inn, eller med en kampanje uten kode, og velg hvem som får den, når, og hvordan de to virker sammen.
track: owners
section: marketing
kind: how-to
areas: [marketing]
features: []
plans: []
admin: /admin/{store}/discounts
order: 10
checked: 2026-11-04
sources: [D31, D114, D115, D116, D299, D367, D380, D392]
---

## Kode eller kampanje?

- **En rabattkode** skriver kundene inn i handlekurven eller i kassen. Bare de som har koden, får rabatten, så den passer til et
  nyhetsbrev, en samarbeidspartner eller én trofast kunde.
- **En kampanje** trenger ingen kode. Den går i en periode, starter og stopper av seg selv, og produktsidene dine forteller om den.

Begge trekkes fra i handlekurven. Ingen av dem endrer prisen på et produkt: produktsiden viser prisen som den er, med tilbudet fra en
kampanje som pågår ved siden av. En tidligere pris med strek over vises bare når du senker selve prisen, og den er alltid den laveste
prisen de siste 30 dagene (se [Priser](/docs/owners/products/prices)).

## Lag en rabattkode

1. Åpne **Markedsføring** i menyen og velg [Rabattkoder](/admin/{store}/discounts). Trykk **Ny rabattkode**.
2. Skriv inn **Koden kundene skriver**: 3 til 40 bokstaver, sifre, - eller _. Kundene kan skrive den med store eller små bokstaver.
3. Under **Hva den gir** velger du **En prosent i rabatt**, **Et beløp i rabatt** eller **Gratis frakt**. Et beløp oppgis i hvert lands
   valuta; lar du et land stå tomt, virker ikke koden der. En kode trekker aldri fra mer enn varene koster.
4. Under **Hva den gjelder** beholder du **Alt i butikken**, eller velger **Bare noen produkter, kategorier eller stikkord**. En kategori
   tar med produktene i underkategoriene sine.
5. Trykk **Lagre koden**.

Listen viser hvor ofte hver kode er brukt, hva den har gitt, og om den er *Aktiv*, *Starter senere*, *Avsluttet*, *Brukt opp* eller
*Slått av*.

### Begrensninger på en kode

Alt dette er valgfritt:

- **Minste antall varer**: av det koden gjelder, kjøpt én gang (ikke abonnementer).
- **Minste ordre**: hva varene må komme opp i før frakt, i hvert lands valuta.
- **Starter** og **Slutter**, i norsk tid. Uten datoer virker koden så lenge **Slått på** er krysset av.
- **Bruk i alt**: hver bestilling som fikk koden, teller så lenge den ikke er kansellert, så en avbrutt betaling gir bruken tilbake.
- **Én gang per kunde**: kundene må logge inn på Min konto for å bruke den, så butikken vet hvem de er.

En prosentkode på et abonnement senker bare den første betalingen, med mindre du krysser av for **Behold rabatten ved hver fornyelse av
et abonnement**. En kode for gratis frakt på et abonnement gjelder den første leveransen.

### Hvem kan bruke den

Under **Hvem kan bruke den** velger du **Alle kunder som har koden**, eller begrenser den:

- **Bare kunder i disse gruppene**, når butikken har [kundegrupper](/admin/{store}/customer-groups);
- **Bare disse kundene**: e-postadressene deres, én per linje, høyst 100, og hver må være kunde i butikken;
- **Personer i et segment**, når du har [segmenter](/docs/owners/marketing/email-marketing). Om en kunde er med i segmentet, regnes ut
  hver gang koden brukes.

En begrenset kode krever at kunden er logget inn på Min konto. En gjest blir bedt om å logge inn.

### Engangskoder

Vil du gi hver kunde sin egen kode, krysser du av for **Del ut engangskoder i stedet** og lagrer. Koden du skrev, er da bare navnet.
På kodens side, under **Engangskoder**:

1. Skriv **Hvor mange** (opptil 10 000 om gangen, 100 000 i alt for én kode) og eventuelt et **Prefiks**.
2. Trykk **Lag koder**. Hver kode har åtte tegn, uten tegn som ligner hverandre, som 0 og O.
3. Trykk **Last ned kodene** for å få en CSV-fil med kodene, om hver er brukt, og når den ble laget.

Hver engangskode virker for én bestilling. **Bruk i alt** og **Én gang per kunde** gjelder ikke for dem.

## Start en kampanje

1. Åpne **Markedsføring** og velg [Kampanjer](/admin/{store}/campaigns). Trykk **Ny kampanje**.
2. Gi den et **Navn**. Kundene ser det i handlekurven, i kassen og på bestillingen sin, så skriv det for dem: «Sommersalg».
3. Velg **Hva den gir** (se tabellen nedenfor), og så hva den gjelder: hele butikken, eller utvalgte produkter, kategorier eller
   stikkord.
4. Under **Når** setter du eventuelt **Starter** og **Slutter**, i norsk tid. Uten datoer går den så lenge den er slått på.
5. Trykk **Lagre kampanjen**.

| Hva den gir | Hva kunden får |
|---|---|
| **En prosent i rabatt** | For eksempel 20 % rabatt på de valgte produktene. |
| **Kjøp flere, betal for færre** | For eksempel 3 for 2: i hver hele gruppe på tre er den billigste gratis. Varene kan være forskjellige produkter. |
| **Et beløp i rabatt** | Et beløp i hvert lands valuta, fordelt på produktene etter hva hvert koster, eventuelt først når de produktene kommer opp i et beløp. |
| **Større rabatt jo mer som kjøpes** | To til fem trinn, etter antall varer eller etter hva handlekurven kommer opp i, og hvert gir en prosent eller et beløp i rabatt. Det høyeste trinnet kunden når, gjelder. |
| **Gratis frakt** | Ingen frakt å betale, uansett hvilken levering kunden velger, eventuelt over et beløp. Ikke for abonnementer. |
| **Kjøp én ting, få en annen** | For eksempel kjøp 2 skjorter og få en caps gratis, eller den billigste til halv pris. Kunden legger begge i handlekurven. |
| **Et gratis produkt** | Legges gratis til bestillingen når handlekurven kommer opp i et beløp du setter per land. Bare varer du sender selv, som er på lager, på en bestilling som sendes uansett. |

Kampanjer gir rabatt på varer som kjøpes én gang: ikke timeavtaler, opphold, utleie eller abonnementer. Der to kampanjer gjelder samme
produkt, får det den som gir kunden mest.

Produktsidene forteller om en kampanje som pågår, og produktkortene viser tilbudet når det ikke krever et beløp, som *20 % rabatt*
eller *3 for 2*. Handlekurven sier hvor langt kunden er fra neste trinn eller et beløp, og viser et gratis produkt som gratis.

### Flere valg for kampanjer

- **Ordrer den kan gjelde i alt**: en bestilling teller én gang, uansett hvor mange produkter kampanjen virket på. Kampanjen stopper av
  seg selv når de er brukt opp.
- **Ordrer for hver kunde**: 1 er én gang per kunde. Kundene må være logget inn for å få den; produktsidene sier det.
- **Hvor**, når du selger i mer enn ett land: **Alle land butikken selger til** eller **Bare noen land**.
- **Hvem**: **Alle kunder**, **Bare kunder i disse gruppene** eller **Personer i et segment**. En slik kampanje vises ikke på
  produktsidene, som er like for alle.
- **Gjelder også i tillegg til andre kampanjer**, for en prosent, kjøp flere betal for færre, og større rabatt jo mer som kjøpes.
  Vanligvis får et produkt én kampanje; når dette er på, trekkes denne også fra det den andre lot stå igjen, i den rekkefølgen
  kampanjene ble laget.

## Koder og kampanjer sammen

Dette trekkes fra, i denne rekkefølgen: kampanjer, rabatten til en kundegruppe, velkomstrabatten til en venn fra
[vervekampanjen](/docs/owners/marketing/loyalty-and-referrals), rabattkoder, og bonuskreditt til slutt. Hver regner av det som er igjen
etter den forrige.

**Flere koder.** En kunde kan bruke opptil fem koder på én bestilling. Under **Bruk sammen med andre koder** krysser du av for hvilke
slags koder denne kan brukes sammen med: **Koder på utvalgte produkter, kategorier eller stikkord**, **Koder på alt** eller **Koder for
gratis frakt**. To koder brukes bare sammen når begge tillater den andre. I starten er ingenting krysset av, så en kode virker alene. Der
to ikke kan brukes sammen, får kunden den som gir mest rabatt, og handlekurven sier hvorfor den andre ble utelatt.

**En kode ved siden av en kampanje.** **Kan brukes sammen med kampanjer** på en kode og **Kan brukes sammen med rabattkoder** på en
kampanje er begge på i starten: koden trekkes fra det kampanjen lar stå igjen. Slår du en av dem av, får handlekurven enten koden eller
kampanjene, det som gir kunden mest, og handlekurven sier hva som ble utelatt.

> [!NOTE]
> Ingenting trekkes fra et gavekort, og et gavekort i handlekurven teller ikke mot et minstebeløp. Se
> [Gavekort](/docs/owners/marketing/gift-cards).

## Endre, slå av eller slette

Åpne en kode eller en kampanje for å endre den, eller trykk **Slå av** ved en kampanje i listen. Sidene deres har **Slett denne koden**
og **Slett denne kampanjen**. Bestillinger som allerede er lagt inn, beholder det de fikk, uansett hva du endrer eller sletter.

> [!TIP]
> En [påminnelse om handlekurv](/docs/owners/marketing/email-marketing) kan ha med en kode, og et nyhetsbrevskjema kan sende hver ny
> abonnent en engangskode på e-post.
