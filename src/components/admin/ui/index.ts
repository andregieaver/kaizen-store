/** The admin's components (docs/admin-style.md section 5), written in the colour roles so every scheme draws them. */
export { Button, ButtonLink, buttonClass, BUTTON_KINDS, BUTTON_SIZES } from "./button";
export { Chip, TrendChip, CountBadge, chipClass, dotClass } from "./chip";
export { Card, KpiTile, CARD_CLASS } from "./card";
export { MiniBar, ShareBar, ScoreBar, fillWidth } from "./bars";
export { InsightPanel } from "./insight";
export { List, ListRow, RowActions, RowAmount, RowDate, RowFact, RowId, RowLead, RowText } from "./list";
export { PageHeader } from "./page-header";
// `FocusHeading` is read from its file by the pages before sign-in, which take nothing from this index (D873).
export { FocusFrame } from "./focus-frame";
export { AdminLink, type AdminLinkProps } from "./link";
// The kit of code review step 1.12 (D818): fields, the empty state, a list's pager and search. Its client part, `ConfirmButton`, is
// imported from "./confirm-button" itself, never through here: this index is reached by the server code of nearly every admin route,
// and each client module it names is in all their first scripts. Until D873 it reached the storefront's too, through the AI manager's
// shipping tool; `ui.test.ts` now holds every route outside the admin off it, `import()` followed. `TextArea`, `fieldClass()` and
// `pageAddress()` are read from their files by the client parts that use them.
export { Field, TextInput, Select } from "./field";
export { EmptyState } from "./empty-state";
export { Pager } from "./pager";
export { ListSearch } from "./list-search";
