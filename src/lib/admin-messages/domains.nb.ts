import type { DomainsMessages } from "./domains.en";

/** Domener-siden på norsk (D312, D313). `{name}` er navnet på et språk. */
export const domainsNb: DomainsMessages = {
  forOneLanguage: "Bruk for ett språk",
  language: "Språk",
  everyLanguage: "Alle språk: leder til adressen din",
  languageOption: "{name}: butikken din på {name} her",
  activeInLanguage: "Aktiv: butikken din på {name}",
  forLanguage: "For {name}",
  explain:
    "Et språks eget domene viser butikken din på det språket, uten språket i adressene. Hvert domene har sin egen handlekurv, innlogging og sine egne valg for informasjonskapsler, fordi nettlesere holder dem per nettsted.",
  save: "Lagre",
  address: "Butikkens adresse",
  leadsThere: "{host} fører dit også",
  deploying: "Domenene dine er endret. Kaizena Flow legger endringen ut, noe som tar noen minutter; siden oppdaterer seg selv.",
  useHost: "Bruk {host} som adresse i stedet",
  ownDomains: "Dine egne domener",
  ownDomainsNote:
    "Bruk et domene du eier, som butikk.example.no eller example.no. Legg det til her, og lag deretter DNS-postene som vises, hos selskapet der du styrer domenets DNS. Når de er på plass, blir domenet butikkens adresse, med sertifikat for https, og de andre adressene dine fører dit. Opptil {max} domener.",
  notConfigured: "Egne domener er ikke satt opp på Kaizena Flow ennå.",
  domain: "Domene",
  add: "Legg til domene",
  ownerOnly: "Bare en eier kan legge til domener.",
  yourAddress: "Adressen din",
  activeLeads: "Aktivt: fører til adressen din",
  waitingDns: "Venter på DNS",
  createRecords:
    "Lag disse postene hos DNS-leverandøren din, og fjern andre A-, AAAA- eller CNAME-poster på samme navn. Leverandører som legger til domenet selv, vil bare ha den første delen av navnet",
  like: ", som ",
  type: "Type",
  name: "Navn",
  value: "Verdi",
  found: "Funnet",
  yes: "Ja",
  notYet: "Ikke ennå",
  lastChecked: "Sist sjekket {date}. ",
  checkedAgain: "Sjekkes på nytt hver gang du åpner siden; det kan ta opptil noen timer før DNS-endringer vises.",
  checkNow: "Sjekk nå",
  makeAddress: "Gjør dette til adressen",
  remove: "Fjern",
};
