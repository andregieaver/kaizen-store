---
title: Fraktselskaper
summary: Koble til din egen avtale med Posten / Bring, PostNord, Porterbuddy, Helthjem, Instabox, DHL Express eller UPS for å tilby tjenestene deres i kassen, bestille frakt og skrive ut etiketter fra bestillingen, og spore pakker.
track: owners
section: shipping
kind: how-to
areas: [shipping, integrations, orders]
features: []
plans: []
admin: /admin/{store}/integrations
order: 30
checked: 2026-11-05
sources: [D133, D134, D135, D136, D137, D138, D239, D374, D457]
---

## Hva du får ved å koble til et fraktselskap

Du kobler til et fraktselskap med din egen avtale med det: Kaizena Flow snakker da med fraktselskapet for deg, med kundenummeret og
nøklene dine. Dette gjør hvert av dem nå:

| Fraktselskap | Leverer i | I kassen | Etiketter fra bestillingen |
|---|---|---|---|
| Posten / Bring | Norge, Sverige, Danmark, Finland | Brings tjenester og priser for pakker til Norge, med hentesteder | Ja |
| PostNord | Sverige, Danmark, Norge, Finland | Tjenestene til priser du skriver inn, med hentesteder | Ikke ennå |
| Porterbuddy | Norge | Hjemlevering i et tidsvindu, også samme dag | Ja |
| Helthjem | Norge | Hjemlevering og utleveringssteder, til priser du skriver inn | Ja |
| Instabox | Sverige, Norge, Danmark | Pakkebokser kunden velger, til priser du skriver inn | Ja |
| DHL Express | Europa, fra alle land der | DHLs tjenester og priser, til døren | Ja, med tollpapirer |
| UPS | Europa, fra alle land der | UPS' tjenester og priser, til døren eller et UPS Access Point | Ja, med tollpapirer |

Alle gir sporingsnumre på bestillingen og i e-poster, og Kaizena Flow følger pakkene til alle unntatt Instabox, der Instabox' egen
sporingsside følger pakkene. Posten / Bring kan også bestille returetiketter til kunder i Norge (se
[Returer og angrerett](/docs/owners/orders/returns-and-withdrawals)).

## Koble til et fraktselskap

1. Åpne **Innstillinger** i menyen og velg [Integrasjoner](/admin/{store}/integrations), under Salg.
2. Under **Transportører** trykker du **Koble til** på kortet til fraktselskapet.
3. **Gjør deg klar** viser hva du trenger fra fraktselskapet først, som en avtale og API-tilgang, med en lenke til utviklersidene deres.
4. Under **Dine opplysninger** velger du **Miljø**: **Test** mens du prøver, **Produksjon** for ekte pakker. Fyll ut feltene du har fått
   fra fraktselskapet, og kryss av for landene under **Send med** fraktselskapet **til**.
5. Trykk **Lagre opplysningene mine**.
6. Trykk **Sjekk tilkoblingen**. Kaizena Flow spør fraktselskapet om opplysningene dine godtas; ingenting bestilles. Kortet under
   Integrasjoner sier da *Tilkoblet* eller *Ikke godtatt*, og siden til fraktselskapet viser svaret.

Bare butikkens eiere kan endre opplysningene til et fraktselskap. Opplysningene lagres kryptert på Kaizena Flows servere i Europa. Nøkler
vises aldri igjen etter lagring, bare de siste tegnene; la en nøkkel stå tom for å beholde den som er lagret.

> [!NOTE]
> I miljøet **Test** lager en bestilling av frakt en testsending: ingenting sendes, og bestillingen merkes ikke som sendt. Bytt
> fraktselskapet til **Produksjon** når du er klar. Porterbuddy, Helthjem og Instabox ber deg bruke testmiljøet til de har godkjent
> oppsettet ditt.

## Tilby fraktselskapet i kassen

Når opplysningene dine er lagret, vises **Leveringsvalg i kassen** på siden til fraktselskapet.

1. Kryss av for **Tilby** fraktselskapet **i kassen i landene som er valgt over**.
2. Under **Tjenester som tilbys** krysser du av for tjenestene du vil ha. Noen lar kunden velge et hentested; Helthjems viser den tyngste
   pakken hver tar.
3. Sett prisene:
   - **Posten / Bring, Porterbuddy, DHL Express og UPS** gir sin egen pris. Kaizena Flow legger til mva. og det du legger til: en
     **Prosent som legges til prisen inkl. mva.** og et **Beløp som legges til**. **Gratis når handlekurven er verdt minst** gjør dem
     gratis fra en handlekurvverdi. DHL Express og UPS priser i kontoens valuta: en pris i en annen valuta enn landets regnes om etter
     butikkens valutakurser, og tjenesten utelates der butikken ikke har noen kurs for den.
   - **PostNord, Helthjem og Instabox** har ingen pristjeneste. Skriv inn prisen for hver tjeneste i hvert land, inkl. mva., slik kunden betaler,
     etter avtalen din; lar du en pris stå tom, tilbys ikke tjenesten der. Hvert land har sin egen **Gratis når handlekurven er verdt
     minst**.
4. Under **Pakkens vekt når varene ikke har noen (gram)** oppgir du vekten som brukes for varer uten vekt.
5. Trykk **Lagre leveringsvalgene**.

Kundene oppgir postnummeret sitt i kassen og velger mellom din egen frakt og tjenestene til fraktselskapet. En tjeneste vises bare når
fraktselskapet tilbyr den for pakken og postnummeret. Porterbuddys leveringsvinduer vises etter dato og klokkeslett, hvert med sin egen
pris. Er flere fraktselskaper slått på i et land, vises tjenestene deres sammen.

> [!IMPORTANT]
> Svarer ikke fraktselskapet, brukes standardfrakten din. Behold en fast fraktpris for hvert land under
> [Frakt](/admin/{store}/settings/shipping): siden til fraktselskapet varsler når en mangler.

## Bestill frakt og skriv ut etiketter

På en bestilling som skal sendes med et fraktselskap, trykker du **Book med** fraktselskapet. Bestillingen av frakt starter med det kunden
valgte i kassen. Med DHL Express og UPS kan du også booke en bestilling der kunden valgte din egen frakt: velg **Tjeneste** først.
Bestillingen merkes som sendt med sporingsnummeret, og **Skriv ut etikett** åpner etiketten. Etiketter hentes fra fraktselskapet hver gang
du skriver dem ut, og lagres aldri, unntatt DHL Express' etiketter: DHL gir en etikett bare én gang, så den tas vare på med pakken i 30
dager og slettes så.

For flere bestillinger på en gang krysser du dem av i listen over bestillinger og velger **Book etiketter**. Se
[Send bestillinger](/docs/owners/orders/send-orders) for resten av sendingen.

- Porterbuddys tidsvindu spørres om på nytt når du bestiller. Er det borte, bestilles ingenting.
- Helthjems hjemlevering sjekkes for hele adressen før den bestilles.
- Instabox booker boksen kunden valgte. Tilbyr Instabox den ikke lenger, bestilles ingenting: be kunden velge en annen.
- En pakke med DHL Express eller UPS til et land utenfor EUs tollunion (fra Norge til Sverige, for eksempel) får tollpapirer fra
  produktenes HS-koder, opprinnelsesland og vekt. Mangler et produkt dem, nevnes det, og ingenting bestilles før du legger dem til.
- Bestilling og etiketter for PostNord kommer senere: siden viser dem som *kommer snart*.

## Flere valg

- **Glem opplysningene mine for** fraktselskapet, nederst på siden, fjerner den lagrede avtalen din.
- Avtalen med et fraktselskap kopieres aldri når du dupliserer butikken.
- Fraktselskapene har sin egen standardvekt, på siden sin. Dine egne fraktmetoder bruker den under Frakt (se
  [Fraktpriser](/docs/owners/shipping/shipping-rates)).
