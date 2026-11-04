---
title: Land, språk og valutaer
summary: Velg landene du selger til, språkene og valutaene kundene kan velge, og valutakursene prisene regnes om etter.
track: owners
section: markets-and-tax
kind: how-to
areas: [markets, settings]
features: [countries, languages, currencies]
plans: []
admin: /admin/{store}/settings/countries
order: 10
checked: 2026-11-04
sources: [D109, D110, D111, D178, D335, D338]
---

## Slik fungerer det

Hvert land du selger til, er en egen butikk, med egen adresse, egne priser, egen frakt og egen merverdiavgift. Et land starter på sitt
eget språk og i sin egen valuta. Et produkt vises i et land når det har en pris der.

Ett av landene er ditt eget: landet til virksomheten din under [Virksomhet](/admin/{store}/settings/company) når du selger der, ellers
det første landet på listen. Beløpene i rapportene dine er i landets valuta.

## Selg i et nytt land

Salg i mer enn ett land er en funksjon du slår på først.

1. Åpne **Innstillinger** i menyen og velg [Funksjoner](/admin/{store}/settings/features). Under *Land og språk* slår du på
   **Flere land**. Bare en eier kan slå funksjoner av og på.
2. Åpne [Land](/admin/{store}/settings/countries) under Butikk. Kryss av for landet under **Land du selger til**, og trykk
   **Lagre land**.
3. Gi produktene en pris i det nye landet, i redigeringen av hvert produkt. Eller la prisene regnes ut fra et annet lands, under
   **Priser i hvert land** på samme side: se [Priser](/docs/owners/products/prices).
4. Bestem hva frakt koster der: se [Fraktpriser](/docs/owners/shipping/shipping-rates).

Vil du slutte å selge i et land, fjerner du haken og trykker **Lagre land**. Et land som tas av listen, beholder prisene og
innstillingene sine, og kommer tilbake som det var når du legger det til igjen.

Så lenge **Flere land** er av, spør siden om **Landet du selger i**: ett land. Velger du et annet, blir det det eneste; de andre
beholder prisene og innstillingene sine.

> [!NOTE]
> Slår du **Flere land** av igjen, tilbys ikke de andre landene lenger. Adressene deres leder til ditt eget land, og bestillinger som
> allerede er lagt der, beholder sidene og lenkene sine.

## Språk og valutaer

Språk og valuta velges uavhengig av landet. En kunde i Norge kan lese butikken på engelsk og se prisene i euro. Kundene velger begge
deler i toppteksten, og valget står i adressen: `/no-en-eur` er Norge, på engelsk, i euro.

Andre språk tilbys bare mens **Flere språk** er på, og andre valutaer bare mens **Flere valutaer** er på. Begge slås på under
Innstillinger, Funksjoner. Åpne deretter [Språk og valutaer](/admin/{store}/settings/localization) under Butikk. Bare en eier kan endre
denne siden; andre medlemmer kan lese den.

### Språk

Kryss av for **Tilby** ved hvert språk du vil ha, velg **Hoved**-språket og trykk **Lagre språk**.

- Hovedspråket er det du skriver på først. Produkter, sider, menyer og e-poster kan også skrives på hvert av de andre.
- Under **Hvert lands språk** velger du hva hvert land viser på sin egen adresse. Kundene kan fortsatt bytte til et hvilket som helst
  annet språk du tilbyr.
- Et språk som et land viser som standard, er merket *et lands språk* og kan ikke fjernes.
- Ved hvert språk står det hvor langt butikkens egne knapper, handlekurv, kasse og e-poster er kommet på det. Norsk, svensk, dansk og
  engelsk er skrevet for hånd. Andre språk vises på engelsk til Kaizena Flow har oversatt dem.

Så lenge **Flere språk** er av, velger du bare **Hovedspråk** og **Hvert lands språk**, og trykker **Lagre språk**.

### Valutaer

Kryss av for **Tilby** ved hver valuta du vil ha, og trykk **Lagre valutaer**.

- Prisene lagres i hvert lands egen valuta og regnes om når en kunde velger en annen. En kunde som betaler i euro, belastes i euro.
- **Kurs per 1 EUR** er hvor mange enheter av valutaen du får for én euro, slik Den europeiske sentralbanken (ECB) publiserer dem. En
  valuta trenger en kurs, og det samme gjør hvert lands egen, før beløp kan vises i den.
- **Avrund til** runder omregnede priser av til et trinn, så de ser ut som priser. **Ingen avrunding** beholder dem nøyaktige.
- Et lands egen valuta er merket *et lands valuta* og tilbys alltid.
- Abonnementer og abonnementskasser selges bare i et lands egen valuta.

### Valutakurser

Kryss av for **Hold kursene oppdatert fra ECB hver dag**, eller trykk **Hent ECBs kurser nå** for dagens kurser. Du kan også skrive inn
din egen kurs i **Kurs per 1 EUR**. Siden viser når kursene sist ble oppdatert fra ECB.

## Flere valg

### Hvert lands eget innhold

- **En side eller artikkel bare for noen land.** I sidebyggeren, under **Hvem som kan lese den**, velger du **Bare noen land** under
  **Land**. I de andre landene vises ikke siden, den listes ikke og er ikke i nettstedskartet.
- **En annen beskrivelse i ett land.** I redigeringen av et produkt åpner du **En annen beskrivelse i ett land**: for eksempel en tysk
  tekst for Østerrike ved siden av Tysklands. Tittelen er den samme overalt.
- **En annen menytekst i ett land.** I menyredigeringen har en lenke **En annen menytekst i ett land**.
- **Selges ikke i ett land.** I redigeringen av et produkt fjerner du haken for landet under **Selges i**. Prisen der beholdes til du
  krysser av igjen.

En besøkende fra et annet av landene dine får tilbud om en lenke til samme side i sitt land. Ingen blir flyttet dit.

### Et domene for et land

En butikk som selger i flere land, kan gi ett av dem sitt eget domene. Under [Domener](/admin/{store}/settings/domains) åpner du
**Bruk for ett land** under et domene og velger landet. Ditt eget land beholder butikkens hovedadresse. En butikk gir domener til landene
sine eller til språkene sine, ikke begge deler. Se [SEO, videresendinger og domener](/docs/owners/website/seo-redirects-and-domains).

### Oversett butikken med KI

[Oversett butikken](/admin/{store}/translate), under Nettsted, oversetter produkter, menyer, sider, artikler og mer til et annet av
språkene dine på én gang. KI-en foreslår; du leser hver tekst og krysser av for dem du vil beholde, og ingenting skrives før du lagrer.

- Sider lagres som utkast, så ingenting publiseres for deg. Produkter, menyer og egne felt er i bruk med en gang de er lagret.
- Juridiske tekster (salgsbetingelser, personvern, retur, angrerett og sikkerhetsinformasjon) starter uten hake: les dem selv.
- Tekster skrevet for ett land oversettes aldri: hver er landets egen.
- Butikken trenger en tekstmodell for KI, valgt under Innstillinger, KI.

Se [KI-tekster og -bilder](/docs/owners/ai/ai-texts-and-pictures).
