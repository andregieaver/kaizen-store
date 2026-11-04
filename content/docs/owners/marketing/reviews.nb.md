---
title: Produktomtaler
summary: La kjøpere skrive omtale av det de har kjøpt, kontroller nye omtaler, publiser eller skjul dem, svar på dem, og be kjøpere om en omtale på e-post.
track: owners
section: marketing
kind: how-to
areas: [marketing, products]
features: [reviews]
plans: []
admin: /admin/{store}/reviews
order: 40
checked: 2026-11-04
sources: [D178, D301]
---

## Slå på omtaler

Omtaler er av til du slår dem på: åpne **Innstillinger**, velg [Funksjoner](/admin/{store}/settings/features) og slå på
**Produktomtaler**.

Slår du dem av senere, slutter omtalene å vises, og kundene kan ikke skrive nye. Alle omtalene beholdes til du slår dem på igjen.

## Hvem som kan skrive en omtale

Bare de som har kjøpt et produkt i butikken din og mottatt det. Derfor er hver omtale som skrives i butikken, et **Bekreftet kjøp**. En
kjøper kan skrive omtale av:

- varer, når bestillingen er levert eller hentet;
- en nedlasting, når den er betalt;
- en time, et opphold eller en utleie, når den er over og kunden møtte opp;

innen ett år etter at de mottok det. Gavekort kan ikke få omtale.

Kjøperne skriver fra **Omtaler** i Min konto, eller fra **Skriv omtale** ved en vare på siden til bestillingen sin: stjerner fra én til
fem, en tittel og tekst om de vil, navnet som skal vises, og opptil tre bilder. Én kjøper skriver én omtale av et produkt; kjøper de det
igjen, kan de endre omtalen, ikke skrive en til.

Ingen andre kan skrive omtaler, og de ansatte kan ikke endre ordene eller stjernene i en omtale. Tilby aldri noe tilbake for en omtale:
Kaizena Flow har ingen måte å belønne en omtale på, og produktsiden sier at ingen får belønning.

## Kontroller nye omtaler

1. Åpne **Produkter** i menyen og velg [Omtaler](/admin/{store}/reviews). Omtaler som står under **Venter på kontroll**, kommer først.
2. Les hver av dem, med stjernene, ordene, produktet og bestillingen den kom fra.
3. Trykk **Publiser** for å vise den, eller **Skjul** for å holde den borte fra nettstedet. For å skjule en må du velge **Hvorfor den
   ikke vises**: *Handler ikke om produktet*, *Krenkende eller hatefull*, *Inneholder personopplysninger*, *Spam eller reklame* eller
   *En annen grunn*.

> [!IMPORTANT]
> Det er ikke lov å skjule en omtale fordi den er negativ. Publiser de gode og de dårlige likt, og svar heller på en klage.

For å svare på en omtale skriver du under **Svaret ditt, vist under omtalen** og trykker **Lagre svaret**. Du kan endre eller fjerne
svaret senere. Et bilde kan skjules alene med **Skjul bildet**, mens omtalen blir som den er.

Søk i listen etter produkt eller ord, og filtrer den etter tilstand eller stjerner.

### Kontroller først, eller publiser med en gang

Under **Kontroll av nye omtaler** velger du:

- **Kontroller hver enkelt først** (standard): en ny eller endret omtale venter på denne siden til du publiserer den;
- **Publiser med en gang**: omtaler vises så snart de er skrevet, og du kan skjule en etterpå.

Valget gjelder for omtaler som skrives eller endres fra da av.

## Hva kundene ser

Når et produkt har en publisert omtale, viser produktsiden stjernene og gjennomsnittet under tittelen, og omtalene lenger ned: de ti
nyeste, med *Vis flere omtaler* for resten, hver med stjerner, ord, navn, dato og varianten som ble kjøpt. Før det vises ingenting.
Sammen med dem forteller *Slik sjekkes omtalene* kundene hvem som kan skrive, og hvorfor en omtale kanskje ikke vises. Søkemotorene får
også gjennomsnittet og antallet.

Omtaler vises med ordene og på språket de ble skrevet på, og oversettes aldri. Har du laget ditt eget produktoppsett, legger du til
delene **Vurdering** og **Anmeldelser** i det.

## Be kjøpere om en omtale

Under **Be kjøpere om en omtale** krysser du av for **Send forespørsler om omtale** og velger **Dager etter mottak**: fra 3 til 60 dager,
14 i starten. Hver bestilling får da én e-post, så mange dager etter at alt i den er mottatt, med en lenke for å skrive omtale uten å
logge inn.

Forespørslene går bare til kjøpere på [abonnentlisten](/docs/owners/marketing/email-marketing) din, siden det å be om en omtale er
markedsføring. De teller som markedsførings-e-poster i abonnementet ditt. Bestillinger som ble mottatt før du slo dette på, får ingen
forespørsel. Alle kjøpere kan fortsatt skrive omtale fra Min konto.

## Importer og eksporter omtaler

Slik henter du inn omtaler fra en annen tjeneste, som Shopifys Product Reviews, Judge.me eller Trustpilot:

1. På siden Omtaler, under **Import og eksport**, trykker du **Importer omtaler**.
2. Velg en CSV-fil med kolonnene `product_handle`, `rating`, `author` og `date`, og `title`, `body` og `source` hvis du har dem: høyst
   10 000 omtaler per fil. Eksporter fra Shopifys Product Reviews og Judge.me leses som de er.
3. Fyll inn **Hvor de ble skrevet**, for rader uten egen kilde, og **Når de vises**: **Vis dem med en gang** eller **La meg kontrollere
   hver enkelt først**.
4. Kryss av for **Bare kontroller filen, importer ingenting** og trykk **Kontroller filen** først. Fjern så haken og trykk **Importer**.

Hver rad finner produktet ditt ut fra handlen. Importerte omtaler vises med *Hentet fra …* og merkes aldri som bekreftet kjøp. En fil som
importeres to ganger, legger ikke til noe den andre gangen.

**Last ned som CSV** gir deg de publiserte og ventende omtalene dine.

## Omtaler og personopplysninger

En omtale er personopplysninger om den som skrev den: den er med når personen ber om opplysningene sine, og sletter du kunden, slettes
omtalene deres ([Personopplysninger](/docs/owners/customers/personal-data)).
