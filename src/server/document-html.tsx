import "server-only";

import { CONTRACT_CSS, ContractAuditView, ContractDocumentView, type ContractAudit } from "@/components/documents/contract-document-view";
import { OrderDocumentView } from "@/components/documents/order-document-view";
import { DOCUMENT_CSS } from "@/components/work/invoice-document";
import type { ContractSnapshot } from "@/lib/contract-fields";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";
import { staticMarkup } from "@/lib/static-markup";

/**
 * The views are written out by `staticMarkup()` (`src/lib/static-markup.ts`), not `react-dom/server`: Next refuses that module in a route's
 * own code, and loading it from disk at run time needed files a Vercel function did not carry (a contract could not be sent, 19 November
 * 2026). The views have no hook, so the server layer's elements write the same; the views' tests hold the output to React's.
 */
const renderer = () => staticMarkup;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * A document as one HTML page for the PDF (D159, `docs/wave-1b-invoices.md` 4.9): the same `OrderDocumentView` the hosted and print pages
 * draw, from the snapshot alone, in a minimal shell with the document's own styles. The page has no script, no font, no picture and no
 * link to anything outside it, so the renderer can refuse every request.
 */
export function documentHtml(snapshot: OrderInvoiceSnapshot | CreditNoteSnapshot): string {
  const body = renderer()(<OrderDocumentView snapshot={snapshot} />);
  return `<!doctype html><html lang="${escapeHtml(snapshot.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(snapshot.number)}</title><style>${DOCUMENT_CSS}</style></head><body>${body}</body></html>`;
}

/** A contract as one HTML page for its PDF (D695): `ContractDocumentView` from the snapshot alone, in the same closed shell as a document's. */
export function contractHtml(snapshot: ContractSnapshot): string {
  const body = renderer()(<ContractDocumentView snapshot={snapshot} />);
  return `<!doctype html><html lang="${escapeHtml(snapshot.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(snapshot.title)}</title><style>${CONTRACT_CSS}</style></head><body>${body}</body></html>`;
}

/** A contract's signing record as one HTML page for the page added to its signed PDF (D695 step 3). */
export function contractAuditHtml(audit: ContractAudit): string {
  const body = renderer()(<ContractAuditView audit={audit} />);
  return `<!doctype html><html lang="${escapeHtml(audit.language)}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(audit.title)}</title><style>${CONTRACT_CSS}</style></head><body>${body}</body></html>`;
}
