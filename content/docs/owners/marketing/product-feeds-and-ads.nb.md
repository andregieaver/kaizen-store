---
title: Produktfeeder, annonser og konverteringer
summary: Vis produktene dine på Google Shopping, Meta, TikTok og Pinterest med en produktfeed, og gi annonseplattformene beskjed om kasser og kjøp fra kunder som har tillatt markedsføringsinformasjonskapsler.
track: owners
section: marketing
kind: how-to
areas: [marketing, integrations]
features: []
plans: []
admin: /admin/{store}/feeds
order: 60
checked: 2026-11-04
sources: [D58, D302, D303, D353]
---

## Produktfeeder

En produktfeed er produktene dine som en fil som Google Merchant Center, Meta, TikTok eller Pinterest leser selv. Du limer inn adressen
hos kanalen én gang, og kanalen henter filen når det passer den.

1. Åpne **Markedsføring** i menyen og velg [Produktfeeder](/admin/{store}/feeds). Trykk **Slå på produktfeeder**.
2. Hvert land du selger i, har sine egne **Adresser å lime inn**: **Google Merchant Center**, **Meta (Facebook og Instagram)**,
   **TikTok** og **Pinterest**. Trykk **Kopier** ved den du trenger.
3. Lim inn adressen i kanalens egen konto, der kanalen ber om adressen til en feed.

Hver variant er én artikkel, med prisen slik butikken i det landet viser den, inkludert mva., lagerstatus, GTIN, merke, bilder og den
faste fraktprisen din. Når en pris er satt ned, gir Google-feeden den laveste prisen de siste 30 dagene som pris og den nye som
tilbudspris. Priser og lager i feedene er høyst 15 minutter gamle. Kanalene kan bare hente feedene mens butikken er åpen.

### Produkter som er utelatt

Under **Ikke i feedene** viser hvert land produktene som er utelatt, og hvorfor: *ikke en vare eller nedlasting*, *selges bare som
abonnement*, *bare for bedrifter*, *mangler bilde*, *mangler pris* eller *pris på forespørsel*. Legg til et bilde eller en pris, så
kommer produktet med av seg selv.

### Hold adressen for deg selv

Adressen er hemmelig: alle som har den, kan lese feeden. Kommer den på avveie, trykker du **Lag en ny adresse**. Den gamle slutter å
virke med en gang, så lim inn den nye i hver kanal. **Slå av** stopper alle feedene.

> [!NOTE]
> Den samme siden har **Handleagenter**, som lar KI-assistenter som handler for folk søke i produktene dine og sette sammen en
> handlekurv som kunden betaler i din egen kasse, og en **ChatGPT-shoppingfeed**. Begge er av til du slår dem på.

## Annonsetagger i nettleseren

Åpne **Innstillinger** og velg [Informasjonskapsler og sporing](/admin/{store}/settings/cookies). Under **Verktøy for analyse og
markedsføring** limer du inn ID-en til hvert verktøy du bruker: **Google Analytics 4**, **Google Tag Manager**, **Meta Pixel**, **Google
Ads**, **TikTok Pixel** eller **Pinterest Tag**, og trykker **Lagre verktøy**. La et felt stå tomt for å slå verktøyet av.

Hvert verktøy lastes først når en besøkende tillater det i samtykkebanneret, som vises av seg selv når et verktøy er på. Med samtykke
får verktøyene vite om produktvisninger, listevisninger, søk og varer lagt i handlekurven, bare med produkt-ID-er og priser. Kasser og
kjøp sendes ikke fra nettleseren: de går fra serveren, som nedenfor.

## Konverteringer fra serveren

Salg som sendes fra serveren, telles også når kunden bruker annonseblokkering.

1. Åpne **Markedsføring** og velg [Annonser og konverteringer](/admin/{store}/ads).
2. Under plattformen limer du inn ID og token: for **Meta (Facebook og Instagram)** **Piksel-ID** og **Tilgangstoken for Conversions
   API**; for **Google Analytics 4** **Målings-ID (G-…)** og **API-hemmelighet for Measurement Protocol**; for **TikTok** **Pikselkode**
   og **Tilgangstoken for Events API**; for **Pinterest** **Annonsekonto-ID** og **Konverteringstoken**.
3. Velg **Hva som sendes**: **Standard**, ordren og annonsens klikk-ID uten noe personlig, eller **Utvidet**, som også sender kundens
   e-post og telefon, hashet, så flere salg kobles til annonser.
4. Kryss av for **Send hendelser** og trykk **Lagre**. En **Kode for testhendelser (valgfri)** fra plattformen lar deg sjekke hendelsene
   der først.

Fra da av sendes hver bestilling som lages og hver betaling som tas, innen ett minutt, men bare for kunder som har tillatt
markedsføringsinformasjonskapsler. Et kjøp betalt i testmodus sendes aldri. Siden viser de siste 7 dagene: hvor mange som ble sendt,
ikke sendt og feilet, med grunnen.

Kundens IP-adresse og nettleseropplysninger sendes aldri, siden Kaizena Flow ikke tar vare på noen av dem. Refusjoner sendes ikke. Kjøp
når Google Ads gjennom koblingen til Google Analytics. Bare butikkens eier kan koble til en plattform, endre den eller trykke **Koble
fra**.

## Samtykke til informasjonskapsler

Butikken spør besøkende om informasjonskapsler bare når noe trenger samtykke, som et verktøy ovenfor. Banneret tilbyr *Avslå alle* og
*Godta alle* likt, med et valg for hver type informasjonskapsel, og besøkende kan endre valget senere fra siden om informasjonskapsler.
En besøkende som sier nei til markedsføring, spores ikke av annonsetagger og sender ingen konverteringer, og en verve- eller skaperlenke
de åpnet, huskes bare til de forlater nettstedet.

For å se hvilke kanaler og kampanjer som gir salg, åpner du **Analyse**, **Markedsføring**
([Analyse](/docs/owners/analytics/analytics)).
