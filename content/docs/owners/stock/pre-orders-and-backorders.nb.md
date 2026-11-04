---
title: Forhåndsbestilling og restordre
summary: Fortsett å selge en variant når den er utsolgt, eller ta imot forhåndsbestillinger før en lanseringsdato, og send bestillingene når varene kommer.
track: owners
section: stock
kind: how-to
areas: [stock, products, orders]
features: [shop]
plans: []
admin: /admin/{store}/products/{productId}
order: 20
checked: 2026-11-04
sources: [D172, D298, D396]
---

## To måter å selge det du ikke har ennå

- **Restordre.** Varianten selges videre når den er utsolgt, og kundene får vite hvor mange dager det tar før den ventes sendt.
- **Forhåndsbestilling.** Fram til en lanseringsdato selges hver enhet som forhåndsbestilling, også om du har noen på lager, og
  kundene ser datoen den ventes sendt fra.

Begge deler gjelder varer du sender, ikke nedlastinger eller bookinger. Begge betales i sin helhet i kassen, som enhver annen
bestilling: det er ikke noe depositum.

## Fortsett å selge når varen er utsolgt

1. Åpne produktet. Under **Pris og lager** åpner du **Lagerregler for …** under varianten.
2. Kryss av for **Fortsett å selge når den er utsolgt**.
3. Fyll inn **Ventes sendt innen (dager)**: fra 1 til 90 dager, og det vises alltid for kundene.
4. Trykk **Lagre**.

Et produkt med flere varianter som sendes, har også **Fortsett å selge alle varianter når de er utsolgt**, med ett antall dager for
alle. Under [Lager](/admin/{store}/inventory) kan du gjøre det samme for mange varianter samtidig: kryss dem av, fyll inn **Forventes
sendt innen (dager)** og trykk **Selg videre når utsolgt**, eller **Slutt å selge når utsolgt** for å slå det av.

> [!IMPORTANT]
> Velg et antall dager du kan holde. Kan dagene og transporten til sammen bli mer enn 30 dager, minner redigeringen deg på at de 30
> dagene løper til varene er levert, ikke til de er sendt. En lengre tid må sies tydelig, siden kunden godtar den ved å bestille.

### Dette ser kundene

- På produktsiden: *På restordre: forventes sendt innen 7 dager*.
- I handlekurven: *2 på restordre: forventes sendt innen 7 dager*.
- På bestillingssiden og i bekreftelsen: *2 av 3 på restordre: forventes sendt innen 7 dager etter din bestilling*.

Bare enhetene ut over det du har, er på restordre. Dagene tas vare på i bestillingen slik de var da den ble lagt inn.

## Ta imot forhåndsbestillinger

1. Under **Lagerregler for …** krysser du av for **Fortsett å selge når den er utsolgt** og fyller inn dagene, som over.
2. Velg lanseringsdatoen under **Forhåndsbestilling til**.
3. Trykk **Lagre**.

Fram til den datoen ser kundene *Forhåndsbestilling: forventes sendt fra* datoen på produktsiden, og datoen vises også på
produktkortene (den tidligste datoen blant produktets varianter), i handlekurven, i kassen, på bestillings- og bekreftelsessiden,
under Min konto og i bekreftelsen på e-post. Produktfeedene dine merker den som forhåndsbestilling med datoen, og chatassistenten sier
at den kan forhåndsbestilles.

Fra datoen av selges varianten som enhver variant som selges videre: fra lageret så lenge det er noe der, deretter på restordre med
dagene du har satt. Fjern krysset for **Fortsett å selge når den er utsolgt** for å slutte å selge den ved null; da fjernes også
datoen.

> [!NOTE]
> Produktkortene i lister kan si *forhåndsbestilling* i opptil en dag etter datoen. Selve produktsiden er riktig med en gang.

Lanseringsdatoen settes bare i produktredigeringen: produktfilen, Lager-siden og KI-assistenten setter den ikke.

## Når varene kommer

Ingenting skjer av seg selv når varene kommer inn. Gjør det i denne rekkefølgen:

1. **Ta imot varene.** Tell inn innkjøpsordren, eller sett tallet under Lager med begrunnelsen *Mottatt*. Se
   [Lager og lagersteder](/docs/owners/stock/stock-and-locations). Lager som er solgt på restordre, står som **Under null** til da.
2. **Finn bestillingene som har ventet.** Under [Bestillinger](/admin/{store}/orders) viser visningen **Venter på varer** betalte
   bestillinger med enheter solgt på restordre. Bestillingssiden sier *Venter på varer*, hvor mange enheter som ble solgt på
   restordre, og lenker til Lager.
3. **Send dem** som vanlig. Se [Send bestillinger](/docs/owners/orders/send-orders).

Forhåndsbestillinger venter for seg: en bestilling der de eneste enhetene som gjenstår å sende, er forhåndsbestillinger før datoen,
står ikke under **Skal sendes**. Filtrer **Forsendelse** på **Forhåndsbestillinger som venter** for å se dem; hver har et merke med
den tidligste datoen, og hver linje på bestillingssiden sier når den sendes fra. Etter datoen står bestillingen under **Skal sendes**.

**Skyldt** under Lager teller enhetene som er solgt på restordre, til bestillingene deres er sendt.

## Flere valg

- **Utsolgt og ikke til salgs?** Når en variant slutter å selge ved null, kan kundene be om en e-post når den er tilbake, så snart du
  slår på e-posten **På lager igjen**. Se [E-postmarkedsføring](/docs/owners/marketing/email-marketing).
- **Flere lagersteder.** Det som selges på restordre, legges på det første lagerstedet som fører varianten.
- **Lagerfilen** under Lager kan sette `stock_policy` (`deny` eller `continue`) og `backorder_days` for mange varianter samtidig.
- **Forhåndsbestilling og restordre er en del av nettbutikken**, som alle nye butikker starter med. Den slås av og på under
  Innstillinger, Funksjoner.
