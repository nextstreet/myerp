# Appsmith v0.3 query wiring

Create one authenticated REST datasource whose base URL is the public API origin. Add `X-API-Key` as a server-side datasource header. Never store Mercado Libre credentials in Appsmith widgets, JavaScript objects or query bodies.

## Products page

| Query | Method and path | Bindings |
|---|---|---|
| `Products_List` | `GET /api/products?status={{StatusFilter.selectedOptionValue}}` | table data |
| `Product_Detail` | `GET /api/products/{{ProductsTable.selectedRow.id}}` | review drawer/page |
| `Product_Status` | `PATCH /api/products/{{appsmith.URL.queryParams.productId}}/status` | `{ "status": StatusSelect.selectedOptionValue }` |

Display `thumbnailMediaId`, `internalCode`, `sourceUrl`, `originalTitle`, `variantCount`, `targetSites`, `purchasePriceCny`, `packedWeightG`, `status`, `createdAt`, and `updatedAt`.

## Import page

- `Product_Create`: `POST /api/products` with the form values and the complete variants array.
- `Variant_Add`: `POST /api/products/{id}/variants` for later colors/sizes.
- `Media_Upload`: multipart `POST /api/products/{id}/media`.
- `Media_External`: `POST /api/products/{id}/media/external` for an HTTPS AI image result.
- `Variant_Image_Link`: `POST /api/products/{id}/variants/{variantId}/media/{mediaId}`.

For the six-color test product, submit six rows before leaving the page and show the returned detail count. Do not collapse a color selector into one variant row.

## AI review page

- Human save: `PATCH /api/products/{id}` and `PUT /api/products/{id}/listings/{site}`.
- AI save uses the same calls with `?source=ai`. The response includes `ignoredConfirmedFields`; show these as “kept approved value”.
- Field approval: `POST /api/products/{id}/confirmations` with `entityType`, optional `entityId`, `fields`, and `confirmed`.
- Variant edit: `PATCH /api/products/{id}/variants/{variantId}`.
- Pricing: `POST /api/pricing/quote-all`.
- Image order/prompt: `PATCH /api/products/{id}/media/{mediaId}`.

Use separate tabs for MLM, MCO and MLC. Titles are Spanish; description and specifications remain English. A user edit is always allowed, including a previously confirmed value. Only AI-originated writes are blocked from overwriting confirmed fields.

## Publish review page

Run in this order:

1. `GET /api/publish/{productId}/preflight`.
2. `GET /api/integrations/mercadolibre/accounts/{accountId}/capabilities`.
3. `POST /api/publish/{productId}/remote-preflight` with `{ "accountId": "..." }`.
4. Display `variantCount`, target sites, per-site prices, picture count, missing attributes and `remoteErrors`.
5. Display the returned `preview` as read-only formatted JSON.
6. Display `GET /api/publish/jobs?productId={productId}` below the preview.

The remote preflight performs account and category reads only. Do not add a live-publish button while the backend still returns `publishing_adapter_pending`. `MELI_PUBLISH_ENABLED` must remain `false`.
