# Appsmith UI

The Appsmith Community Edition application will be exported into this directory after the API schema is stable.

Planned pages:

1. Products
2. Import product
3. AI processing and review
4. Publish and error log

Appsmith must call the API with a server-managed `X-API-Key`. Mercado Libre OAuth secrets must never be configured in browser-visible datasource parameters.

The future connection action calls `POST /api/integrations/mercadolibre/oauth/connect`, then opens the returned short-lived `authorizationUrl`. After the callback succeeds, Appsmith lists accounts through `GET /api/integrations/mercadolibre/accounts` and can trigger the read-only smoke test. It never receives Access Token, Refresh Token, Client Secret, or token ciphertext.
