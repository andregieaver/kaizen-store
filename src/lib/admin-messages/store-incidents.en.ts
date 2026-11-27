/** The words of the card that tells a store's owner about problems Kaizena Flow saw on their store (D895 IA-18). */
export const storeIncidentsEn = {
  title: "Problems we noticed",
  lead: "Kaizena Flow saw these on your store and handles them. You don't need to do anything.",
  areas: {
    store: "Your store's pages",
    admin: "Your admin",
    background: "A background task",
    connection: "A connection to another service",
    other: "Your store",
  },
  fixing: "We're fixing it",
  watching: "Fixed {date}, and we're watching it",
  fixed: "Fixed {date}",
  seen: "First seen {date}",
  times: "{n} times",
};

export type StoreIncidentsMessages = typeof storeIncidentsEn;
