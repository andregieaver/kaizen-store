---
title: Tekster og bilder laget med KI
summary: La KI foreslå produkttekster og oversettelser, lage og redigere bilder, og les alt den har skrevet før det lagres.
track: owners
section: ai
kind: how-to
areas: [ai, products, website]
features: []
plans: []
admin: /admin/{store}/products
order: 40
checked: 2026-11-04
sources: [D76, D89, D110, D283, D349, D413]
---

I produktredigeringen og når du oversetter butikken, foreslår KI-en bare: ingenting den skriver, lagres før du har lest det og lagret
det selv. Et filter holder ute påstander en butikk ikke kan komme med.

## Skriv tekstene til et produkt

Åpne et produkt. Ved siden av tekstene på hvert språk tilbyr panelet *Write with AI*:

- på hovedspråket: *Write a description* (når produktet har en tittel), *Improve the description* (når det har en beskrivelse) og
  *Write search texts* (tittel og beskrivelse i søkeresultater);
- på hvert av de andre språkene: *Translate from* hovedspråket, og *Write search texts*.

Panelet har foreløpig bare engelske ord, også i en norsk administrasjon.

1. Trykk på det du vil ha. Forslaget vises i panelet, merket *Written by AI*.
2. Les det, sjekk hvert faktum mot produktet, og endre det du vil.
3. Trykk *Use this* for å kopiere det inn i produktets felt, eller *Discard*.
4. Trykk **Lagre** på produktet som vanlig. Ingenting lagres før det, og kundene ser det først når produktet er publisert.

KI-en får bare produktets egne ord: tittel, beskrivelse, søketekster, kategorier, stikkord og valg. Den får aldri priser eller
lager, og den får beskjed om ikke å legge til fakta. Panelet vises når butikkens KI har en tekstmodell.

### Filteret for påstander

Før du kan bruke et forslag, merker filteret uttrykk en butikk ikke kan bruke uten bevis, og ord som bare katalogen skal oppgi:

- generelle miljøpåstander, som «miljøvennlig»;
- hast eller knapphet, som «bare i dag»;
- påstander om beste eller laveste pris;
- pengebeløp og lagertall;
- ord du har fortalt KI-assistenten at merkevaren din aldri bruker.

*Use this* er grå til du har tatt dem ut eller skrevet din egen tekst. Filteret leser norsk, svensk, dansk, engelsk og tysk. Det
viser, og du avgjør: en farge som heter «grønn», blir også merket.

> [!IMPORTANT]
> Det du publiserer, er ditt. Les hver tekst KI-en skriver før du bruker den, slik du ville lest en ny kollegas.

## Lag et bilde med KI

**Lag med KI** finnes tre steder når butikkens KI har en bildemodell:

- i sidebyggeren, på bildefelt (**Lag på nytt med KI** der feltet allerede har et bilde); et felt for logo har det ikke;
- i [mediebiblioteket](/admin/{store}/media) (Nettsted, Medier);
- under bildene til et produkt, der beskrivelsen starter med produktets tittel.

1. Under **Hva skal det vise?** sier du hva som er i bildet og hvordan det er utsnitt.
2. Velg **Form**: *Bredt*, *Høyt* eller *Kvadratisk*.
3. La **I nettstedets stil** stå på for å følge temaets fotografier, farger og stemning.
4. Trykk **Lag bildet**. Det tar opptil et minutt. Trykk deretter **Bruk dette bildet**, eller **Lag et nytt**.

Hvert bilde som lages, tas vare på i mediebiblioteket, enten du bruker det eller ikke. Ord, bokstaver og logoer tegnes aldri i det.
Den alternative teksten tas fra beskrivelsen din når filteret ikke finner noe i den; ellers står den tom til de alternative tekstene
fylles inn.

## Rediger et bilde med KI

I mediebiblioteket åpner du et bilde og velger under **Rediger med KI**:

- *Fjern bakgrunnen*;
- *Ny bakgrunn*, og si hva den skal være;
- *Endre noe*, og si hva som skal endres.

Trykk **Rediger bildet**. Redigeringen blir et nytt bilde i biblioteket; bildet du startet med, forblir som det er. I sidebyggeren har
et bildefelt med et bilde **Fjern bakgrunnen** på samme måte.

Redigering krever en **Modell som redigerer bilder** i butikkens [KI-innstillinger](/admin/{store}/settings/ai); uten en redigerer
bildemodellen der den kan. Selve bildet sendes til den leverandøren, sammen med hva som skal endres.

### Hvem som laget et bilde

Mediebiblioteket merker bilder laget av KI med *KI*, og bilder redigert av KI med *KI-redigert*. Detaljene for et bilde sier under
*Laget av*: *Lastet opp*, *Laget av KI* eller *Redigert av KI*.

Biblioteket kan også skrive de alternative tekstene til bildene med KI, på alle nettstedets språk: se
[Bilder og video](/docs/owners/products/pictures-and-video).

## Oversett butikken med KI

Når butikken har mer enn ett språk, oversetter [Oversett butikken](/admin/{store}/translate) (Nettsted) produkter, menyer, sider og
artikler, kategorier og stikkord, og mer, til et av de andre språkene i én omgang. Bare ord sendes til KI-en, aldri priser eller
lager.

1. Velg språket under **Til**, og hva som skal oversettes, og trykk **Finn tekster**.
2. Trykk **Oversett til** språket.
3. Les hver tekst, fjern haken ved det som ikke er riktig, og trykk knappen som lagrer dem (for eksempel **Lagre 12 på engelsk**).

Ingenting skrives før du lagrer. Sider lagres som utkast, så du publiserer dem selv; produkter, menyer og egne felt er i bruk med en
gang de er lagret. Juridiske tekster, som vilkår, personvern og retur, står for seg og starter uten hake: en maskinoversettelse av dem
må du lese selv. Mer i [Land, språk og valutaer](/docs/owners/markets-and-tax/countries-languages-currencies).

## Flere valg

- **Endre med KI** i sidebyggeren endrer en side ut fra det du ber om, og du beholder eller angrer endringen: se
  [Sidebyggeren](/docs/owners/website/the-page-builder).
- [KI-assistenten](/docs/owners/ai/the-ai-manager) kan også skrive tekstene til et produkt og lage bildene, med den samme skriveren og
  det samme filteret; en endring av et publisert produkt venter på ditt ja.
- Med Kaizena Flows KI teller det KI-en koster, bilder medregnet, mot abonnementets månedlige grense for KI
  ([Velg et abonnement](/docs/owners/getting-started/choose-a-plan)).
