---
title: "E-postmarkedsføring: abonnenter, nyhetsbrev og automatiske e-poster"
summary: Bygg en liste over folk som har bedt om e-postene dine, del dem inn i segmenter, send dem nyhetsbrev, la automatiske e-poster gå av seg selv, og minn kunder på handlekurver de forlot.
track: owners
section: marketing
kind: how-to
areas: [marketing, customers]
features: []
plans: []
admin: /admin/{store}/broadcasts
order: 20
checked: 2026-11-04
sources: [D33, D295, D296, D297, D298, D304, D314, D352, D368]
---

## Hvem som får e-postene dine

Markedsførings-e-postene dine går bare til folk som har bedt om dem: dem på listen under [Abonnenter](/admin/{store}/subscribers) som
vil ha e-postene dine. De melder seg på på tre måter:

- et påmeldingsskjema på en side på nettstedet ditt, komponenten **Nyhetsbrev** i [sidebyggeren](/docs/owners/website/the-page-builder);
- en avkrysningsboks i kassen, som aldri er krysset av på forhånd;
- bryteren i Min konto.

En adresse som noen skriver inn, kommer med når eieren av den har bekreftet den fra en lenke vi sender på e-post. I et nyhetsbrevskjema
heter dette **Bekreft adressen først (dobbel bekreftelse)**, og det er på med mindre du slår det av; la det stå på, siden det beviser
samtykket. En innlogget kunde med bekreftet e-postadresse står på listen med en gang. De ansatte melder aldri på noen.

Hver markedsførings-e-post har en lenke for å melde seg av, og avmeldingsknappen i e-postprogrammet virker også. En adresse som ikke
finnes, eller der eieren merker en e-post som søppelpost, går av listen av seg selv.

Under **Abonnenter** ser du statusen til hver person, hvor de meldte seg på, ordene de sa ja til og når. Åpne en person for å se
historikken, og trykk **Meld av** for en som ber deg ta dem av listen. Butikkens eiere kan eksportere listen med **Eksporter**.

## Send et nyhetsbrev

Et nyhetsbrev er en e-post med nyheter eller tilbud, skrevet én gang og sendt til alle på listen din, eller til et segment.

1. Åpne **Markedsføring** i menyen og velg [Nyhetsbrev](/admin/{store}/broadcasts). Trykk **Nytt nyhetsbrev**.
2. Under **Start fra** velger du **Tomt** eller en av malene: **Nyheter**, **Nye produkter**, **Et tilbud**, **Sesongen** eller
   **Takk**.
3. Gi det et **Navn**, som bare du ser, og velg **Hvem som får det**: **Alle som vil ha e-postene dine**, eller
   **Personene i et segment som vil ha e-postene dine**.
4. For hvert av språkene dine skriver du **Emne**, en valgfri **Forhåndsvisningslinje** og hva det sier, satt sammen av deler:
   **Overskrift**, **Tekst**, **Knapp**, **Bilde**, **Linje**, **Produkt** og **Kampanje**.
5. Trykk **Lagre utkast**, så **Send en test til deg selv**, og les den.
6. Trykk **Send nå**, eller **Send det senere** og velg når.

Hver person får det én gang, på sitt eget språk der du har skrevet det. Bilder hentes fra mediebiblioteket ditt som JPEG, PNG eller GIF,
siden noen e-postprogrammer ikke kan vise andre formater.

En **Produkt**-del viser produktets bilde, prisen slik hver lesers land viser den, og en lenke. En **Kampanje**-del viser tilbudet fra
kampanjen. Begge fylles inn når e-posten sendes, og utelates der produktet ikke lenger selges eller kampanjen er over.

> [!TIP]
> **Skriv med KI** foreslår ordene ut fra noen få av dine egne, og kan velge produkter og kampanjer som pågår. KI-en skriver aldri
> priser eller lager, og ingenting sendes før du sender det. Det krever at KI er satt opp for butikken
> ([KI-tekster og bilder](/docs/owners/ai/ai-texts-and-pictures)).

### Etter at du har sendt

Mens et nyhetsbrev sendes, stopper **Stopp sendingen** resten. Et planlagt nyhetsbrev kan kalles tilbake med **Ikke send det da**.

Når det er sendt, viser siden hvor mange det ble **Sendt til**, hvor mange som ble **Levert**, **Avvist** eller
**Merket som søppelpost**, hvor mange som har **Meldt av siden**, og **Trykk på lenkene**. Åpninger spores ikke. Adressene fjernes 90
dager etter sendingen; tallene blir stående.

Et nyhetsbrev du liker, kan du ta vare på med **Lagre som mal**. Da ligger det under **Malene dine** når du starter et nytt.

Markedsførings-e-poster teller mot abonnementets grense per måned; se [Velg et abonnement](/docs/owners/getting-started/choose-a-plan).

## Lag et segment

Et segment er en gruppe av kundene og abonnentene dine etter hva de har gjort. Det telles på nytt hver gang du åpner det, så det er
alltid oppdatert.

1. Åpne **Markedsføring** og velg [Segmenter](/admin/{store}/segments). Trykk **Nytt segment**.
2. **Start fra** et ferdig segment, som *De beste kundene dine*, *Ingen bestilling på et halvt år* eller
   *Abonnerer, men har aldri kjøpt*, eller fra alle.
3. **Legg til et vilkår**: **Samtykke til e-post**, **Antall bestillinger**, **Beløp brukt**, **Siste bestilling**,
   **Første bestilling**, **Kundetype**, **Land**, **Språk**, **Kundegruppe**, **Firmakonto**, **Konto** eller **Stikkord**. Velg om
   folk må passe med alle vilkårene eller minst ett av dem.
4. Se tallet endre seg mens du redigerer: hvor mange som er med, og hvor mange av dem som vil ha e-postene dine. Trykk så
   **Lagre segment**.

Send et nyhetsbrev til et segment, eller gi en [kode eller kampanje](/docs/owners/marketing/discount-codes-and-campaigns) bare til dem i
det. Stikkord gir du folk på kundesiden deres. En butikk kan ha opptil 100 segmenter.

## Automatiske e-poster

Åpne **Markedsføring** og velg [Automatiske e-poster](/admin/{store}/automations). Det finnes fire:

| E-post | Når den går |
|---|---|
| **Velkommen** | Når noen melder seg på listen din, med en gang eller noen dager etter. |
| **Etter et kjøp** | Noen dager etter at en bestilling er levert. |
| **Vinn tilbake** | Når et antall dager har gått siden en persons siste bestilling. |
| **På lager igjen** | Kunder trykker *Send meg en e-post når den er tilbake* på et utsolgt produkt, og får én e-post når det er tilbake. |

De tre første går bare til folk på listen din som vil ha e-postene dine, én gang til hver. Hver starter med ord du kan bruke som de er,
eller endre. Trykk **Sett den opp**, les og endre ordene, **Send en test til deg selv**, lagre, og trykk **Slå på**. Å slå én på skriver
aldri til noen om det som skjedde før. Hvert kort viser hvor mange e-poster den har sendt de siste 30 dagene.

Å be om en e-post når noe er på lager igjen, melder ingen på listen din.

## Påminnelser om handlekurv

Påminnelser om handlekurv sendes til kunder som skrev inn e-postadressen sin i kassen, men ikke betalte, med en knapp som legger den
samme handlekurven tilbake.

1. Åpne **Markedsføring** og velg [Påminnelser om handlekurv](/admin/{store}/cart-reminders). Trykk **Slå på**.
2. Du starter med tre påminnelser: etter en time, en dag og tre dager. Åpne en for å endre når den går (fra 30 minutter til 30 dager
   etter at e-postadressen ble skrevet inn), ordene på hvert språk, eller for å legge til en rabattkode. Hver kan slås av for seg.

Mens de er på, tar kassen vare på e-postadressen til en kunde som ikke er innlogget, så snart den skrives inn, og sier under feltet at
det kan komme en påminnelse, med en lenke for å si nei. Hver påminnelse har en lenke for å stoppe dem. De stopper når handlekurven er
kjøpt, og 30 dager etter at e-postadressen ble skrevet inn. E-postadressen og handlekurven slettes etter 60 dager. Innloggede kunder får
ingen påminnelser.

Siden viser de siste 30 dagene: handlekurver med e-post, hvor mange som ble påminnet, hvor mange som kjøpte etter en påminnelse, og de
salgene. Under **Til personvernerklæringen din** står det du bør skrive i personvernerklæringen.

## Flere valg

- **En velkomstkode.** Et nyhetsbrevskjema kan sende hver adresse som bekrefter, én engangskode fra en rabatt på e-post
  (**Velkomstkode**), og merke dem med stikkord (**Merk de som melder seg på**) til segmentene dine. Rabatten må ha engangskoder, og
  skjemaet må be om bekreftelse av adressen.
- **Personopplysninger.** En persons plass på listen, historikken og e-postene som er sendt til dem, er med når personen ber om
  opplysningene sine, og sletting fjerner alt ([Personopplysninger](/docs/owners/customers/personal-data)).
