-- Card wallets, the purchases approved for the AI and their charges (D599): private tables, as every table of the commerce schema, reached
-- only by the server.
alter table commerce.card_wallets enable row level security;
--> statement-breakpoint
alter table commerce.agent_purchases enable row level security;
--> statement-breakpoint
alter table commerce.agent_purchase_charges enable row level security;
