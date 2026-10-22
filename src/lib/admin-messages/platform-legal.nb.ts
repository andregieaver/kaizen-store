import type { PlatformLegalMessages } from "./platform-legal.en";

export const platformLegalNb: PlatformLegalMessages = {
  title: "Juridiske sider",
  description:
    "Kaizena Flows vilkår for bruk, personvernerklæring og databehandleravtale, skrevet på engelsk og norsk og publisert med en gang. De fylles ut fra opplysningene om virksomheten under Topp og bunn.",
  kinds: { terms: "Vilkår for bruk", privacy: "Personvernerklæring", dpa: "Databehandleravtale" },
  states: { none: "Ikke skrevet", empty: "Publisert uten tekst", written: "Publisert" },
  missing: "Disse opplysningene om virksomheten er ikke fylt ut, så sidene viser en plassholder for dem: {list}. Fyll dem ut under Topp og bunn, og skriv sidene på nytt.",
  facts: { legalName: "selskapsnavn", organisationNumber: "organisasjonsnummer", postalAddress: "adresse", contactEmail: "e-postadresse for kontakt" },
  businessLink: "Opplysninger om virksomheten",
  overwrite: "Skriv over denne siden på nytt",
  write: "Skriv de juridiske sidene",
  outcomes: { made: "laget og publisert", written: "skrevet og publisert", kept: "beholdt som den er", failed: "kunne ikke skrives" },
  done: "Juridiske sider: {list}.",
};
