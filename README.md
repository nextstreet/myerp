# Mercado Libre AI Listing Console

美客多AI上架工作台：一个面向 Mexico、Colombia、Chile 的轻量级商品资料、AI文案、图片、报价、UP多规格和官方API发布工作台。

> Current stage: `v0.7.0 Global UP publishing`. The secure `/console` supports optional AI preparation, human review, Mercado Libre picture upload, current category preflight and one explicitly confirmed six-UP Family publication. Manual-only operation remains fully supported. Live publishing is disabled by default and cannot run without both the server switch and an operator confirmation.

## Included in v0.7.0

- Official multi-UP Family creation through `POST /global/user-products/families`; every selected variant remains an independent Siteless User Product.
- Reviewed local pictures are uploaded through `/pictures/items/upload` and only returned picture IDs enter the Family request.
- Explicit `global_net_proceeds` per User Product, kept separate from the three marketplace price forecasts.
- Current CBT and local category-attribute checks immediately before publication.
- Server-side idempotency claim plus provider idempotency key reuse after uncertain transport failures.
- Complete Family, CBT Item, Siteless UP and MLM/MCO/MLC Item identifier persistence.
- Reconciliation lock after an accepted but incomplete provider response, preventing accidental duplicate publication.
- Two-stage operator safety: separate `UPLOAD_PICTURES` and `PUBLISH` confirmations, with country, UP count, proceeds and picture count shown before publication.

- Optional AI workflow: products can remain fully manual, use text only, or analyze a user-selected image subset.
- Three-layer fact control: AI suggestions can never overwrite manual or human-confirmed facts.
- Multimodal OpenAI-compatible provider boundary with separate text, vision and image models.
- Independent Spanish titles for Mexico, Colombia and Chile, with English descriptions/specifications.
- Official Mercado Libre category requirements included in copy generation when categories and an account are available.
- Seven-to-ten-image gallery planning with editable prompts and strict product-fidelity instructions.
- Reference-image white-background and marketing-image drafts stored as pending review, never auto-published or auto-associated.
- Multi-image upload from both the AI studio and review page.
- Idempotency keys, generation audit records and safe error summaries for chargeable AI operations.

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
- Synthetic demonstration seed data and automated multi-variant tests.
- Live publishing safety switch and explicit confirmation gate.
- Human-editable product, variant and three-site listing review APIs.
- Confirmed-field locks: AI-originated updates cannot overwrite approved values.
- External generated-image registration, media sorting, prompts, preview content and color association.
- `user_product_seller` capability detection using the connected seller profile.
- Current category-required/variation attribute lookup for up to ten category IDs.
- Global UP Family request preview preserving every selected User Product and independent site sales conditions.
- Read-only remote preflight with missing attributes/pictures and redacted validation job records.
- Independent normal/promotional price persistence for every variant on MLM, MCO and MLC.
- Three-site category prediction through authenticated domain discovery without auto-selecting a category.
- Narrow read-only inspection of one explicitly supplied MLM/MCO/MLC item owned by the connected seller; no catalog listing or synchronization.
- One explicit primary image per variant; reused color-primary images are rejected by preflight.
- Mercado Libre picture IDs and image validation state can be recorded after a separate approved upload step.
- Responsive five-page visual console: products, import, AI content, review/pricing, and publish preflight/logs.
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
| GET | `/api/ai/products/:id/workspace` | Read fact layers and recent AI task history |
| PUT | `/api/ai/products/:id/facts` | Save manual or human-confirmed fact objects |
| POST | `/api/ai/products/:id/analyze` | Optionally extract fact suggestions from selected images and text |
| POST | `/api/ai/products/:id/listing-drafts` | Generate editable three-site copy drafts |
| POST | `/api/ai/products/:id/image-plan` | Generate an editable 7–10 image gallery plan |
| POST | `/api/ai/products/:id/white-background` | Generate a pending-review white-background draft from a reference image |
| POST | `/api/ai/products/:id/generate-image` | Generate a pending-review gallery draft from a reference image and prompt |
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
| GET | `/api/integrations/mercadolibre/accounts/:id/items/:itemId` | Inspect one owned item plus description and Global UP/Family data |
| GET | `/api/publish/:productId/preflight` | Validate the family before API conversion |
| GET | `/api/publish/:productId/draft` | Preview the internal UP draft |
| GET | `/api/publish/:productId/global-up-preview` | Preview the unsent `/global/user-products/families` request |
| POST | `/api/publish/:productId/remote-preflight` | Read-only account/category preflight; never publishes |
| GET | `/api/publish/jobs` | Review preflight/publish job summaries and errors |
| POST | `/api/publish/:productId/upload-pictures` | Upload reviewed local images only; never creates a listing |
| POST | `/api/publish/:productId/live` | Create one reviewed UP Family; requires `PUBLISH` and `MELI_PUBLISH_ENABLED=true` |

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

When upgrading, pulling the new image is not enough: run `npm run db:migrate` (or the Compose migration command above) so migration `006_global_up_publish.sql` and all earlier migrations are applied before restarting the API.

Nginx must forward both the Appsmith/API path and the exact registered callback path `https://mercado.cybertao.space/oauth/callback` to `127.0.0.1:3100`. Keep `MELI_PUBLISH_ENABLED=false` during OAuth and smoke testing.

For local development only, expose PostgreSQL with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

## Publication boundary

The Family creation API accepts an English `family_name` and generates marketplace titles from the product attributes. The three Spanish titles remain editable review/calibration data in Tianchuan ERP; they are not inserted into the Family creation body. Marketplace-specific title or proceeds updates should be implemented as a separate, explicitly confirmed update workflow after the first live Family has been verified.

Keep `MELI_PUBLISH_ENABLED=false` through deployment, migration, image review and remote preflight. Enable it only for the short, supervised publication window, then turn it off again.

See [docs/ai-studio.md](docs/ai-studio.md) for AI setup and operation, and [docs/architecture.md](docs/architecture.md) for the data and safety boundaries.
