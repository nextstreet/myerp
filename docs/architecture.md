# Architecture baseline

## Scope

This repository is only for the Mercado Libre AI Listing Console. It does not contain order, warehouse, purchasing, accounting, customer-service, SEO-site, or enterprise-knowledge-base features.

## Components

- Built-in server-hosted console: current visual operations UI. Appsmith remains an optional later integration.
- Fastify API: validation, pricing, AI provider boundary, UP mapping, preflight and publishing orchestration.
- PostgreSQL: products, variants, listings, listing variants, media metadata and publish jobs.
- Local/S3-compatible storage adapter: original and generated media.
- FFmpeg worker: template video generation (planned).
- Mercado Libre adapter: official OAuth/API integration, isolated from internal domain models.

## UP mapping

- `products`: internal source product.
- `listings.family_data`: site family draft.
- `variants`: concrete color/size combinations.
- each selected `variant`: one internal User Product candidate.
- `listings`: country-specific sales content and pricing.
- `listing_variants`: country-specific price and Mercado Libre User Product ID.
- `publish_jobs`: idempotent attempt and redacted response record.

The internal UP draft intentionally does not pretend to be the final Mercado Libre request. The site adapter must query current category/account capabilities and transform the draft into the official schema before preflight or publishing.

## Safety gates

1. API authentication for all `/api/*` routes.
2. server-only OAuth and AI secrets.
3. structured logger redaction.
4. `MELI_PUBLISH_ENABLED=false` by default.
5. exact `PUBLISH` confirmation required by the live route.
6. idempotency key required when live publishing is implemented.
7. no permanent-delete endpoint.
8. AI-source review updates skip every field marked confirmed; human edits remain possible.
9. v0.3 remote preflight performs authenticated GET requests only and records summaries, never tokens or full credentials.
10. AI suggestions remain isolated until explicitly copied and saved by a human.
11. Generated images remain `pending` and are never auto-associated or published.
12. Product workflow is persisted as `new_product` or `add_variants`; it determines POST/create versus PUT/update and cannot be overridden by a conflicting browser parameter.
13. Multi-variant copy generation and publication require a confirmed local category for every selected site and official support for every actual variation axis.

## Category and workflow decision gate

- AI may convert the effective product facts into one local Spanish category-search query per target site. It never declares a category authoritative.
- Candidate IDs and variation attributes come from the authenticated Mercado Libre APIs. An operator can choose a suggestion or type another same-site category ID; both paths perform the same official metadata lookup.
- `product_category_assessments` stores the selected category, official variation attributes and the exact variant axes present at confirmation time.
- Adding/removing a varying color, size or other attribute makes an older assessment stale. Editing a listing to a different category also makes it stale.
- Local preflight requires the saved decision. Remote preflight re-fetches MLM/MCO/MLC and CBT metadata and blocks unsupported axes or metadata lookup failures.
- The two publication workflows share validation and media infrastructure, but their mutation targets remain separate: `new_product` creates a Family; `add_variants` updates one resolved existing Family.

## v0.6 AI content boundary

- `product_fact_sheets` separates manual facts, replaceable AI suggestions and human-confirmed facts.
- Copy and image prompts use confirmed facts, manual facts and the original product record; unconfirmed AI suggestions are excluded.
- Operators choose which local images leave the server for the configured AI provider. External image URLs are rejected for analysis until uploaded locally.
- Text, vision and image models are independently configurable through server environment variables.
- Chargeable calls use idempotency keys and create `ai_generations` audit records without raw image bytes or credentials.
- Generated image records retain source-media IDs and generation IDs for provenance.

## v0.3 review and preflight boundary

- `products`, `variants`, and `listings` expose explicit allowlisted review fields.
- `confirmed_fields` is a per-entity JSON map used to prevent AI regeneration from overwriting approved content.
- `seller_accounts.capabilities` caches the CBT site check and the official `user_product_seller` tag result.
- Category requirements are always read from Mercado Libre at preflight time; required enumerations are not hard-coded.
- The `/global/user-products/families` request is a review candidate only. It is not transmitted until picture handling, the CBT category, returned account metadata and the user's second confirmation have all passed.
- Each remote preflight creates redacted `publish_jobs` summaries for MLM, MCO and MLC so failures remain auditable.

## v0.7 Global UP publication boundary

- `Variant` maps one-to-one to a Siteless User Product; the Family request body is an array and its order is preserved when Mercado Libre's response omits Seller SKU.
- `global_net_proceeds` belongs to the UP root. The independent MLM/MCO/MLC price calculations remain review forecasts and are never silently substituted for this provider field.
- Family creation sends English `family_name`, CBT category/attributes, stock, English description, uploaded picture IDs and `sites_to_sell`. It does not send a `title` or `variations` field.
- Returned `siteless_family_id`, CBT Item, Siteless UP and site Item identifiers are persisted separately.
- Existing-Family mode resolves the Family ID from owned CBT/local Item fields, provider-advertised `site_items`, then the child User Product detail. A local MCO/MLC/MLM category is never treated as proof of a CBT category mismatch.
- An existing provider-read Family name is preserved during incremental updates; adding variants cannot silently rename the Family.
- An accepted response with mixed results or incomplete identifiers is saved as far as possible and moves the product into the explicit `reconciliation_required` state. A new Family request is blocked to prevent duplicates.

## v0.4 listing-readiness boundary

- `listing_variants` stores normal price, optional promotional price, currency and the editable calculation basis for every site/variant pair.
- Category discovery is account-authenticated and site-specific. Suggestions are returned to the operator but never selected automatically.
- `variant_media.is_primary` identifies exactly one color-defining image per variant. A partial unique index prevents two primary rows for one variant.
- Local preflight rejects missing primaries, one primary reused across different variants, rejected media and images with no publishable URL or Mercado Libre picture ID.
- Picture ID storage is prepared, but this release does not upload pictures to Mercado Libre without a separately confirmed action.

## OAuth and token lifecycle

- The browser receives only a short-lived Global Selling authorization URL.
- OAuth state is random, stored as a SHA-256 hash, expires after ten minutes by default, and is consumed once.
- The callback exchanges the authorization code only on the server.
- Client Secret and `TOKEN_ENCRYPTION_KEY` stay in server environment variables.
- Access and Refresh Tokens are encrypted with AES-256-GCM and authenticated context before PostgreSQL storage.
- Refresh Token rotation is serialized with a PostgreSQL advisory lock and row lock.
- Tokens expiring within thirty minutes are refreshed automatically.
- An authenticated request receiving HTTP 401 refreshes and retries exactly once.
- API/log responses never return token ciphertext or plaintext.
- Default HTTP request logging is disabled so OAuth callback query parameters are never written to logs.

## Production network boundary

- Nginx is the only public entry point.
- The API binds to host loopback port 3100.
- PostgreSQL has no host port in the production Compose file.
- Appsmith calls authenticated API actions; it does not receive Mercado Libre credentials.
