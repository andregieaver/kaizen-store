---
title: Produsentansvar
summary: Legg inn registreringene dine for emballasje, elektriske og elektroniske produkter, batterier og de andre ordningene i hvert land, så produktene som hører under dem, kan selges der.
track: owners
section: markets-and-tax
kind: how-to
areas: [products, markets, settings]
features: []
plans: []
admin: /admin/{store}/settings/producer-responsibility
order: 50
checked: 2026-11-04
sources: [D342]
---

## Slik fungerer det

I mange land må den som selger visse varer der, registrere seg i ordningen som samler inn og gjenvinner dem, og kan måtte betale et
vederlag. Kaizena Flow tar vare på registreringene dine, ordning for ordning og land for land, og holder tilbake det som ikke er dekket:

- Du krysser av for ordningene et produkt hører under, i produktredigeringen. Et nytt produkt har ingen avkrysning.
- Et avkrysset produkt selges i et land bare mens en registrering for ordningen der gjelder, fra første til siste dag, eller når du har
  skrevet hvorfor ingen trengs.

Ordningene er **Emballasje**, **Elektriske og elektroniske produkter**, **Batterier**, **Tekstiler**, **Møbler** og **Dekk**.

> [!IMPORTANT]
> Kaizena Flow sjekker ikke numrene hos myndighetene, og hva hvert land krever, må du selv sjekke.

## 1. Kryss av for ordningene på produktene

I redigeringen av et produkt åpner du **Avgift, retur og gjenvinning** og krysser av for ordningene under **Returordninger produktet
hører under**. Lagre produktet.

## 2. Legg inn registreringene dine

Åpne **Innstillinger** i menyen og velg [Produsentansvar](/admin/{store}/settings/producer-responsibility) under Salg. Under
**Legg til en registrering**:

1. Velg **Ordning** og **Land**.
2. Under **I dette landet** velger du **Vi er registrert**.
3. Skriv inn **Registreringsnummer**, og under **Registrert hos** myndigheten eller returselskapet som ga det.
4. Oppgi dagen under **Gyldig fra**, og den siste dagen under **Gyldig til (valgfritt)** hvis den slutter.
5. Trykk **Lagre registreringen**.

Trengs det ingen registrering i et land, velger du **Det trengs ingen registrering her** i stedet, og skriver hvorfor under **Hvorfor
det ikke trengs**: for eksempel at det ikke finnes noen ordning for dette i landet, eller at du er under terskelen. Sjekk med myndigheten
først. Begrunnelsen vises aldri for kundene.

Når en registrering fornyes, legger du til den nye med egne datoer; den gamle blir stående som dokumentasjon.

## Hva siden viser

- **Selges ikke nå**: hver ordning og hvert land uten noe gyldig i dag, produktene som holdes tilbake, og **Legg til registreringen** ved
  siden av. Du kan også fjerne avkrysningen for ordningen på produktet, hvis det ikke hører under den.
- **Registreringer**: hver med nummer, myndighet, datoer og status: *Gyldig*, *Ikke begynt* eller *Utløpt*. Trykk **Endre** eller
  **Fjern** for å endre en.

En registrering som utløper innen 30 dager uten noen etter seg, viser dagen den utløper og dagen salget stopper, hvis ingen ny
registrering følger.

> [!WARNING]
> Fjerner du en registrering, er det ingenting igjen registrert for den ordningen og det landet, så produktene holdes tilbake der igjen.

## Hva kundene ser

- Der et produkt holdes tilbake, står det på produktsiden at det ikke selges i dette landet for øyeblikket, i stedet for kjøpsknappen.
  Det kan ikke legges i handlekurven, og kassen avviser det.
- Dagene følger butikkens tidssone: en registrering dekker sin siste dag, og salget stopper dagen etter. En som ikke har begynt, holder
  salget tilbake til første dag.

## Flere valg

### Vise nummeret på produktsidene

Kryss av for **Vis nummeret på produktsidene i dette landet**, så vises nummeret under produktets sikkerhetsinformasjon mens det gjelder.
Det er krysset av fra start der Kaizena Flow vet at landet ber om nummeret i tilbud; sjekk hva som gjelder for deg.

### Greit å vite

- Nummeret skrives ikke på fakturaene ennå. Må du vise det der, legger du det i **Merknad på hvert dokument** under Innstillinger,
  [Fakturering](/admin/{store}/settings/invoices).
- En kopi av butikken tar ikke med noen registrering: hver butikk legger inn sine egne.
- En demobutikk holdes aldri tilbake; produktene dens under en ordning står i stedet under **Ingen registrering lagt inn**.
- KI-assistenten kan lese registreringene dine og legge til en, som alltid venter på ditt ja.
