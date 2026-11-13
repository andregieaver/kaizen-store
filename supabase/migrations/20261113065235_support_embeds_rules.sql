-- The chat on an owner's own site (D581): a private table, as every table of the commerce schema, reached only by the server.
alter table commerce.support_embeds enable row level security;
