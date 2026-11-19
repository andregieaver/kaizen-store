-- Bloat review step 3.6 (and step 3.7's two PDF indexes): partial indexes written with the reading statements' own predicates
-- (einvoice-sending.ts candidates(), invoice-notices.ts, invoice-issue.ts, invoice-pdf.ts and document-pdf-ask.ts), so the document
-- jobs' checks become index probes. None of these tables is on the hot list: plain builds.
create index if not exists invoices_issued_at_idx on commerce.invoices (issued_at);
--> statement-breakpoint
create index if not exists credit_notes_issued_at_idx on commerce.credit_notes (issued_at);
--> statement-breakpoint
create index if not exists invoices_business_issued_idx on commerce.invoices (issued_on) where (snapshot -> 'buyer' ->> 'type') = 'business';
--> statement-breakpoint
create index if not exists credit_notes_business_issued_idx on commerce.credit_notes (issued_on) where (snapshot -> 'buyer' ->> 'type') = 'business';
--> statement-breakpoint
create index if not exists work_invoices_business_issued_idx on commerce.work_invoices (issued_on) where status <> 'draft' and not imported and (buyer ->> 'business')::boolean is true;
--> statement-breakpoint
create index if not exists work_credit_notes_business_issued_idx on commerce.work_credit_notes (issued_on) where (buyer ->> 'business')::boolean is true;
--> statement-breakpoint
create index if not exists order_events_invoice_failed_idx on commerce.order_events (created_at) where type = 'invoice.failed';
--> statement-breakpoint
create index if not exists order_edits_documents_waiting_idx on commerce.order_edits (store_id) where status = 'applied' and documents = 'waiting';
--> statement-breakpoint
create index if not exists invoices_pdf_waiting_idx on commerce.invoices (issued_at) where pdf_path is null and anonymised_at is null;
--> statement-breakpoint
create index if not exists credit_notes_pdf_waiting_idx on commerce.credit_notes (issued_at) where pdf_path is null and anonymised_at is null;
