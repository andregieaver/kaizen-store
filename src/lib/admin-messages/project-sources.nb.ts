import type { ProjectSourcesMessages } from "./project-sources.en";

/** Oppgaver fra en ordre, en retur, en anmeldelse eller en samtale (D904 P8.3a), på norsk bokmål, skrevet for hånd. */
export const projectSourcesNb: ProjectSourcesMessages = {
  heading: "Oppgaver",
  none: "Ingen oppgaver ennå.",
  make: "Lag en oppgave",
  title: "Oppgave",
  list: "Liste",
  followUps: "Oppfølging",
  newList: "{name} (ny liste)",
  save: "Legg til oppgave",
  cancel: "Avbryt",
  inList: "I {list}",
  tick: "Kryss av {title}",
  suggested: {
    order: "Følg opp ordre {label}",
    return: "Følg opp retur {label}",
    review: "Svar på anmeldelsen fra {label}",
    conversation: "Følg opp samtalen med {label}",
  },
  added: "Oppgaven er lagt i {list}.",
  openLists: "Se sjekklistene",
};
