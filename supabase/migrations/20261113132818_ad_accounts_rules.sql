-- Ad accounts connected for their budgets (D585): a private table, as every table of the commerce schema, reached only by the server.
alter table commerce.ad_accounts enable row level security;
