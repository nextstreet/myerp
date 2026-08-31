# Mercado Libre AI Listing Console

美客多AI上架工作台：一个面向 Mexico、Colombia、Chile 的轻量级商品资料、AI文案、图片、报价、UP多规格和官方API发布工作台。

> Current stage: `v0.5.0 visual console`. A secure, server-hosted visual workbench is available at `/console` for product import, six-variant review, media association, transparent three-site pricing and read-only publish preflight. Live publishing remains disabled.

## Included in v0.5.0

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
- Human-editable product, variant and three-site listing review APIs.
- Confirmed-field locks: AI-originated updates cannot overwrite approved values.
- External generated-image registration, media sorting, prompts, preview content and color association.
- `user_product_seller` capability detection using the connected seller profile.
- Current category-required/variation attribute lookup for up to ten category IDs.
- Global UP Family candidate preview preserving all six User Products and all three site sales conditions.
- Read-only remote preflight with missing attributes/pictures and redacted validation job records.
- Independent normal/promotional price persistence for every variant on MLM, MCO and MLC.
- Three-site category prediction through authenticated domain discovery without auto-selecting a category.
- One explicit primary image per variant; reused color-primary images are rejected by preflight.
- Mercado Libre picture IDs and image validation state can be recorded after a separate approved upload step.
- Responsive four-page visual console: products, import, review/pricing, and publish preflight/logs.
- Password login with scrypt hash, signed HttpOnly/SameSite session cookie, strict origin checks and login throttling.
- Browser requests never receive or store `APP_API_KEY`, OAuth tokens, Client Secret or token-encryption keys.
- Visual three-site quote calculator that exposes every input and fills normal/promotional variant prices for human approval.

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
| PATCH | `/api/products/:id` | Human or AI-source product review update |
| POST/PATCH | `/api/products/:id/variants[...]` | Add or edit concrete variants |
| PUT | `/api/products/:id/listings/:site` | Create/edit the MLM/MCO/MLC listing draft |
| PUT | `/api/products/:id/listings/:site/prices` | Save independent normal/promotional variant prices |
| POST | `/api/products/:id/confirmations` | Confirm/unconfirm fields protected from AI overwrite |
| POST | `/api/products/:id/media` | Upload image/video/ZIP |
| POST | `/api/products/:id/media/external` | Register an HTTPS image generated outside the console |
| POST | `/api/products/:id/variants/:variantId/media/:mediaId` | Associate media with a variant |
| POST | `/api/pricing/quote` | Calculate one site quote |
| POST | `/api/pricing/quote-all` | Calculate independent three-site quotes |
| POST | `/api/integrations/mercadolibre/oauth/connect` | Create a short-lived Global Selling authorization URL |
| GET | `/oauth/callback` | Consume the OAuth code and store encrypted tokens |
| GET | `/api/integrations/mercadolibre/accounts` | List connected accounts without tokens |
| POST | `/api/integrations/mercadolibre/accounts/:id/refresh` | Rotate the account token manually |
| POST | `/api/integrations/mercadolibre/accounts/:id/smoke-test` | Run read-only API checks |
| GET | `/api/integrations/mercadolibre/accounts/:id/capabilities` | Inspect CBT and `user_product_seller` capability |
| POST | `/api/integrations/mercadolibre/accounts/:id/category-requirements` | Read official category attributes |
| POST | `/api/integrations/mercadolibre/accounts/:id/category-discovery` | Predict independent MLM/MCO/MLC categories |
| GET | `/api/publish/:productId/preflight` | Validate the family before API conversion |
| GET | `/api/publish/:productId/draft` | Preview the internal UP draft |
| GET | `/api/publish/:productId/global-up-preview` | Preview the unsent Global UP Family candidate |
| POST | `/api/publish/:productId/remote-preflight` | Read-only account/category preflight; never publishes |
| GET | `/api/publish/jobs` | Review preflight/publish job summaries and errors |
| POST | `/api/publish/:productId/live` | Safety-gated placeholder; no live publishing in v0.5.0 |

## Visual console

The built-in console is deliberately independent of Appsmith's version-specific export format. It uses the same API and can later be retained alongside or embedded into Appsmith. See [docs/console.md](docs/console.md) for secure setup and operation.

After configuration, open:

```text
https://mercado.cybertao.space/console
```

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

When upgrading, pulling the new image is not enough: run `npm run db:migrate` (or the Compose migration command above) so migrations `003` and `004` are applied before restarting the API.

Nginx must forward both the Appsmith/API path and the exact registered callback path `https://mercado.cybertao.space/oauth/callback` to `127.0.0.1:3100`. Keep `MELI_PUBLISH_ENABLED=false` during OAuth and smoke testing.

For local development only, expose PostgreSQL with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

## Next implementation milestone

1. Wire the four Appsmith pages using [appsmith/API_QUERIES.md](appsmith/API_QUERIES.md).
2. Upload/associate one approved image for each of the six colors.
3. Select real categories and import their current mandatory attributes.
4. Confirm the final Global UP payload against the connected account's returned metadata.
5. Implement picture upload plus a still-disabled idempotent publication adapter.
6. Add FFmpeg template video generation.

See [docs/architecture.md](docs/architecture.md) for the data and safety boundaries.
