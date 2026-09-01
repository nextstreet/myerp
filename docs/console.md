# Visual console deployment

The visual console is served by the API at `/console`. It does not place `APP_API_KEY` or Mercado Libre credentials in browser code. A user logs in with a separate management password; the server verifies a scrypt hash and returns a signed HttpOnly, SameSite=Strict cookie.

## 1. Build the v0.7 image

```bash
git pull origin main
docker compose build api
```

## 2. Generate the console password hash

Choose a unique password of at least 12 characters. Do not put the password itself in `.env`, shell history, chat, logs or Git.

```bash
read -rsp "Console password: " CONSOLE_PASSWORD_INPUT
echo
printf '%s' "$CONSOLE_PASSWORD_INPUT" \
  | docker compose run --rm -T api npm run --silent console:hash-password
unset CONSOLE_PASSWORD_INPUT
```

Copy only the resulting `scrypt$...` hash into `CONSOLE_PASSWORD_HASH` in the server `.env`.

Generate a separate signing secret:

```bash
openssl rand -base64 32
```

Copy the result into `CONSOLE_SESSION_SECRET`. Do not reuse `APP_API_KEY`, `TOKEN_ENCRYPTION_KEY`, the database password or the console password.

Configure the exact browser origin:

```dotenv
CONSOLE_PUBLIC_URL=https://mercado.cybertao.space
CONSOLE_PASSWORD_HASH=scrypt$...
CONSOLE_SESSION_SECRET=<base64-encoded-32-byte-value>
CONSOLE_SESSION_TTL_SECONDS=28800
```

`CONSOLE_PUBLIC_URL` is an origin, not the `/console` path. The strict origin check rejects state-changing browser requests from any other origin.

## 3. Restart safely

Run the database migration command during upgrade. Migration `006_global_up_publish.sql` adds picture-upload state, `global_net_proceeds`, Family/CBT/site identifiers and publish reconciliation records. Migration `007_variant_media_selection.sql` materializes the former shared-image behavior into explicit per-variant selections so the console and the final UP request show the same image set.

```bash
docker compose run --rm api npm run db:migrate
docker compose up -d api
curl -s http://127.0.0.1:3100/health
```

The response should contain the deployed package `version` and `consoleConfigured: true`.

Open `https://mercado.cybertao.space/console` and enter the management password. Five failed login attempts from one IP within 15 minutes are throttled.

## Page workflow

1. **Products** — filter products and open AI processing or manual review.
2. **Import** — create the source product and all variants in one transaction; the six-color helper creates six distinct Seller SKUs.
3. **AI content** — optionally analyze selected images, confirm product facts, create editable three-site copy and generate pending-review image drafts.
4. **Review** — edit variants, upload images, use the numbered gallery and per-variant number map to add/remove images, assign one primary image per color, discover site categories, save English/Spanish content and calculate/store independent site prices. Removing a number only removes that image from the selected variant; it does not delete the stored image or its Mercado Libre picture ID.
5. **Publish preflight** — run local and authenticated read-only preflight, inspect the exact Global UP Family request, upload reviewed images, and view redacted job/result logs.

## Supervised publication

1. Leave `MELI_PUBLISH_ENABLED=false` while filling data.
2. Give every selected variant a unique Seller SKU, a positive `global_net_proceeds` value and one exclusive primary color image.
3. Mark every selected gallery image as `ready`, upload it to Mercado Libre, then rerun remote preflight.
4. Verify the displayed target countries, User Product count, picture count and proceeds values.
5. During an approved publication window only, set `MELI_PUBLISH_ENABLED=true` and restart the API.
6. Type `PUBLISH`, accept the final browser confirmation and submit once.
7. Verify that the result contains one Family ID, one CBT Item and one Siteless UP per selected variant, plus the expected site Item IDs.
8. Set `MELI_PUBLISH_ENABLED=false` and restart the API after the supervised test.

If the console reports `publish_reconciliation_required`, do not submit again. Mercado Libre accepted the original request but the returned mapping was incomplete; inspect the saved job and identifiers before any manual correction.
