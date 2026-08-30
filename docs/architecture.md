# Architecture baseline

## Scope

This repository is only for the Mercado Libre AI Listing Console. It does not contain order, warehouse, purchasing, accounting, customer-service, SEO-site, or enterprise-knowledge-base features.

## Components

- Appsmith Community Edition: visual operations console.
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
