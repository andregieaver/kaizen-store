import { workText } from "@/lib/work-text";

import { InvoiceTotalsParts } from "./invoice-totals-view";

/**
 * An invoice's totals for a server component (the issued page): `InvoiceTotalsParts` with the request's Work words.
 * The editor, a client part, draws `InvoiceTotalsParts` itself with the words it was handed, so no client part
 * imports `work-text` and its catalogue.
 */
export function InvoiceTotalsView(props: Omit<Parameters<typeof InvoiceTotalsParts>[0], "words">) {
  return <InvoiceTotalsParts {...props} words={workText().invoiceTotals} />;
}
