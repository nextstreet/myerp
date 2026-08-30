# Mercado Libre AI Listing Console

美客多AI上架工作台：一个面向 Mexico、Colombia、Chile 的轻量级商品资料、AI文案、图片、报价、UP多规格和官方API发布工作台。

> Current stage: `v0.1.0 foundation`. Live Mercado Libre publishing is deliberately disabled until OAuth, account capabilities, official site payloads and user confirmation are verified.

## Included in v0.1.0

- PostgreSQL schema for products, variants, media, listings, listing variants and idempotent publish jobs.
- Product creation/list/detail/status APIs.
- Image, video and ZIP upload plus variant-media association.
- Transparent pricing engine for MLM/MCO/MLC.
- Internal Product Family / User Product draft builder.
- Preflight checks for six variants, unique Seller SKUs, images, site listings, titles, categories and prices.
- Replaceable AI provider boundary.
- Server-only Mercado Libre client boundary with sensitive-field redaction.
- Six-color metal mesh organizer seed data and automated tests.
- Live publishing safety switch and explicit confirmation gate.

## Quick start

Requirements: Node.js 22+, PostgreSQL 15+ or Docker Compose.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Health check:

```bash
curl http://localhost:3100/health
```

When `APP_API_KEY` is configured, send it as `X-API-Key` for every `/api/*` request.

## Main endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Database and service health |
| GET | `/api/products` | Product list |
| POST | `/api/products` | Create product with variants |
| GET | `/api/products/:id` | Product review data |
| PATCH | `/api/products/:id/status` | Change non-publishing workflow state |
| POST | `/api/products/:id/media` | Upload image/video/ZIP |
| POST | `/api/products/:id/variants/:variantId/media/:mediaId` | Associate media with a variant |
| POST | `/api/pricing/quote` | Calculate one site quote |
| POST | `/api/pricing/quote-all` | Calculate independent three-site quotes |
| GET | `/api/publish/:productId/preflight` | Validate the family before API conversion |
| GET | `/api/publish/:productId/draft` | Preview the internal UP draft |
| POST | `/api/publish/:productId/live` | Safety-gated placeholder; no live publishing in v0.1.0 |

## Security

- Never commit `.env` or real credentials.
- Never place Mercado Libre or AI keys in Appsmith client-visible parameters.
- The repository contains variable names only.
- Logs redact authorization, cookies, API keys, access tokens, refresh tokens and client secrets.
- The live publishing switch defaults to `false`.
- There is no permanent-delete API.

## Next implementation milestone

1. Inspect the existing server and deploy this API against the available PostgreSQL instance.
2. Add listing editing and confirmed-field locking.
3. Add current Mercado Libre category/attribute discovery and OAuth refresh storage.
4. Convert the internal UP draft to account/site-specific official requests and API preflight.
5. Build and export the four Appsmith pages.
6. Add FFmpeg template video generation.

See [docs/architecture.md](docs/architecture.md) for the data and safety boundaries.
