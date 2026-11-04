---
title: Søkemotorer, omdirigeringer og domener
summary: Velg hvordan butikken vises i søkeresultater og når den deles, hold gamle lenker i live med omdirigeringer, og bruk ditt eget domene.
track: owners
section: website
kind: how-to
areas: [website, settings, marketing]
features: []
plans: []
admin: /admin/{store}/settings/seo
order: 50
checked: 2026-11-04
sources: [D168, D313, D315, D338, D339, D358, D385, D445]
---

## Slik ser søkemotorene butikken

Åpne **Innstillinger** i menyen og velg [SEO og synlighet](/admin/{store}/settings/seo), under Nettsted. Øverst på siden står det om
søkemotorene kan finne butikken. Kaizena Flow forteller dem om hvert produkt, i hvert land du selger til, med pris, lagerstatus, frakt og
returvilkårene dine, og holder **Nettstedskart**, **Regler for søkeroboter (robots.txt)** og **Sammendrag for KI-assistenter
(llms.txt)** oppdatert. Trykk på hvilken som helst av de tre for å se på den.

Alt på denne siden er valgfritt. Så lenge butikken ikke er åpnet, holdes søkemotorene ute; de er velkomne når du åpner den.

Dette kan du legge til:

- **Forsiden din i søkeresultatene**: en tittel og en beskrivelse. Tomme felt bruker navnet på butikken og en linje Kaizena Flow skriver.
- **Delingsbilde**: vises når noen deler butikken på Facebook, LinkedIn, Messenger, Slack og lignende. Det blir best i 1200 × 630
  piksler. Produktsidene bruker produktets eget første bilde.
- **Virksomheten din andre steder**: profilene dine i sosiale medier og andre oppføringer, én adresse per linje. De hjelper søkemotorene
  å knytte butikken til virksomheten din.
- **KI-assistenter**: om KI-søk og assistenter kan lese butikken for å svare på folks spørsmål, og om KI-selskaper kan trene modellene
  sine på tekstene og bildene. Begge er krysset av til du fjerner krysset. **Dine egne ord til KI-assistenter** legges til i llms.txt.

Trykk **Lagre søk og deling**.

Hver side og artikkel har sin egen tittel og beskrivelse til søk under **Søk og deling** i
[sidebyggeren](/docs/owners/website/the-page-builder). Produktkategorier og stikkord har også sine egne, på hvert av språkene dine, der
du redigerer dem under Produkter.

> [!TIP]
> Siden teller også produktbildene som bare er beskrevet med produktets tittel. Noen ord om hva hvert bilde viser, hjelper folk som
> bruker skjermleser, og bildesøk.

### Avansert

- **Be søkemotorer om å utelate butikken**: for en butikk som bare skal nås med lenken. Det får virkning etter hvert som søkemotorene
  kommer innom igjen.
- **Ekstra regler for søkeroboter**: dine egne linjer i robots.txt (*User-agent*, *Allow* og *Disallow*), med stier fra butikkens
  inngang. Handlekurver og ordresider utelates alltid.
- **Kode for Google Search Console** og **Kode for Bing Webmaster Tools**: lim inn koden disse verktøyene gir deg for å vise at butikken
  er din, og send deretter inn nettstedskartet der.

## Hold gamle lenker i live

Når en adresse endres, sender en omdirigering kunder og søkemotorer videre til den nye, i alle land og på alle språk. Kaizena Flow lager
en selv når et produkt, en kategori eller et stikkord får ny adresse, og når du publiserer en side eller artikkel på en ny adresse.

Slik legger du til dine egne, for eksempel for adressene til en gammel nettbutikk:

1. Åpne **Nettsted** i menyen og velg [Omdirigeringer](/admin/{store}/redirects).
2. Under **Legg til en omdirigering** skriver du **Omdiriger fra** og **Omdiriger til**: adresser i butikken uten land, som
   `/collections/shoes` og `/category/shoes`.
3. Trykk **Legg til omdirigeringen**.

En omdirigering virker bare fra en adresse som ikke finnes i butikken, og bare til din egen butikk. Omdirigeringer er permanente:
nettlesere og søkemotorer husker dem, så vær forsiktig når du endrer eller fjerner en. Listen viser hvor ofte hver er brukt, og du kan
søke i den og bruke **Rediger** og **Slett** på dine egne. En som Kaizena Flow har laget, kan ikke redigeres: lag din egen fra samme adresse for å erstatte
den.

### Finn lenkene som ikke fører noen steder

**Sider som ikke ble funnet**, ved siden av Omdirigeringer, viser adressene kunder og søkemotorer spurte etter som butikken ikke hadde,
de mest etterspurte først, de siste 7, 30 eller 90 dagene. Finner den et sannsynlig mål blant produktene, kategoriene, stikkordene,
sidene og artiklene dine, trykker du **Omdiriger til …** for å legge til omdirigeringen med ett trykk. Ellers skriver du et eget mål med
**Omdiriger …** (eller **Et annet mål …**). **Ignorer** skjuler en adresse. Forslagene finnes ved å sammenligne ord, aldri med KI, så se
på målet før du trykker.

Bare adressen og dagen lagres, i 90 dager: ingen IP-adresse, nettleser, informasjonskapsel eller noe annet om den besøkende.

### Mange på en gang

**Import** henter inn omdirigeringer fra en CSV-fil med kolonnene *Redirect from* og *Redirect to*; en omdirigeringsfil fra Shopify kan
brukes som den er. Du ser hva importen vil gjøre, linje for linje, før noe endres, og en import sletter aldri en omdirigering. **Eksport**
laster ned dine egne, eller alle.

Flytter du fra en annen nettbutikk? **Gammel butikk** leser listen over sider i den gamle butikken og fikser med ett trykk alle gamle
lenker der produktet, siden eller innlegget finnes her under samme navn.

## Bruk ditt eget domene

Åpne **Innstillinger** i menyen og velg [Domener](/admin/{store}/settings/domains), under Butikk. Butikken har allerede en adresse hos
Kaizena Flow. Bare butikkens eiere kan legge til eller kjøpe et domene, og abonnementet bestemmer hvor mange en butikk kan ha.

### Koble til et domene du eier

1. Under **Dine egne domener** skriver du domenet, som `butikk.example.no` eller `example.no`, og trykker **Legg til domene**.
2. Det står *Venter på DNS*, med postene som må lages. Lag dem hos selskapet der du styrer domenets DNS, og fjern andre A-, AAAA- eller
   CNAME-poster på samme navn. Tilbyr siden **Koble til automatisk**, kan det selskapet legge dem inn for deg: logg inn der og godkjenn.
3. Trykk **Sjekk nå**. Siden sjekker også hver gang du åpner den; det kan ta noen timer før DNS-endringer vises.

Når postene er på plass, blir domenet butikkens adresse, med sertifikat for https, og de andre adressene dine fører dit. Har du flere
domener, velger du hvilket med **Gjør dette til adressen**.

### Kjøp et domene her

Under **Skaff et domene** søker du etter et navn og kjøper det: butikken flytter dit av seg selv, uten DNS å sette opp. Domenet
registreres på deg eller selskapet ditt, aldri på Kaizena Flow. Til kjøp er åpnet for butikken din, står det på siden.

### Flere valg

- **Bruk for ett språk** eller **Bruk for ett land** får et domene til å vise butikken på det språket, eller for det landet, uten språket
  eller landet i adressene. En butikk gir domener til språkene sine eller til landene sine, ikke begge.
- **Flytt et domene hit** flytter DNS-en eller registreringen til et domene til Kaizena Flow; **Flytt dette domenet** flytter et bort,
  steg for steg.

## Privat modus

Mens butikken er privat, ser besøkende bare landingssiden; bestillinger som allerede er lagt inn, beholder sidene sine. En ny butikk er
privat til du åpner den. Åpne **Innstillinger** og velg [Privat modus](/admin/{store}/settings/private), under Nettsted:

- **Gjør butikken privat** eller **Åpne butikken for alle**.
- **Passord**: besøkende som har det, kan komme inn. Uten passord er det bare teamet ditt som kan det. **Logg ut alle** gjør at de må
  skrive det inn igjen.
- **Landingsside**: det besøkende ser, bygget i sidebyggeren og valgt under **Spesielle sider** på listen over sider.
- **Forhåndsvis butikken** viser den slik den er, uten passordet, i 12 timer.

En privat butikk holdes utenfor søkemotorene.

## Publiser flere endringer samtidig

[Klargjøring](/admin/{store}/staging), under Nettsted, samler endringer i sider, utseende og menyer, så de publiseres med ett trykk:

1. Trykk **Start et klargjøringssett** og gi det et navn.
2. Kryss av for **Ta med** på sider med endringer. Du redigerer en kopi: sidens eget utkast og det besøkende ser, blir som de er.
3. Velg et tema du har installert, men ikke tatt i bruk, og **Klargjør en endring** i en meny.
4. Se på **Hva er endret**, og trykk deretter **Publiser alt**. Besøkende ser alt med en gang.

**Forkast settet** lar alt være som det var. Bare ett sett kan være åpent om gangen, og produkter, bestillinger og kunder er aldri med.
