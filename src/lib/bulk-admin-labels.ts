/**
 * Every word the bulk editor gives a person, in English (D312 A5, bloat review step 2.50): beside `bulk-admin.ts`, which re-exports it for its
 * functions, so the admin's `products` catalogue takes it from here and imports no code. Imports nothing but types.
 */

const ACTIONS = {
  status: "Set status",
  archive: "Archive",
  unarchive: "Unarchive",
  terms_add: "Add to a category or tag",
  terms_remove: "Remove from a category or tag",
  price: "Change price",
  stock: "Set stock",
  grid: "Edit in a grid",
  undo: "Undo",
  sell_in: "Sell in",
  stop_selling_in: "Stop selling in",
  manufacturer: "Set the manufacturer",
};

/**
 * Every word this module gives a person, in English (D312 A5): the admin's `products` catalogue carries them in each language, and each
 * function takes them as its last argument, English unless given.
 */
export const BULK_WORDS = {
  actions: ACTIONS,
  chooseTerm: "Choose at least one category or tag.",
  writeStock: "Write a stock figure such as 12, or a change such as +5 or -3.",
  chooseMarket: "Choose at least one market.",
  chooseCountry: "Choose at least one country.",
  writePercent: "Write a percentage, such as -10 or 5.5.",
  writeAmounts: "Write an amount for {markets}: an amount is never applied across currencies.",
  chooseProduct: "Choose at least one product.",
  gridMax: "The grid takes at most {max} products; you chose {count}.",
  capped: "{matching} products match; a bulk action takes the first {max}. Narrow the list to take the rest.",
  none: "none",
  categories: { one: "{n} category", many: "{n} categories" },
  tags: { one: "{n} tag", many: "{n} tags" },
  terms: "{categories}, {tags}",
  archived: "archived",
  notArchived: "not archived",
  soldEverywhere: "sold in every country",
  notSoldIn: "not sold in {list}",
  price: "Price ({market})",
  fields: { status: "Status", archived: "Archived", terms: "Categories and tags", stock: "Stock", cost: "Cost", sku: "SKU", availability: "Where it is sold" },
};
