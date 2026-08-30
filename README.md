# Mercado Libre AI Listing Console

美客多AI上架工作台：一个面向 Mexico、Colombia、Chile 的轻量级商品资料、AI文案、图片、报价、UP多规格和官方API发布工作台。

> Current stage: `v0.2.0 secure OAuth`. Global Selling OAuth and read-only smoke testing are implemented. Live publishing remains disabled until account capabilities, official site payloads and user confirmation are verified.

## Included in v0.2.0

- PostgreSQL schema for products, variants, media, listings, listing variants and idempotent publish jobs.
- Product creation/list/detail/status APIs.
- Image, video and ZIP upload plus variant-media association.
- Transparent pricing engine for MLM/MCO/MLC.
- Internal Product Family / User Product draft builder.
- Preflight checks for six variants, unique Seller SKUs, images, site listings, titles, categories and prices.
- Replaceable AI provider boundary.
- Global Selling OAuth authorization-code flow with single-use state validation.
- AES-256-GCM encrypted Access/Refresh Token storage and atomic refresh-token rotation.
- Automatic refresh before expiry plus one refresh-and-retry on HTTP 401.
- Read-only smoke tests for the account, sites and category discovery on MLM/MCO/MLC.
- Server-only Mercado Libre client boundary with recursive sensitive-field redaction.
- Six-color metal mesh organizer seed data and automated tests.
- Live publishing safety switch and explicit confirmation gate.

## Quick start

Requirements: Node.js 22+, PostgreSQL 15+ or Docker Compose.

```bash
cp .env.example .env
# Edit .env and generate unique passwords/keys before continuing.
docker compose build
docker compose up -d postgres
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm run db:seed
docker compose up -d api
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
| POST | `/api/integrations/mercadolibre/oauth/connect` | Create a short-lived Global Selling authorization URL |
| GET | `/oauth/callback` | Consume the OAuth code and store encrypted tokens |
| GET | `/api/integrations/mercadolibre/accounts` | List connected accounts without tokens |
| POST | `/api/integrations/mercadolibre/accounts/:id/refresh` | Rotate the account token manually |
| POST | `/api/integrations/mercadolibre/accounts/:id/smoke-test` | Run read-only API checks |
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
- OAuth state is stored only as a SHA-256 hash and can be consumed once.
- Rotating account tokens are encrypted in PostgreSQL; the encryption key remains in server environment variables.

## Production deployment

Do not place `.env` in the Docker image. `.dockerignore` excludes it from the build context. The production Compose file exposes only the API on `127.0.0.1:3100`; PostgreSQL stays on the private Docker network.

Generate independent secrets on the server:

```bash
openssl rand -hex 32       # APP_API_KEY
openssl rand -base64 32    # TOKEN_ENCRYPTION_KEY
openssl rand -base64 36    # POSTGRES_PASSWORD
chmod 600 .env
```

Run migrations before starting the API:

```bash
docker compose run --rm api npm run db:migrate
docker compose up -d
```

Nginx must forward both the Appsmith/API path and the exact registered callback path `https://mercado.cybertao.space/oauth/callback` to `127.0.0.1:3100`. Keep `MELI_PUBLISH_ENABLED=false` during OAuth and smoke testing.

For local development only, expose PostgreSQL with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

## Next implementation milestone

1. Inspect the existing server and complete the first OAuth authorization.
2. Run the read-only smoke test and record real Global Selling account capabilities.
3. Add listing editing and confirmed-field locking.
4. Convert the internal UP draft to account/site-specific official requests and API preflight.
5. Build and export the four Appsmith pages.
6. Add FFmpeg template video generation.

See [docs/architecture.md](docs/architecture.md) for the data and safety boundaries.
