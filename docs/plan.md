# Build the EU checkout before the AI agent

> **Where the build differs from this plan (updated 23 September 2026).** The Supabase project was created in **eu-west-1 (Ireland)**, not eu-central-1, so Vercel functions are pinned to **`dub1` (Dublin)** instead of `fra1` to sit next to the database. Both are in the EU. The skeleton is a single Next.js app rather than a Turborepo monorepo; split it into packages when a second deployable (for example the MCP server) needs to share domain code.

**Bottom line:** A high-converting, AI-native EU store in September 2026 is mostly a well-built conventional store, with AI added only where it is grounded in live data. The best evidence for conversion is still about the basics: showing the full cost early, guest checkout, fast pages, the shopper's own language, pickup points, and above all local payment methods. In Stripe's randomised holdback tests, adding iDEAL lifted conversion 39% and adding BLIK lifted it 46%. The AI features with the lowest risk and widest reach are hybrid search and content generated offline, because both return only real products. A conversational assistant is worth building, but every public "chat users convert 2–4x more" figure compares self-selected users with non-users. It should launch behind a randomised holdout and has to earn its place.

The agent protocols (ACP, UCP, Stripe's Agentic Commerce Suite) can be implemented directly today. As of September 2026, though, every in-assistant checkout programme found is US-only or gated. When Walmart ran checkout inside ChatGPT, it converted at about a third of the rate of click-outs. For an EU merchant the right move now is product feeds, a read-only MCP server and a checkout model shaped like UCP, not in-chat checkout.

The recommended stack is:
- Next.js 16.3 on Vercel, pinned to Frankfurt (`fra1`)
- Supabase Postgres in eu-central-1, with hybrid search inside the database
- AI SDK 7 through Vercel AI Gateway with EU inference pinned
- Stripe Checkout Sessions with the Payment Element and Stripe Tax

The commerce core should be built lean. Whether to borrow Medusa modules for promotions, returns and order edits is an explicit decision in Phase 0.

EU law now shapes the data model directly. The withdrawal button has applied since 19 June 2026 and AI Act Art. 50 chatbot disclosure since 2 August 2026. The ban on generic green claims applies from 27 September 2026, and the Omnibus 30-day price rule, the GPSR listing fields and the European Accessibility Act already apply. The biggest undecided input is where the seller is established and where it ships from. That choice decides the whole VAT and customs architecture, including a €3-per-item customs duty on non-EU parcels that has applied since 1 July 2026.

*Evidence labels used in this report: **[IND]** independent measurement, academic study or court ruling. **[RCT-VEN]** a randomised test run by a vendor. **[RET]** retailer self-report. **[VEN]** vendor claim or platform aggregate. **[SEC]** secondary or aggregator source that could not be verified. **[LEGAL]** a researcher's reading of EU legal text, to be checked by counsel. **[EST]** an engineering or statistical estimate from the research notes, not a measurement.*

## Conversion is won by five unglamorous levers that AI cannot replace

The baseline is sobering. Contentsquare's 2026 panel covers 99 billion sessions across more than 6,000 sites. In it, returning visitors convert at **2.9%** and new visitors at **1.7%**. Mobile carries **69.9% of traffic**, yet desktop converts **74% better** [VEN, largest panel] ([Contentsquare](https://contentsquare.com/guides/digital-experience-benchmark/conversions/)). Baymard's meta-average cart abandonment rate is **70.22%** across 50 studies. Its survey ranks the fixable causes as extra costs (40%), slow delivery (20%), distrust of the site with card details (19%), forced account creation (18%) and an overlong checkout (17%) ([Baymard](https://baymard.com/lists/cart-abandonment-rate)). The survey is US-only, but the causes line up with EU evidence. Baymard's checkout benchmark covers leading US and EU sites. It finds **62%** don't make guest checkout prominent, **48%** show a delivery speed but not a date, and **94%** lack adaptive error messages ([Baymard Checkout UX](https://baymard.com/blog/current-state-of-checkout-ux)). Baymard's often-quoted **35% "recoverable" lift** from better checkout design comes from a vendor that sells the research. It assumes a jump from current practice straight to best practice, so treat it as a ceiling rather than a forecast.

Payments are the EU-specific lever with the best evidence. Stripe ran holdback experiments across more than 50 methods. Showing at least one relevant method beyond cards raised conversion by **7.4%** and revenue by **12%** on average. Individual results were **iDEAL +39%**, **BLIK +46%**, **Apple Pay +22.3%** and **SEPA Direct Debit +12%** [RCT-VEN] ([Stripe](https://stripe.com/blog/testing-the-conversion-impact-of-50-plus-global-payment-methods)). The European payment mix is fragmented:
- **Euro area overall:** cards are only **48%** of online payments ([ECB SPACE 2024](https://www.ecb.europa.eu/stats/ecb_surveys/space/html/ecb.space2024~19d46f0f17.en.html)).
- **Germany:** the top 1,000 shops take 28.7% of revenue via PayPal and 26.1% via invoice (Rechnung) [IND trade study] ([EHI via IT Finanzmagazin](https://www.it-finanzmagazin.de/online-payment-rechnungskauf-und-paypal-weiter-dominierend-laut-ehi-studie-online-payment-2026-244098/)). This conflicts with a secondary claim of 52% for PayPal that likely counts differently ([gr4vy](https://gr4vy.com/posts/payment-methods-by-country-2026-what-dominates-each-market-and-how-to-accept-them/)).
- **Netherlands:** iDEAL is dominant. Share estimates range from about 66% to 92% depending on the source.
- **Wero:** it is replacing iDEAL through a co-branding transition with a target completion of end-2027 ([Wikipedia: Wero](https://en.wikipedia.org/wiki/Wero_(payment))). Its French and Belgian e-commerce launch dates conflict between sources ([Banking.Vision](https://banking.vision/en/development-wero-2025-2026/)).

**The practical conclusion:** payment methods should be per-country configuration served through one PSP, not a single global list.

Four other levers complete the baseline:
- **Speed.** Deloitte's Google-commissioned study found a **0.1 s** mobile speed gain went with **+8.4%** retail conversion. It is observational and sponsor-funded ([web.dev](https://web.dev/case-studies/milliseconds-make-millions)), so plan for low single-digit gains. The Core Web Vitals "good" thresholds (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile) are the right exit criteria ([web.dev](https://web.dev/articles/vitals)).
- **Language.** CSA Research surveyed 8,709 consumers in 29 countries. 76% prefer product information in their own language, and 40% never buy from sites in other languages. The survey is from 2020 ([CSA Research](https://csa-research.com/l/media/Consumers-Prefer-their-Own-Language)).
- **Delivery options.** 77% of Polish online shoppers chose lockers as their primary delivery in 2025. Out-of-home delivery takes 58% of B2C parcels in the Nordics and 49% in Benelux ([Cross-Border Magazine](https://cross-border-magazine.com/parcel-lockers-in-europe-2025/); [ShippyPro](https://www.shippypro.com/blog/en/out-of-home-delivery-market-study)). About 60% of cross-border shoppers name returns as their biggest barrier [SEC] ([nShift](https://nshift.com/blog/cross-border-ecommerce-post-checkout-experience)).
- **Reviews.** Spiegel's finding is old (2017) but still the best available. Five reviews gave **+270%** purchase likelihood over none, and purchase likelihood peaks at 4.0–4.7 stars ([Spiegel Research Center](https://spiegel.medill.northwestern.edu/how-online-reviews-influence-sales/)).

Retention flows add durable revenue. Klaviyo's abandoned-cart flows average a 3.33% placed-order rate [VEN] ([Klaviyo](https://www.klaviyo.com/blog/abandoned-cart-benchmarks)). A later secondary figure of 2.68% conflicts with this, but both show the flow is worth building early.

**How the product category changes the plan.** The category is still open, and it changes more than the marketing:

| Area | How category changes the plan |
|---|---|
| Baseline conversion | Aggregators quote 4.9–6.2% for food and beverage and under 1% for luxury [SEC] ([Red Stag](https://redstagfulfillment.com/average-conversion-rate-for-ecommerce/)). This changes how much traffic an experiment needs. |
| Reviews | The review lift is larger for higher-priced goods: +380% vs +190% for cheaper ones ([Spiegel](https://spiegel.medill.northwestern.edu/how-online-reviews-influence-sales/)). |
| VAT and unit pricing | Reduced VAT rates vary by category and country. Goods sold by quantity need a unit price per kg or litre [LEGAL] ([Price Indication Directive](https://eur-lex.europa.eu/eli/dir/1998/6/oj/eng)). |
| Withdrawal right | No statutory right exists for bespoke, perishable or unsealed hygiene goods. The withdrawal button and returns flow need per-line eligibility flags ([Greenberg Traurig](https://www.gtlaw.com/en/insights/2026/5/eu-consumer-law-new-withdrawal-button-requirements-for-online-contracts)). |
| Extended producer responsibility (EPR) | Electrical goods trigger WEEE authorised representatives in each member state of sale. Batteries add EPR under Reg. 2023/1542 [LEGAL] ([WEEE](https://eur-lex.europa.eu/eli/dir/2012/19/oj/eng); [Batteries](https://eur-lex.europa.eu/eli/reg/2023/1542/oj/eng)). Textiles, toys, cosmetics and food carry further rules not researched here. |
| Energy labels | Appliances need an EPREL registration number in the Merchant Center `certification` attribute ([Google](https://support.google.com/merchants/answer/13528839?hl=en)). |
| AI channels | OpenAI's feed programme excludes adult, age-restricted, weapons and prescription-medicine products ([OpenAI get-started](https://developers.openai.com/commerce/guides/get-started)). |
| Visual AI | Virtual try-on and fit AI only matter for apparel, eyewear or furniture. Zalando's fit AI is the credible data point: more than 8% fewer size-related returns [RET] ([Zalando FY2025](https://corporate.zalando.com/en/investor-relations/zalando-full-year-2025-results)). |

## AI earns its place in search and offline content, while assistant lift remains unproven

**The weight of evidence runs in the opposite direction to the hype.** The problem AI search solves is well documented and independent:
- 41% of sites fail common query types [IND] ([Baymard](https://baymard.com/blog/ecommerce-search-query-types)).
- 70% require the site's own product jargon ("hair dryer" vs "blow dryer") [IND] (same source).
- Search users are about 24% of visitors but generate about 44% of revenue [VEN] ([Hello Retail summarising Constructor](https://helloretail.com/en/blog/2026-02-24-ecommerce-search-statistics/)).

Hybrid search returns only real SKUs, touches far more sessions than a chat widget, and can be A/B-tested on search-to-cart rate. That makes it the first AI investment. Search-vendor lift figures (Constructor, Bloomreach, Algolia) are all vendor claims, and **no independent A/B study of semantic vs keyword search for small and mid-sized stores was found**.

The assistant evidence is loud but weak:

| Claim | Grade | Why it cannot be read as causal lift |
|---|---|---|
| Amazon Rufus ≈ **$12B** "incremental annualised sales" in 2025; users "60% more likely" to buy ([PPC Land](https://ppc.land/amazons-ai-shopping-assistant-drove-12-billion-in-sales-for-2025/); [Yahoo/Fortune](https://finance.yahoo.com/news/amazon-says-ai-shopping-assistant-152500992.html)) | [RET] | The attribution method is undisclosed; a 7-day rolling model is reported only by trade press. Amazon also has a motive to justify its AI capex. |
| Walmart Sparky users build baskets ~35% larger (other outlets say 40%) ([Modern Retail](https://www.modernretail.co/technology/walmart-says-ai-users-build-35-bigger-baskets-than-others/)) | [RET] | Compares users with non-users, and the reported figures conflict. |
| Zalando AI matchmaking: +13% add-to-bag ([Zalando](https://corporate.zalando.com/en/investor-relations/zalando-full-year-2025-results)) | [RET] | The most concrete retailer number, but from a platform with huge first-party data. |
| Assisted visitors convert at 9.84% vs 2.47% ([Alhena](https://alhena.ai/blog/psychology-ai-shopping-conversational-commerce/)); 12.3% vs 3.1% ([HelloRep](https://www.hellorep.ai/blog/the-future-of-ai-in-ecommerce-40-statistics-on-conversational-ai-agents-for-2025)) | [VEN] | Pure selection bias: people who open a chat are already high-intent. |
| Anthropic "Claude Commerce Agents" (2 Sep 2026): carts up to 35% larger, ~60% higher completion ([Claude blog](https://claude.com/blog/claude-for-commerce-agents)) | [VEN] | Vendor claim with no published method. |

Two more facts shrink expectations. Typical chat-widget engagement is **about 1% of visitors**, and around 6% with proactive prompts [VEN] ([Alhena](https://alhena.ai/blog/smart-nudges-proactive-ai-engagement-ecommerce/)). NN/g's usability work found that chat forces users into costly rounds of re-prompting [IND, 2023] ([Experientia summary](https://blog.experientia.com/nielsen-norman-group-on-the-user-experience-of-chatbots/)). Together these argue for putting AI into surfaces shoppers already use: the search bar, "ask about this product" on the product detail page (PDP), and guided finders. A floating widget alone is not enough.

The failure modes are well evidenced and independent:
- **Capability.** ShoppingBench found GPT-4.1 succeeds on **under 50%** of realistic multi-constraint shopping tasks ([arXiv 2508.04266](https://arxiv.org/html/2508.04266v1)).
- **Manipulation.** Microsoft's Magentic Marketplace showed agents are manipulable by prompt injection and fake social proof. They show a 10–30x first-proposal bias, and their quality degrades as they are shown more results ([arXiv 2510.25779](https://arxiv.org/abs/2510.25779)).
- **Liability.** *Moffatt v Air Canada* (2024) held the business liable for its chatbot's misstatements and rejected the argument that the bot was a separate entity. It is a persuasive precedent only, from a Canadian tribunal ([ABA](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/)).
- **Automation backlash.** Klarna reversed its heavy service automation after quality complaints ([CX Dive](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/)). Gartner's August 2026 survey found **87%** of customers demand access to a human [IND survey] ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2026-08-04-gartner-survey-finds-87-percent-of-customers-say-companies-using-genai-for-customer-service-must-provide-access-to-a-human-agent0)).

The earlier WordPress plugin work established grounding patterns that carry over unchanged to a from-scratch build:
- **Only cite what a tool returned.** The model may only reference product IDs and URLs that a tool call returned. Everything else is discarded, and answers flagged ungrounded become a refusal.
- **The model never states a price.** Product cards, prices, stock and delivery dates are rendered by the server from the database using the returned IDs.
- **Arithmetic happens outside the model.** Bundle totals, unit-price comparisons and free-shipping gaps are computed by a deterministic calculator that logs each calculation for audit.
- **Model output is rendered safely.** Output is shown as sanitised text or markdown, with no model-supplied HTML and no `javascript:` or `data:` links.
- **The assistant degrades gracefully.** If the main provider fails, fall back to a secondary EU-capable model, then to a keyword-search-only mode.

Every policy statement (withdrawal rights, the two-year legal guarantee, returns) must quote fixed policy text, never generated text. The legal guarantee comes from the Sale of Goods Directive [LEGAL] ([Directive 2019/771](https://eur-lex.europa.eu/eli/dir/2019/771/oj/eng)). The OWASP LLM Top 10 (2025) maps these patterns onto named risks ([OWASP GenAI](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)):
- **LLM01 (prompt injection):** reviews and supplier descriptions count as untrusted data.
- **LLM05 (improper output handling):** covered by safe rendering.
- **LLM06 (excessive agency):** tools are read-only by default, and add-to-cart takes only `variantId` and `qty`, then re-prices on the server.
- **LLM10 (unbounded consumption):** rate limits, a step cap and per-conversation token budgets.

**Offline AI content is the safest early win**, even though no conversion data exists for it. This covers attribute extraction and normalisation, translation, FAQ blocks, and review summaries drawn only from verified purchases. Amazon uses the same verified-purchase restriction as an anti-manipulation control ([GeekWire](https://www.geekwire.com/2023/amazon-rolls-out-ai-generated-summaries-of-customer-reviews/)). The content is human-approved, adds no runtime cost or latency, and cleans the product data that search, feeds and the assistant all depend on. For post-purchase questions, commercial per-resolution pricing gives a cost ceiling for a self-built bot: Intercom Fin charges $0.99 per resolution [VEN] ([Fin](https://fin.ai/learn/ai-customer-service-agent-pricing-comparison)). Virtual try-on has only vendor evidence, such as "+94% conversion" ([StyTrix](https://www.stytrix.com/blog/ai-virtual-try-on-reshaping-fashion-ecommerce-2026)). It should wait for the category decision and then be bought from a vendor, not built.

## Agent protocols are open to implement, but their EU distribution is still closed

The agent layer splits into specifications, which any merchant can implement, and distribution, which is gated. As of 23 September 2026 the gating runs against EU sellers.

| Channel / spec | Status (Sep 2026) | What an EU custom store can do now |
|---|---|---|
| **ACP** (OpenAI + Stripe) | Beta spec; latest stable version 2026-04-17 adds cart, feed, orders, auth and an MCP binding. Merchants implement five `/checkout_sessions` endpoints ([ACP repo](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol); [reference](https://www.agenticcommerce.dev/docs/reference/checkout)). | Keep the checkout model compatible. Feed "standard uploads default to US-only targeting" ([OpenAI feed spec](https://developers.openai.com/commerce/specs/feed)). The merchant programme is reported as US-only [SEC] ([Expanding Web](https://expandingweb.com/chatgpt-shopping-magento-us-eu)). |
| **ChatGPT checkout** | Instant Checkout was retired in March 2026 [SEC] ([Stellagent](https://stellagent.ai/insights/openai-shopping-agent-strategy-pivot)). ChatGPT apps recommend **external checkout on the merchant's domain**. The Payment Sheet is limited to "select marketplace partners (beta)" ([Apps SDK](https://developers.openai.com/apps-sdk/build/monetization)). | Be linked to, not transacted through. ChatGPT Ads reportedly opened to EEA businesses on 31 Aug 2026 [SEC] ([Lengow](https://www.lengow.com/get-to-know-more/how-to-get-ready-for-chatgpt-ads-in-europe/)). |
| **UCP** (Google-led, Apache 2.0) | Spec version 2026-08-25: `/.well-known/ucp` profile, REST/MCP/A2A transports, signed webhooks, OAuth identity linking ([ucp.dev](https://ucp.dev/specification/overview/)). Checkout eligibility covers the US, Canada and Australia (early access), with the UK later. **No EU date** ([Merchant Center Help](https://support.google.com/merchants/answer/16837055?hl=en); [PPC Land](https://ppc.land/google-expands-ucp-to-hotels-food-delivery-and-three-new-countries/)). | Merchant Center feeds, free listings and AI Mode *discovery*. Shape internal checkout like UCP; defer the endpoints. |
| **Stripe Agentic Commerce Suite (ACS)** | Available to sellers in many EEA countries plus CH, GB and NO. Offers catalogue CSV import (product feed daily; inventory and pricing about every 15 min), Dashboard agent connections and Shared Payment Tokens ([Stripe docs](https://docs.stripe.com/agentic-commerce/for-sellers)). **Status conflict:** earlier research called it GA, but Stripe's own Sessions 2026 post says "public preview", and the APIs carry `.preview` versions under "preview" seller terms ([Stripe Sessions 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026); [SPT docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=seller)). **Treat it as preview.** Which agents EU sellers can connect to, and any fees, are undisclosed. | The cheapest "agent-ready" route once on Stripe, but distribution is limited. |
| **Copilot Checkout, Perplexity Instant Buy, Amazon Buy for Me** | All US-only ([Microsoft](https://about.ads.microsoft.com/en/blog/post/january-2026/conversations-that-convert-copilot-checkout-and-brand-agents); [Perplexity](https://www.perplexity.ai/help-center/en/articles/12932923-instant-buy-buy-with-paypal)). | Discovery listings only. |
| **Klarna Agentic Product Protocol** | Open discovery feed: 100M+ products across 12 markets ([Klarna docs](https://docs.klarna.com/acquirer/klarna/other-products/klarna-search/klarna-agentic-product-protocol/)). | A candidate channel if Klarna is offered; onboarding terms unverified. |
| **Visa Trusted Agent Protocol (TAP) / Mastercard Agent Pay / Web Bot Auth** | Visa went live with agentic transactions with 30+ European issuers on 2 Jul 2026 ([Visa](https://www.visa.co.uk/about-visa/newsroom/press-releases.3457328.html)). All schemes converge on RFC 9421 signatures ([Visa TAP](https://github.com/visa/trusted-agent-protocol); [Cloudflare](https://blog.cloudflare.com/secure-agentic-commerce/)). Vercel verifies Web Bot Auth at the edge and exposes verified-bot identity through BotID ([Vercel](https://vercel.com/changelog/vercels-bot-verification-now-supports-web-bot-auth); [BotID](https://vercel.com/docs/botid/verified-bots)). | Little code needed. Don't CAPTCHA signed agents; allow verified bots on cart and checkout. |

**Two numbers show why in-chat checkout is premature.** Walmart's EVP said ChatGPT in-chat checkout converted at about **one-third** the rate of click-outs to Walmart.com [SEC] ([Stellagent](https://stellagent.ai/insights/openai-shopping-agent-strategy-pivot)). Meanwhile, AI-referred visits that land on the merchant's own site converted **60% better** than other traffic in US retail in July 2026 [IND panel, US] ([Digital Commerce 360 on Adobe](https://www.digitalcommerce360.com/2026/08/19/adobe-ai-referral-traffic-data-july-2026/)). That conflicts with Contentsquare's global panel, where AI-referred traffic converts at **1.3%** against 2.8% for paid search ([Contentsquare](https://contentsquare.com/guides/digital-experience-benchmark/conversions/)). The populations and definitions differ, and no EU retail AI-referral conversion benchmark exists. Volume is small either way. ChatGPT referrals were **0.32% of all website traffic** in May 2026, growing 42.7% month-on-month in the EU ([SE Ranking](https://seranking.com/blog/chatgpt-referral-traffic-may-2026/)).

Discoverability now runs mainly through feeds. Tracked ChatGPT product picks using feed retrieval reportedly rose to about 65% by September 2026 [SEC] ([Relevant Audience on Profound](https://www.relevantaudience.com/ecommerce-marketing/chatgpt-shopping-product-feeds-profound-research/)). A controlled Ahrefs test found **adding schema produced no significant AI-citation uplift** ([Ahrefs](https://ahrefs.com/blog/schema-ai-citations)). Schema is still needed for Google rich results and Merchant Center. Crawler policy should explicitly allow the search and user-triggered fetchers: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Googlebot and Bingbot. Blocking training tokens such as GPTBot, ClaudeBot or Google-Extended is a business choice with no documented effect on AI search inclusion ([OpenAI crawlers](https://developers.openai.com/api/docs/bots); [Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)). Prices must be server-rendered, because user-triggered fetchers read raw HTML.

## A lean TypeScript stack, pinned to Frankfurt, with the costly parts integrated

The research supports a single-language (TypeScript) monorepo on Vercel and Supabase, co-located in Frankfurt. The rule of thumb: integrate anything regulated or commoditised (payments, tax, auth, email, observability), and build the parts where the AI-native experience differentiates (catalogue, pricing, cart, checkout orchestration, search, agent tools). Versions below are the npm `latest` tags as of 23 September 2026.

| Layer | Recommended default | Build / integrate | Main alternative | Caveats |
|---|---|---|---|---|
| Frontend / runtime | **Next.js 16.3.6**, React 19.3, `cacheComponents` + `partialPrefetching`, root params for `[market]/[lang]`, Node runtime on Fluid compute ([Next.js 16.3](https://nextjs.org/blog/next-16-3); [Next 16](https://nextjs.org/blog/next-16)) | Build | — | Exact `cacheTag`/`revalidateTag`/`updateTag` semantics not verified. The Rust React Compiler and `useOffline` are experimental. |
| Hosting | **Vercel Pro, `regions: ["fra1"]`** ([Vercel regions](https://vercel.com/docs/functions/configuring-functions/region)) | Integrate | — | **Functions default to US `iad1`**. Routing Middleware runs in all regions. Failover regions are Enterprise-only. fra1 rates are about 30–45% above headline ([fra1 pricing](https://vercel.com/docs/pricing/regional-pricing/fra1)). |
| Database | **Supabase Pro, eu-central-1**, via Vercel Marketplace; Branching 2.0 per PR ([Supabase regions](https://supabase.com/docs/guides/platform/regions); [Branching 2.0](https://supabase.com/blog/branching-2-0)) | Integrate | Neon (scale-to-zero), but it **removed pg_search** in 2026 ([Neon](https://neon.com/docs/extensions/pg_search)) | Pro from $25/month; point-in-time recovery (PITR) $100/month per 7 days ([pricing](https://supabase.com/pricing)). |
| ORM / migrations | **Drizzle 0.45.3**, reviewed SQL migrations | Integrate | Prisma 7.10 | **Drizzle v1 is still RC**; plan the upgrade ([npm](https://registry.npmjs.org/drizzle-orm)). |
| Commerce core (catalogue, price lists, cart, reservations, orders, payments ledger, returns) | **Custom schema**: money as BIGINT minor units + ISO-4217; append-only event tables; idempotency and `webhook_events` tables; gap-free invoice sequences | **Build** | **Medusa v2 modules** (2.21.1) ([Medusa modules](https://docs.medusajs.com/resources/commerce-modules)); Vendure 3.7.3; Saleor | See the open-source core discussion below. |
| Search | **Postgres hybrid search**: per-locale `tsvector` + `pg_trgm` + pgvector HNSW, fused by Reciprocal Rank Fusion (RRF) in SQL; pgvector ≥0.8 iterative scans for filtered ANN ([ParadeDB manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual); [pgvector 0.8](https://www.postgresql.org/about/news/pgvector-080-released-2952)) | Build | Typesense / Meilisearch (EU-hosted), Algolia | **True BM25 isn't available on Supabase** ([discussion](https://github.com/orgs/supabase/discussions/34709)); Supabase's pgvector version unconfirmed. |
| AI | **AI SDK 7** (`ai` 7.0.112) + **AI Gateway** with `inferenceRegion: {scope:'zone', geoRegion:'eu'}` and per-request zero data retention (ZDR) ([AI SDK 7](https://vercel.com/blog/ai-sdk-7); [regional inference](https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference)) | Integrate models; build agent and tools | Direct OpenAI EU project, Mistral EU, Claude via Bedrock/Vertex EU | `WorkflowAgent` and MCP Apps rendering are experimental. **Anthropic's first-party API has no EU inference** ([Claude data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)). |
| Payments | **Stripe Checkout Sessions + Payment Element (Elements mode)**, webhooks as source of truth ([Stripe Checkout](https://docs.stripe.com/payments/checkout)) | Integrate | Mollie (EU-native, simpler); Adyen (high volume) | Standard EEA cards 1.5% + €0.25 (Stripe IE) ([Stripe pricing](https://stripe.com/ie/pricing)). Coverage of PayPal, Bizum, Swish, MobilePay, Wero and Cartes Bancaires co-badging not verified per PSP. |
| Tax | **Stripe Tax** (`automatic_tax`), OSS itemised export ([Stripe Tax EU](https://docs.stripe.com/tax/supported-countries/european-union)) | Integrate | Taxually or an intermediary | Tax Complete from €80/month. **Doesn't replace OSS registration or filing in all cases** [SEC] ([GoodVat](https://goodvat.com/guides/cross-border-tax-tools/stripe-tax-vs-taxually/)). |
| Auth | **Supabase Auth** or **Better Auth** 1.7.5 (in your own Postgres); guest checkout mandatory; separate staff auth with MFA | Integrate | Clerk | Supabase passkeys are **beta/experimental** ([changelog](https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta)). Clerk EU residency unverified. |
| Admin / CMS | **Payload 3** in-app on the same Postgres, or a custom admin; MDX for a few pages | Build / integrate | Sanity (hosted SaaS) | The admin is the fourth-costliest area to build. |
| Jobs | **Vercel Workflows (GA 16 Apr 2026)** on Queues (**public beta**); Supabase pg_cron / pgmq for DB-local jobs ([Workflows](https://vercel.com/blog/a-new-programming-model-for-durable-execution); [Queues](https://vercel.com/changelog/vercel-queues-now-in-public-beta)) | Integrate | Inngest, Trigger.dev | **Persistence region of Workflows and Queues is unverified**, which matters for order PII. |
| Email | **Resend**, sending from its EU region (Ireland), chosen by the owner (D32); templates in the repo | Integrate | Postmark (location unverified) | Resend's **account data stays in the US** ([Resend](https://resend.com/docs/dashboard/domains/regions)); covered by its DPA (D10). |
| Flags / experiments | Flags SDK + **Vercel Flags (GA)** for toggles; **GrowthBook** (open source, self-hostable in the EU) for statistics ([Vercel Flags](https://vercel.com/changelog/vercel-flags-ga); [GrowthBook](https://vercel.com/marketplace/growthbook)) | Integrate | Statsig | Evaluate server-side to avoid CLS and cookie dependence. |
| Analytics / errors / LLM traces | **PostHog EU** (Frankfurt), **Sentry EU** (`de.sentry.io`), Vercel Speed Insights, **Langfuse** ([PostHog](https://posthog.com/docs/privacy/data-storage); [Sentry](https://sentry.zendesk.com/hc/en-us/articles/25074658211227-About-Sentry-s-EU-Region)) | Integrate | Braintrust | Langfuse EU region believed but not officially verified. |
| Security | Vercel Firewall + managed OWASP rules; **BotID Deep Analysis** on checkout, sign-up and `/api/chat` ($1 per 1K checks); Upstash rate limits ([BotID](https://vercel.com/docs/botid)) | Integrate | — | Upstash EU availability unverified. |
| Engineering | Turborepo; TypeScript 7; Vitest 5; Playwright 1.63 with Next's `instant()` assertions; preview deploy + Supabase branch per PR; synthetic seed data | Build | — | — |

**The case for and against an open-source commerce core.** The notes rank the areas that are costliest to rebuild, as engineering judgement rather than measured effort:
1. The **promotions engine**: stacking rules, BOGO, tiers, customer groups, coupon limits, and tax-inclusive proration across lines and refunds.
2. **Order management**: partial fulfilment, order edits, exchanges, claims, RMAs, and partial refunds with credit notes.
3. **Tax**, which is integrated via Stripe Tax anyway.
4. The **admin back office**.
5. **Multi-location inventory and shipping-rate integration.**
6. **Price lists** per market or customer group.

Carts, catalogue, checkout orchestration and the AI layer are comparatively cheap, and that is where custom code adds the most value. Medusa v2's modules (cart, order, pricing, promotion, inventory, fulfilment, tax) can be used standalone ([Medusa](https://medusajs.com/blog/v2-release)). Vendure (3.7.3) and Saleor are also actively released.

- **The case for adoption:** it saves the top-ranked cost centres and gives a proven admin.
- **The case against:** an owned, lean schema that the agent tools wrap directly, a single deployment model, and no framework coupling while the AI layer is the differentiator. Critically, **none of the EU-specific features** (withdrawal button, Omnibus price history, GPSR fields, per-country VAT-inclusive pricing) were confirmed in any open-source core. Those must be built either way.
- **Unresearched points:** whether a Medusa server fits Vercel Functions hosting, and Vendure's commercial licence terms.

**Recommendation:** build from scratch with a deliberately narrow Phase 1 scope: one price list per currency, simple percentage and fixed coupons, full-order refunds plus line-level returns, and Stripe Tax. Study Medusa's return, claim and exchange schema before designing your own. Hold a formal "adopt a Medusa module or build" gate for promotions and order edits before Phase 5.

**The AI cost is trivial next to AOV, so choose models by evaluation, not price.** The researcher assumed six turns per conversation, a cached ~4k-token system prompt, and ~40k input tokens (30k of them cached) plus ~3k output tokens [EST]. At list prices, before the ~10% EU-region uplift, that gives:

| Model (list price source) | ≈ cost per conversation | ≈ per 10k conversations |
|---|---|---|
| GPT-6 Luna ([OpenAI](https://developers.openai.com/api/docs/pricing)) | $0.003 | $30 |
| Mistral Small 4 ([Mistral](https://mistral.ai/pricing/api/)) | $0.006–0.008 | $70 |
| Gemini 3.8 Flash (Developer API promotional price) ([Gemini](https://ai.google.dev/gemini-api/docs/pricing)) | $0.02 | $210 |
| Claude Haiku 4.5 ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | $0.028 | $280 |
| GPT-6 Sol / Claude Sonnet 5 | $0.05–0.06 | $560 |

The Gemini figure is unreliable: an aggregator quotes Vertex EU pricing for Gemini 3.8 Flash at $1.65 / $8.25 per 1M tokens, which **conflicts** with the Developer API promotional price and must be verified ([Requesty](https://www.requesty.ai/models/vertex/gemini-3.8-flash-eu)). Even premium models cost pennies per session. Fluid compute's Active CPU pricing doesn't bill the time spent waiting on the LLM ([Vercel](https://vercel.com/blog/introducing-active-cpu-pricing-for-fluid-compute)). Model choice should therefore follow tool-calling accuracy and latency in your own evals.

### EU data residency is a per-vendor design, not a checkbox

| Data path | Design | Residency status and residual risk |
|---|---|---|
| Server compute | All functions in `fra1`, co-located with the database | Must be set explicitly (default `iad1`). Adding `dub1` makes sense only with a replica there. |
| Routing Middleware | Locale suggestion, A/B bucketing, bot checks only | **Runs globally**, so it must never touch personal data. |
| CDN / ISR cache | Public catalogue HTML and images only | Served worldwide; acceptable because it holds no personal data. |
| Database, auth, storage | Supabase eu-central-1 | EU. Keep all commerce writes server-side; RLS for anything the browser reaches. |
| LLM inference | AI Gateway `geoRegion: 'eu'` + per-request ZDR; 2–3 EU-capable fallbacks; log the resolved `geoRegion` on every call | Fails with HTTP 400 rather than falling back silently. **Region-pinned gateway ingress is "coming", not shipped.** Provider abuse monitoring may keep flagged data outside the region, and some models are ZDR-ineligible ([Vercel](https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference)). Alternatives: an OpenAI **new** EU project on `eu.api.openai.com` with ZDR ([OpenAI](https://openai.com/index/introducing-data-residency-in-europe/)), Mistral EU endpoints, or Claude on Bedrock/Vertex EU (+10%). |
| Durable jobs carrying order PII | Vercel Workflows / Queues, or Supabase pgmq | Workflows/Queues region **unverified**; pgmq stays in the EU database. Trigger.dev keeps metadata in us-east-1 ([Trigger.dev](https://feedback.trigger.dev/p/european-data-residency)). |
| Email | EU-hosted email service preferred | Resend stores account data in the US. |
| Analytics, errors, traces | PostHog EU, Sentry EU, Langfuse (verify) | Mask checkout PII fields in session replay. |
| US processors generally | Data processing agreement (DPA) + EU–US Data Privacy Framework (DPF) or standard contractual clauses (SCCs) | The DPF survived *Latombe* on 3 Sep 2025, but the appeal C-703/25 P is pending ([IAPP](https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework)). This is a tail risk that favours EU vendors where the cost of switching is low. |

A single rule makes this manageable: keep a vendor residency register from Phase 0. Every new service must appear in it, with its data category, region, DPA status and exit plan, before it touches production data.

## Where the seller is established decides the tax architecture

**VAT depends on establishment and ship-from location more than on anything in the code.** The build must price, tax and report per destination country from day one. EU B2C price rules require the final VAT-inclusive price and unit prices [LEGAL] ([Price Indication Directive](https://eur-lex.europa.eu/eli/dir/1998/6/oj/eng)). A single EUR price with "VAT calculated at checkout" therefore doesn't comply. The store must resolve the customer's country before rendering a price. In Next.js that means caching product-page shells per market (root params) rather than globally.

Country detection may only *suggest* a locale. The Geo-blocking Regulation forbids forced redirects and discrimination between cards issued in different member states [LEGAL] ([Reg. 2018/302](https://eur-lex.europa.eu/eli/reg/2018/302/oj/eng)). The pricing engine should support two modes. In gross-price-fixed mode one gross price holds across the eurozone and margin absorbs VAT rates of 17–27%. In net-price-fixed mode the gross price varies by country.

| Scenario | VAT / customs consequence | Operational consequence |
|---|---|---|
| **A. EU-established, ships from its own member state** | The €10,000 EU-wide threshold applies. Above it, destination VAT via **Union OSS, quarterly** ([EC OSS](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en)). | Simplest. Stripe Tax computes and exports the OSS data; confirm filing with an accountant. |
| **B. Non-EU-established (e.g. Norway), ships from an EU warehouse** | **No €10,000 threshold**: destination VAT from the first euro, via Union OSS [LEGAL, researcher's reading of Arts. 59c, 369a–369k] ([VAT Directive](https://eur-lex.europa.eu/eli/dir/2006/112/oj/eng)). | VAT registration in the warehouse state. No per-parcel customs. EPR authorised representatives are likely required where the seller isn't established. |
| **C. Non-EU-established, ships from outside the EU (the Norway scenario from the earlier notes)** | **IOSS** for consignments ≤ €150 (monthly returns). **Since 1 Jul 2026, a flat €3 customs duty per item category** (by 4-digit tariff heading), *not* collected via IOSS, until the EU Customs Data Hub (~mid-2028). Consignments over €150 pay import VAT and duty at the border ([EC TAXUD](https://taxation-customs.ec.europa.eu/news/guidance-and-legal-text-temporary-flat-fee-low-value-imports-which-will-apply-until-1-july-2028-2026-06-08_en); [EAS](https://easproject.com/eu-3-customs-duty-ioss-2026/)). | Delivered-duty-paid (DDP) is needed to avoid delivery-time surprises, which feed straight into the 40% "extra costs" abandonment cause. Slower, costlier returns. |

Establishment also changes other things:
- **GPSR:** listings must name an EU responsible person where the manufacturer is outside the EU ([GPSR Art. 19](https://gpsr-online.com/general-product-safety-regulation/chapter-3/section-2/article-19/)).
- **EPR:** member states may require authorised representatives from sellers not established there.
- **EAA exemption:** the microenterprise exemption (<10 staff and ≤ €2M turnover) applies to services wherever they are based ([Directive 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng)).
- **AI Act:** it reaches non-EU providers whose output is used in the EU (Art. 2(1)(c)) ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)). A Norway-based seller therefore can't rely on Norway's delayed implementation, whose bill is now targeted at spring 2027 ([Digi.no](https://www.digi.no/artikler/nye-eu-regler-for-ki-norge-og-eos-henger-enna-langt-etter/575266)).
- **Not researched:** GDPR representative duties for a non-EU controller and the lead-supervisor consequences. Confirm with counsel.
- **ViDA:** its 2030 mandatory e-invoicing is B2B-only. For a B2C store the relevant dates are OSS extensions on 1 Jan 2027 and 1 Jul 2028 ([EC ViDA](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)).

### Compliance gates the build must pass

| Gate | Status (as of 23 Sep 2026) | What it demands of the build | Phase gate |
|---|---|---|---|
| **Withdrawal button** (Dir. 2023/2673, CRD Art. 11a) | **Applies since 19 Jun 2026** | A "withdraw from contract here" function that is always accessible for the whole withdrawal period. The customer confirms name, order and channel; a second "confirm withdrawal" step follows; receipt is acknowledged on a durable medium with date and time. Per-line eligibility flags ([Greenberg Traurig](https://www.gtlaw.com/en/insights/2026/5/eu-consumer-law-new-withdrawal-button-requirements-for-online-contracts)). | Phase 1 launch blocker |
| **Omnibus 30-day prior price** (PID Art. 6a) | Applies; **CJEU Aldi Süd (2024)** extends it to percentage badges and "price highlights" ([Kinstellar](https://www.kinstellar.com/news-and-insights/detail/2990/consumer-law-update-cjeu-rules-that-a-price-reduction-announced-in-an-advertisement-must-be-calculated-on-the-basis-of-the-lowest-price-in-the-last-30-days)) | Per-SKU, per-country price history (≥ 30 days, retained for audit). Reference prices are computed, never typed in. The assistant and feeds may only quote the computed reference. | Phase 1 |
| **CRD pre-contract info and order button** | Applies | An "order with obligation to pay" button. Total price, delivery costs and withdrawal info directly before ordering. Confirmation on a durable medium [LEGAL] ([CRD](https://eur-lex.europa.eu/eli/dir/2011/83/oj/eng)). | Phase 1 |
| **GPSR listing fields** (Art. 19) | Applies since 13 Dec 2024 | Mandatory product-data fields: manufacturer name, postal and electronic address; EU responsible person; identifiers and picture; warnings in the local language, *on the listing* (a link to T&Cs is reported as insufficient) ([gpsr-online](https://gpsr-online.com/general-product-safety-regulation/chapter-3/section-2/article-19/)). | Phase 1 (no product publishes without them) |
| **EAA / WCAG** | Applies since 28 Jun 2025. EN 301 549 v4.1.1 (WCAG 2.2 AA) published 2 Sep 2026, pending citation in the Official Journal (OJEU) ([AccessibleEU](https://accessible-eu-centre.ec.europa.eu/content-corner/news/european-accessibility-standard-en-301-549-has-been-updated-2026-09-07_en)) | Build to **WCAG 2.2 AA**, including target size, accessible authentication (no cognitive CAPTCHAs), an accessible chat widget and accessible third-party payment widgets. Publish an accessibility statement. A French court treated conformity as an "obligation of result": Carrefour was ordered to comply within six months, with a €500/day penalty ([Accessiway](https://www.accessiway.com/blog/carrefour-digital-inaccessibility-case)). | Phase 1, re-tested every phase |
| **VAT / OSS / IOSS** | Applies; €3 duty since 1 Jul 2026 | Per-country VAT-inclusive display, Stripe Tax `tax_code` per product, OSS exports reconciled by an accountant, IOSS number if Scenario C. | Phase 0 decision, Phase 1 verification |
| **PCI DSS SAQ A** | Revised SAQ A effective 31 Mar 2025 | Stripe.js loaded from js.stripe.com; no card data on your servers. The new eligibility criterion requires the site to be "not susceptible to attacks from scripts". So: strict CSP, no tag managers or chat widget on `/checkout`, BotID ([PCI SSC](https://blog.pcisecuritystandards.org/important-updates-announced-for-merchants-validating-to-self-assessment-questionnaire-a); [Stripe](https://docs.stripe.com/security/guide)). | Phase 1, re-checked when the assistant ships |
| **GDPR / ePrivacy consent** | Consent regimes vary nationally. The Digital Omnibus cookie reform is still a **proposal** ([Taylor Wessing](https://www.taylorwessing.com/en/global-data-hub/2026/the-digital-omnibus-proposal/gdh---the-digital-omnibus---cookies)). | Germany (TDDDG §25) needs opt-in for analytics ([Usercentrics](https://usercentrics.com/knowledge-hub/cookie-flood-control-consent-management-ordinance-tdddg/)). France (CNIL) exempts narrow first-party audience measurement (≤ 13-month cookies, ≤ 25-month retention) ([CNIL](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications)). Client-side A/B cookies generally need consent ([Convert](https://www.convert.com/blog/privacy/analytics-and-a-b-testing-cookies-only-after-consent-in-europe/)). **Build a per-country consent matrix.** | Phase 0 design, Phase 1 live |
| **AI Act Art. 50** | **Applies since 2 Aug 2026**; not postponed by the Omnibus ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)). The 50(2) grace period to 2 Dec 2026 covers only systems placed on the market before 2 Aug 2026, which a new store is not. | The disclosure must name the AI nature *and* the store, at first interaction, and be accessible. Generic "assistant" labels are reportedly insufficient per the 20 July 2026 guidelines. AI imagery that shows products "different from reality" may need labelling. Fines up to €15M or 3% [SEC summary] ([Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations)). **Conflict:** sources disagree on whether a store is "provider" or "deployer" ([artificialintelligenceact.eu](https://artificialintelligenceact.eu/transparency-rules-article-50/)); a branded in-house assistant is likely both, so treat both roles as applicable. | Phase 2 (imagery), Phase 3 (assistant) |
| **DPIA and chat logs** | Guidance: EDPB LLM risk report (Apr 2025); CNIL legitimate-interest sheets (Jun 2025) ([EDPB](https://www.edpb.europa.eu/documents/support-pool-of-experts/ai-privacy-risks-mitigations-large-language-models-llms_en); [CNIL](https://www.cnil.fr/fr/recommandations-developpement-ia-interet-legitime)) | A DPIA before the assistant launches. Raw transcripts kept 30–90 days. No training on chat logs by default. EU inference with ZDR. | Phase 3 launch blocker |
| **Reviews, personalised pricing, DSA** | Apply [LEGAL] ([UCPD](https://eur-lex.europa.eu/eli/dir/2005/29/oj/eng); [DSA](https://eur-lex.europa.eu/eli/reg/2022/2065/oj/eng)) | A verified-purchase flag and a public review-verification statement. A notice-and-action process for user-generated content. **No personalised pricing** unless disclosed pre-contract (CRD Art. 6(1)(ea)). | Phase 1 (reviews), Phase 5 (personalisation) |
| **Green claims (ECGT) and packaging (PPWR)** | **ECGT applies from 27 Sep 2026.** PPWR has applied since 12 Aug 2026. The Green Claims Directive has stalled ([Commission FAQ](https://commission.europa.eu/document/download/3c257883-bb2a-4dd9-a6dc-501d587bb34f_en?filename=faq-empowerting-consumers-gtd.pdf); [Latham](https://www.lw.com/en/insights/european-packaging-and-packaging-waste-regulation-summary-of-provisions-and-new-guidance)) | An output filter blocking generic "eco/green" claims in AI copy and in the assistant. EPR packaging registration in each country of sale. **Conflict:** the e-commerce empty-space cap is 50% from 2030 per Latham, but "40% from Aug 2026" per a logistics blog ([Carriyo](https://carriyo.com/resources/blog/eus-40-empty-space-rule-2026-04-07)); treat the latter as unverified. | Phase 1 (EPR), Phase 2 (AI copy filter) |
| **BNPL (CCD2)** | Applies from 20 Nov 2026 ([Hogan Lovells](https://www.hoganlovells.com/en/publications/eu-second-consumer-credit-directive-scope-and-impact-for-buy-now-pay-later-bnpl-providers)) | Use a BNPL provider rather than first-party invoicing. Any "0% interest" marketing copy follows credit-advertising rules, including copy the assistant generates. | Phase 1 |

Horizon items to monitor, not build for yet:
- **Product Liability Directive:** software and AI count as products from 9 Dec 2026 ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2024/2853/oj/eng)).
- **Digital Fairness Act:** a proposal is expected in Q4 2026, covering dark patterns and personalisation ([EP](https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act)).
- **PSD3/PSR:** not in the Official Journal as of 23 Sep 2026; targeted applicability is 2028. PSD2 SCA exemptions still govern checkout friction ([Worldline](https://worldline.com/en/home/main-navigation/resources/blogs/2026/the-scope-and-timeline-are-locked-in-for-psd3-and-psr-what-should-psps-know); [RTS 2018/389](https://eur-lex.europa.eu/eli/reg_del/2018/389/oj/eng)).

## Measure AI with randomised holdouts, because chat-user comparisons prove nothing

The measurement design has to be settled in Phase 0, because it shapes the flag system, the consent design and the analytics schema. **Randomise eligibility for each AI feature at the user level, never "chatters vs non-chatters".** Analyse every assigned visitor on an intention-to-treat basis, with **revenue (or gross margin) per assigned visitor** as the north-star metric. Conversion rate and AOV are the secondary metrics. The guardrails are:
- return and refund rate, measured with a 30–60-day lag
- discount rate
- LCP and INP
- checkout error rate
- support contacts
- unsubscribes

Chat-open rate is a diagnostic metric, not a success metric.

Three checks keep results honest:
- A daily **sample-ratio-mismatch (SRM) check**, because SRM signals broken data and invalidates results ([Fabijan et al.](https://arxiv.org/pdf/2208.07766)).
- Tests run for **at least two full weekly cycles**, with effects inspected week by week to catch novelty effects ([Sadeghi et al.](https://arxiv.org/pdf/2102.12893)).
- **CUPED** variance reduction using pre-period spend ([GrowthBook on Kohavi](https://www.growthbook.io/blog/lessons-learned-from-ronny-kohavi-and-luke-sonnet-running-trustworthy-experiments)).

Keep a **long-running global holdout of 5–10% of traffic with no AI features** to measure cumulative impact.

Traffic is the binding constraint. The table below gives visitors needed **per arm** (two-sided α = 0.05, 80% power, 50/50 split) [EST, standard formula] ([Evan Miller](https://www.evanmiller.org/ab-testing/sample-size.html)):

| Baseline CR | +5% relative | +10% | +20% | +30% |
|---|---|---|---|---|
| 1.0% | ~637,000 | ~163,000 | ~42,700 | ~19,800 |
| 2.0% | ~315,000 | ~80,700 | ~21,100 | ~9,800 |
| 3.0% | ~208,000 | ~53,200 | ~13,900 | ~6,500 |

Dilution makes this harder still. If 8% of visitors engage and engagers get a genuine 30% lift, the sitewide intention-to-treat effect is only about 2.4%. Detecting that needs millions of visitors. A launch-stage store should therefore:
- test **upstream metrics with higher baselines**, such as search-to-PDP, add-to-cart and zero-result rate
- run **bolder** treatments
- pre-register Bayesian or sequential decision rules in GrowthBook
- or accept a looser α and say so explicitly

Consent determines who can be measured. Server-side, cookieless assignment avoids the ePrivacy consent requirement, although a GDPR lawful basis is still needed ([Convert](https://www.convert.com/blog/privacy/analytics-and-a-b-testing-cookies-only-after-consent-in-europe/)). The practical design assigns variants on the server, keyed to a logged-in ID or an identifier the store already needs, evaluated in server code rather than middleware. **Whether reusing the cart or session token for experiment assignment counts as "strictly necessary" is a legal question for counsel.** If the answer is no, experiments cover only consenting visitors, and consent rates in each country shrink the samples above.

AI quality needs its own evaluation layer ([Hamel Husain evals FAQ](https://hamel.dev/blog/posts/evals-faq/)):
- **Build from real failures.** Start with error analysis of real traces, then encode recurring failures as binary pass/fail checks.
- **Code assertions come first.** Every price, stock and delivery figure must equal the database at answer time. Every product ID must exist and be purchasable. No invented discount codes. The Art. 50 disclosure must be present on the first turn. No personal data may be echoed back.
- **LLM-as-judge is used sparingly.** Reserve it for groundedness and policy correctness, and calibrate it against human labels first.
- **The golden set is multilingual.** It covers every launch language and includes adversarial reviews carrying injected instructions.
- **It runs everywhere.** Run it on every model or prompt change and on a 1–5% daily sample of production traces.

## Six phases, gated by decisions, evidence and law

Sequencing follows the evidence: the conventional store first, then the AI with the least risk and most reach (search and offline content), then the assistant behind a holdout, and agent channels in parallel once the data is clean. Relative size is engineering judgement from the notes' rebuild ranking. **No time estimates are given, because the research does not support them.**

### Phase 0: settle decisions and foundations (relative size: small–medium)

The goal is to lock in the choices that change the architecture, and to stand up an EU-pinned, testable skeleton whose data model already carries the compliance fields.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Decisions record:** establishment and ship-from scenario (A/B/C), launch countries, languages and currencies, product category, PSP, open-source core vs build, microenterprise status for the EAA. **Tax and legal:** accountant sign-off on the OSS/IOSS route; EPR registration plan (PPWR, plus WEEE and batteries if the category needs them); GPSR responsible person; DPIA scoping; per-country consent matrix. **Platform:** Turborepo; Vercel project with `regions: ["fra1"]`; Supabase eu-central-1 via Marketplace with a branch per PR; CI (TypeScript 7, Vitest, Playwright, migration diff); synthetic seed catalogue; Sentry EU; PostHog EU; Firewall baseline. **Data model:** money in minor units; per-currency price lists; per-country price history; GPSR attributes enforced as required; withdrawal-eligibility flags; order/payment/refund/return/credit-note tables; `idempotency_keys` and `webhook_events`; gap-free invoice sequences; append-only event tables. **Measurement:** server-side flag and assignment design; event taxonomy; GrowthBook set up. **Vendor residency register.** |
| Dependencies | None; this phase blocks everything else. |
| Exit criteria | Decisions signed off. Every preview deploy gets its own DB branch. Functions verified running in `fra1`. Residency register complete, with a DPA for each vendor. Schema reviewed by engineering and by the legal/tax adviser. |
| Compliance gates | Tax route agreed. Consent matrix drafted. DPIA scoped. |
| Key risks | The US `iad1` default region. Unverified Workflows/Queues region. Drizzle v1 is still pre-release. Next 16.3 cache API names unverified. Unresolved category and establishment decisions stall the schema. |

### Phase 1: launch the compliant core commerce MVP (relative size: largest)

The goal is a fast, accessible, legally complete store that takes real EU orders and produces clean baseline data. It uses no AI features.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Storefront:** home, category and product pages as cached shells via `'use cache'` + tags, per market; price, stock and cart as Suspense holes; locale suggestion without forced redirect; server-rendered prices; schema.org Product/Offer/MerchantReturnPolicy/OfferShippingDetails. **Checkout:** guest checkout by default, with an account offered after purchase; 7–8 fields; delivery date and cost shown on the product page and in the cart; carrier-agnostic pickup-point and locker selector; inventory reservations with a TTL; Stripe Checkout Sessions (Elements) + Payment Element + Stripe Tax; per-country payment methods (iDEAL/Wero, Bancontact, BLIK, P24, EPS, Klarna, SEPA DD, Apple/Google Pay, Link, and verify PayPal, Bizum, Swish, MobilePay); "order with obligation to pay" button; idempotent webhook ingestion; order state machine; confirmation emails via an EU email service. **Post-purchase:** withdrawal button + returns portal with drop-off returns; full-order refunds and line-level returns; credit notes. **Promotions:** simple coupons only, with Omnibus reference-price computation for any badge. **Reviews:** verified-purchase flag, a public review policy, notice-and-action. **Admin:** Payload or a minimal custom admin. **Acquisition:** Google Merchant Center feed; robots.txt allowing search and user fetchers; abandoned-cart and welcome flows (with consent). **Quality:** WCAG 2.2 AA audit; CWV budgets enforced in CI via Playwright `instant()`. |
| Dependencies | Phase 0 decisions and schema. PSP account for the chosen entity. EPR and OSS registrations. |
| Exit criteria | Mobile p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. End-to-end tests pass for every enabled payment method in test mode. Accessibility audit passed. OSS export reconciled by an accountant. Real orders flowing. **A baseline period long enough to estimate variance** for conversion, revenue per visitor, AOV, search usage and zero-result rate, which feeds the sample-size plan and CUPED. |
| Compliance gates | Withdrawal button. Omnibus rule. CRD button and pre-contract info. GPSR fields. VAT-inclusive display. EAA and accessibility statement. PCI SAQ A (no third-party scripts on `/checkout`). Consent live per country. EPR registrations. ECGT review of all copy. CCD2-compliant BNPL copy. Geo-blocking. |
| Key risks | Scope creep into advanced promotions and order edits, where the rebuild costs sit. Gaps in PSP coverage for national methods. Liability from machine-translated legal texts: T&Cs, withdrawal info and safety warnings need human review. Stripe Tax filing coverage unconfirmed. |

### Phase 2: add AI discovery through search and offline enrichment (relative size: medium)

The goal is to lift findability and data quality with AI that cannot state false facts at runtime.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Hybrid search:** a lexical CTE (per-locale `tsvector` + `pg_trgm`) and a semantic CTE (HNSW, filtered by market, stock and category, with `iterative_scan`), fused by RRF, then joined to live price and stock. Type-ahead is lexical only, with no embedding call. **Query parsing:** an LLM turns queries into structured filters (Zod output) that feed a deterministic SQL query. **Zero results:** logging and a rescue flow; zero-result rate becomes a KPI. **Embeddings pipeline:** Supabase Queues / automatic embeddings, with multilingual models. **Offline enrichment:** Workflows + Batch APIs for attribute extraction and normalisation, translations, FAQ blocks, verified-purchase review summaries and precomputed "similar items". Everything is human-approved before publishing. **Claims filter:** blocks generic eco claims, fake urgency and "best price" claims. **Optional:** a reranker on the top 30–50 results, only on non-type-ahead paths. |
| Dependencies | Phase 1 catalogue and attributes; baseline search metrics. |
| Exit criteria | Randomised test (searchers assigned to hybrid vs lexical) shows search-to-cart or revenue per searcher not worse and directionally better. Zero-result rate below baseline. Query-parsing eval passes. End-to-end search latency within the target (the notes estimate <300 ms is achievable [EST]). |
| Compliance gates | ECGT filter on all AI copy. Art. 50(4) review of any AI imagery. Search-log retention documented. User-generated content sanitised before embedding. |
| Key risks | `ts_rank` is not true BM25, so relevance may push toward an external engine. Embedding latency (~50–150 ms [EST]) needs a cache. Stemming quality in smaller languages. Reranker cost. |

### Phase 3: ship the grounded AI assistant, embedded first (relative size: medium–large)

The goal is a grounded assistant on the product page and a guided finder, then conversational shopping and order help. Each surface keeps its place only if a randomised holdout justifies it.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Agent:** an AI SDK 7 `streamText` loop. **Tools:** `searchProducts`, `getProduct`, `checkStock`, `getPrice`, `compareProducts`, `addToCart(variantId, qty)` with server re-pricing and user-click or signed approval, `getOrderStatus` (authenticated or verified by email token), `handoffToHuman` (writes to `support_tickets`). **Rendering:** typed tool parts render 3–5 product cards from the database; a deterministic calculator; sanitised output; suggested-prompt chips. **Surfaces:** the product-page "ask about this product" panel first, then the guided finder, then open chat. The launcher is lazy-loaded after interaction or idle, so AI never blocks LCP. **AI Gateway:** EU inference, per-request ZDR, EU-capable fallbacks, budgets per project and key. **Security:** BotID and rate limits on `/api/chat`; step and token caps. **Evals and observability:** golden set in every launch language, red-team suite, Langfuse traces. **Compliance UI:** Art. 50 disclosure naming the store, with a visible route to a human. |
| Dependencies | Phase 2 search and cleaned attributes, whose tools the assistant reuses. Phase 0 flag and holdout infrastructure. Completed DPIA. |
| Exit criteria | A pre-registered user-level holdout, analysed on intention-to-treat revenue per visitor with CUPED, shows benefit or at least no harm. Guardrails not worse: returns, LCP/INP, complaints. Grounding-failure rate on sampled traffic under a threshold set in advance. Cost per incremental order known. Global holdout maintained. |
| Compliance gates | Art. 50(1) disclosure. DPIA signed off. Chat-log retention of 30–90 days. No training on transcripts. PCI: no chat script on checkout routes. Policy answers quote fixed text. |
| Key risks | Misreading self-selected lift. Low statistical power. Moffatt-type liability for misstatements. Prompt injection through reviews. Widget weight hurting INP. Model deprecations changing behaviour. Claude has no first-party EU route. |

### Phase 4: open agent-facing interfaces and discoverability (relative size: small–medium; can overlap Phases 2–3)

The goal is to be found and correctly represented by external agents in the EU while checkout stays on the store's own domain.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Feed export service:** one normalised dataset with per-channel serializers for Google Merchant Center (EPREL certification where relevant), Microsoft Merchant Center, the OpenAI feed (apply; expect US-default targeting), the Perplexity merchant programme, Klarna APP and the Stripe ACS catalogue CSV (preview). **Freshness:** event-driven price and stock pushes, because feed-vs-checkout price mismatch is the main failure mode. **MCP server:** read-only, with tools for catalogue search, product details, availability, shipping and returns policy, reusing the Phase 3 domain tools, with tool shapes aligned to UCP catalogue capabilities. **Checkout model:** internal checkout kept UCP-shaped (sessions, statuses, idempotency, signed webhooks) so the endpoints can be mapped cheaply later. **Bot handling:** Vercel verified-bot allow rules; BotID lets verified agents through on cart and checkout; optional RFC 9421 verifier for Visa TAP. **Analytics:** AI-referral segmentation (chatgpt.com, gemini.google.com, perplexity.ai, copilot.microsoft.com, claude.ai). |
| Dependencies | Phase 1 catalogue and Merchant Center. Phase 2 cleaned attributes. Phase 3 domain tools for the MCP server. |
| Exit criteria | Feeds accepted without item errors. Feed-to-site price and stock mismatch near zero. Verified agents are not challenged. MCP server passes injection and accuracy evals. AI-referral traffic and conversion reported separately. |
| Compliance gates | The Omnibus reference price is the only strike-through source in feeds. Feed content matches on-site pre-contract information. |
| Key risks | Distribution stays US-only. Beta specs keep changing (ACP date-versioned; UCP 2026-08-25). ACS preview terms. Agents misclassified as bots. |

### Phase 5: scale and optimise (relative size: open-ended)

The goal is to widen the market and deepen commerce capability based on measured results, and to switch on agent checkout only when EU distribution actually opens.

| Element | Detail |
|---|---|
| Workstreams and deliverables | **Commerce depth:** a gated decision to adopt a Medusa module or build the promotions engine, order edits, exchanges and claims; multi-location and EU-warehouse inventory. **Market expansion:** more languages and currencies, with human review of legal text. **Search:** an external engine (EU-hosted Typesense or Meilisearch, or self-hosted ParadeDB) only if relevance, faceting or scale demands it. **Personalisation:** consent-gated, content-based recommendations; no personalised pricing. **Agent checkout:** UCP/ACP checkout endpoints plus OAuth identity linking (PKCE S256) *when* Google, OpenAI or Stripe ACS open to EU sellers; a ChatGPT app built with MCP Apps using external checkout. **Platform upgrades:** passkeys once GA; Drizzle v1. **Regulatory readiness:** PSD3/PSR (2028), ViDA OSS changes (2027/2028), citation of EN 301 549 v4.1.1. **Experimentation:** a continuous programme against the global holdout. |
| Dependencies | Evidence from the Phase 3 and 4 holdouts. External rollout announcements. |
| Exit criteria | Each new capability justified by a randomised test or a regulatory need. |
| Compliance gates | CRD personalised-pricing disclosure if pricing is ever personalised. The Digital Fairness Act once proposed. PLD for AI features after 9 Dec 2026. |
| Key risks | Complexity creep. Distribution arriving on platform terms. Regulatory drift. |

## What not to build yet, and what would change that

| Don't build yet | Evidence for waiting | Revisit when |
|---|---|---|
| **In-chat / agent checkout endpoints** (ACP `/checkout_sessions`, UCP checkout, ChatGPT Payment Sheet) | EU sellers have no distribution: UCP checkout is US/CA/AU, OpenAI's feed defaults to US, and Copilot and Perplexity are US-only. In-chat checkout converted at about ⅓ of click-outs [SEC]. | Google, OpenAI or Microsoft announce EU merchant eligibility. Keep the model UCP-shaped so the switch is cheap. |
| **llms.txt as a lever** | Found on about 8.7–10% of sites; an SE Ranking model got *more* accurate without it ([SE Ranking](https://seranking.com/blog/llms-txt/); [Rankability](https://www.rankability.com/data/llms-txt-adoption/)). Crawler logs show AI bots almost never fetch it [SEC]. | A major AI provider documents that it uses the file. Adding it is harmless, but budget nothing for it. |
| **Virtual try-on / AR / visual search** | Only vendor lift claims exist, and it is category-dependent. | The category decision lands on apparel, eyewear or furniture; then buy it rather than build. |
| **A floating chat widget as the primary AI surface** | Engagement is about 1% [VEN]; NN/g usability problems; no causal lift evidence. | A Phase 3 holdout proves lift. Embedded surfaces come first. |
| **Personalised or AI-dynamic pricing** | CRD Art. 6(1)(ea) disclosure duty; the Digital Fairness Act will target unfair personalisation. | Only after legal review, and with the disclosure built in. |
| **Advanced promotions engine and order edits** | The costliest areas to rebuild; the MVP doesn't need them. | Demand is proven, via the Phase 5 adopt-or-build gate. |
| **External search engine** | In-Postgres hybrid search covers catalogues under about 100k SKUs [EST]. | Faceting, merchandising or scale limits appear in Phase 2 metrics. |
| **Durable `WorkflowAgent`, MCP Apps UI, realtime** | Labelled experimental in AI SDK 7. | They reach GA. A plain `streamText` loop suffices. |
| **Direct Wero integration** | PSPs handle the iDEAL-to-Wero migration ([CM.com](https://www.cm.com/blog/ideal-to-wero-what-merchants-need-to-know-about-the-transition/)). | Never, unless the PSP lags. |
| **First-party "pay by invoice"** | Credit risk, and CCD2 duties from 20 Nov 2026. | Never for launch; use a BNPL provider. |
| **Schema.org as an AI-citation play** | A controlled Ahrefs test showed no uplift. | Keep schema for Google rich results only. |

## Conclusion: the decisions that unlock the build

The research changes the usual framing of an "AI-native" store. The AI features that are native to the build are infrastructure, not the chat bubble. The infrastructure consists of:
- a clean, attribute-rich catalogue
- live, tool-accessible prices and stock
- per-country compliant pricing
- a checkout model shaped like the emerging agent protocols

Built this way, the same domain services serve the storefront, hybrid search, the assistant, the feeds and the MCP server. That lets the store switch on agent checkout as a mapping exercise rather than a rebuild once EU distribution opens. The assistant is then an experiment with a known cost of pennies per session and an unknown benefit, and a randomised holdout, not vendor dashboards, decides whether it stays. The binding constraints are not model quality. They are traffic for statistical power, national payment coverage, the tax consequences of establishment, and EU consumer law that now reaches into the database schema.

| Open decision | Options | What it changes | Needed by |
|---|---|---|---|
| **Seller establishment and ship-from location** | A: EU entity, own-state stock. B: non-EU entity with an EU warehouse. C: non-EU entity shipping from outside the EU (e.g. Norway). | OSS vs IOSS; the €10k threshold; the €3/item duty and DDP; EPR authorised representatives; GPSR responsible person; Stripe entity and settlement currencies; GDPR representative (unresearched). | Phase 0 |
| **Product category** | General catalogue vs a focused vertical | Reduced VAT rates; withdrawal exclusions; WEEE, battery and textile EPR; EPREL; unit pricing; eligibility for AI channels; whether virtual try-on is relevant; baseline conversion and test power. | Phase 0 |
| **Launch countries, languages, currencies** | Start narrow vs EU-wide from day one | Translation and legal-review load; payment-method set; consent matrix; eval-set languages; locker carriers. | Phase 0 |
| **Commerce core** | From scratch vs Medusa v2 modules vs a full open-source core | Cost of promotions, returns and order edits; admin; hosting model. | Phase 0 (with a Phase 5 re-gate) |
| **PSP** | Stripe (default) vs Mollie vs Adyen | Tax integration; national methods; ACS agent readiness; fees. | Phase 0 |
| **Primary LLM route** | AI Gateway EU vs OpenAI EU project vs Mistral vs Claude on Bedrock/Vertex EU | Residency guarantees; fallbacks; eval results; the ~10% EU premium. | Before Phase 2 |
| **Consent and experiment-assignment basis** | Consent-only experiments vs server-side assignment under the strictly-necessary exemption (counsel's view) | Measurable sample size and statistical power in each country. | Phase 0 |
| **EU-residency strictness** | Strict EU-only vendors vs DPF-covered US vendors | Email, jobs and observability vendor choices; exposure to the DPF appeal. | Phase 0 |
| **Training-crawler policy** | Allow vs block GPTBot, ClaudeBot, Google-Extended | Brand policy only; no documented effect on AI search visibility. | Phase 1 |
