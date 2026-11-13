-- Chat widgets on owners' own websites (D581): private tables, as every table of the commerce schema, reached only by the server.
alter table commerce.support_widgets enable row level security;
--> statement-breakpoint
alter table commerce.support_widget_sites enable row level security;
