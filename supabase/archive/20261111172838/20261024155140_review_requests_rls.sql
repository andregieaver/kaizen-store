-- Review request emails (D301 G3, docs/wave-5-marketing.md 9.6): written only by src/server/review-requests.ts, never through the Data API.
ALTER TABLE commerce.review_requests ENABLE ROW LEVEL SECURITY;
