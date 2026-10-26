-- Email into the support desk (D332, docs/support.md step 16): written only by src/server/support-inbound.ts, never through the Data API.
ALTER TABLE commerce.support_inbound_emails ENABLE ROW LEVEL SECURITY;
