/** The admin's components (docs/admin-style.md section 5), written in the colour roles so every scheme draws them. */
export { Button, ButtonLink, buttonClass, BUTTON_KINDS, BUTTON_SIZES } from "./button";
export { Chip, TrendChip, CountBadge, chipClass, dotClass } from "./chip";
export { Card, KpiTile, CARD_CLASS } from "./card";
export { MiniBar, ShareBar, ScoreBar, fillWidth } from "./bars";
export { InsightPanel } from "./insight";
export { List, ListRow, RowActions, RowAmount, RowDate, RowFact, RowId, RowLead, RowText } from "./list";
export { PageHeader } from "./page-header";
export { FocusFrame, FocusHeading } from "./focus-frame";
export { AdminLink, type AdminLinkProps } from "./link";
// The kit of code review step 1.12 (D818): fields, the empty state, a list's pager and search. Its client part, `ConfirmButton`, is
// imported from "./confirm-button" itself, never through here: this index is reached by the server code of every route (the storefront's
// too), and each client module it names is in every route's first scripts. Only the type is named here.
export { Field, TextInput, Select, TextArea, fieldClass, type FieldControl } from "./field";
export { EmptyState } from "./empty-state";
export type { ConfirmButtonProps } from "./confirm-button";
export { Pager, pageAddress, type PagerWords } from "./pager";
export { ListSearch } from "./list-search";
