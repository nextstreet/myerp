# Appsmith UI

The v0.5 repository now includes a built-in visual console because official Appsmith JSON exports must originate from a live Appsmith instance and do not carry datasource credentials. Appsmith remains optional: configure the queries in [API_QUERIES.md](API_QUERIES.md) when an instance/version is available, or embed the secure `/console` application.

Planned pages:

1. Products
2. Import product
3. AI processing and review
4. Publish and error log

Appsmith must call the API with a server-managed `X-API-Key`. Mercado Libre OAuth secrets must never be configured in browser-visible datasource parameters.

The future connection action calls `POST /api/integrations/mercadolibre/oauth/connect`, then opens the returned short-lived `authorizationUrl`. After the callback succeeds, Appsmith lists accounts through `GET /api/integrations/mercadolibre/accounts` and can trigger the read-only smoke test. It never receives Access Token, Refresh Token, Client Secret, or token ciphertext.
