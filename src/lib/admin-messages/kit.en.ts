/**
 * The admin kit's own words (code review step 1.12, D818, `src/components/admin/ui`), in English: a list's pager, its search box and an empty list's way back.
 * `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`): `Pager` and `ListSearch` are drawn
 * on the server and take them as props (`KIT_WORDS[lang].pager`), so they are in no admin screen's first scripts. A list with words
 * of its own ("Next 50 orders") passes those in their place. `ConfirmButton`'s *Cancel* is `common.form.cancel`, read in the browser.
 */
export const kitEn = {
  /** `Pager`: how many are shown of how many, and the pages before and after. */
  pager: {
    label: "Pages",
    shownOf: "{shown} of {total}",
    previous: "Previous {n}",
    next: "Next {n}",
    first: "Back to the first page",
  },
  /** `ListSearch`: the search box over a list, a GET form whose words stay in the address. */
  search: {
    label: "Search",
    button: "Search",
  },
  /** `EmptyState` (code review 2.9, D845): the way back from a search or filter that matched nothing, to the list without its query. */
  empty: {
    clearFilters: "Clear filters",
  },
};

export type KitMessages = typeof kitEn;
