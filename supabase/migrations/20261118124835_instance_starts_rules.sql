-- Cold starts (bloat review step 1.16): row level security on, as on every commerce table; the server reaches it, nobody through the Data API.
alter table commerce.instance_starts enable row level security;
