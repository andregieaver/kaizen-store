import type { StoreIncidentsMessages } from "./store-incidents.en";

/** Norwegian words of the card about problems Kaizena Flow saw on a store (D895 IA-18). */
export const storeIncidentsNb: StoreIncidentsMessages = {
  title: "Problemer vi la merke til",
  lead: "Kaizena Flow så disse i butikken din og tar seg av dem. Du trenger ikke gjøre noe.",
  areas: {
    store: "Butikkens sider",
    admin: "Adminen din",
    background: "En bakgrunnsoppgave",
    connection: "En kobling til en annen tjeneste",
    other: "Butikken din",
  },
  fixing: "Vi fikser det",
  watching: "Fikset {date}, og vi følger med",
  fixed: "Fikset {date}",
  seen: "Først sett {date}",
  times: "{n} ganger",
};
