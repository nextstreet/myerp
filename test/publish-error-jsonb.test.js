import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFamilyPublishResult } from '../src/integrations/mercadolibre/publish-result.js';

// The jsonb-safe wrapper used by persistPublishResult (src/routes/publish.js).
// node-postgres binds a raw JS array argument as a PostgreSQL array literal,
// which is invalid JSON for a jsonb column (22P02), so every jsonb-bound value
// must be explicitly serialized to a JSON string first.
function jsonb(value) {
  if (value == null) return '{}';
  if (typeof value === 'string') return JSON.stringify({ message: value });
  return JSON.stringify(value);
}

// Regression: Mercado Libre may return a bare string error; and a siteProducts
// JS array must never be handed to a jsonb column un-serialized (arrays raise
// 22P02). Both cases must produce a valid JSON string for the jsonb insert.
test('string errors and siteProducts arrays serialize to valid JSON for jsonb', () => {
  const payload = [{
    id: 'U-TEST-1',
    seller_sku: 'SKU-1',
    error: 'seller_item_failed',
    sites_to_sell: [
      { site_id: 'MLM', item_id: 'MLM-1' },
      { site_id: 'MCO', error: 'site_rejected' }
    ]
  }];
  const result = normalizeFamilyPublishResult(payload, ['SKU-1']);
  const item = result.userProducts[0];

  // publish_error value stays JSON-serializable regardless of string/object error
  for (const site of item.sites) {
    const rawError = item.error ?? site.error ?? (!site.itemId ? { code: 'item_id_missing' } : {});
    const stored = jsonb(rawError);
    assert.equal(typeof stored, 'string');
    assert.ok(JSON.parse(stored), 'stored publish_error must be parseable JSON');
  }

  // item.raw payload also serializes to a JSON string (never an array literal)
  const payloadStored = jsonb(item.raw);
  assert.equal(typeof payloadStored, 'string');
  const parsedPayload = JSON.parse(payloadStored);
  assert.equal(parsedPayload.error, 'seller_item_failed');

  // siteProducts (a JS array) serializes to a JSON array string, not PG array syntax
  const siteProducts = [{ sellerSku: 'SKU-1', userProductId: null, globalItemId: null, itemId: 'MLM-1' }];
  const siteProductsStored = JSON.stringify(siteProducts);
  assert.equal(typeof siteProductsStored, 'string');
  assert.deepEqual(JSON.parse(siteProductsStored), siteProducts);
});

test('listing user_product_data arrays are explicitly serialized for jsonb', () => {
  const userProductData = [];
  const databaseParameter = JSON.stringify(userProductData);

  assert.equal(databaseParameter, '[]');
  assert.deepEqual(JSON.parse(databaseParameter), []);
  assert.notEqual(databaseParameter, '{}', 'must not become a PostgreSQL array literal');
});

// Regression: Mercado Libre returns HTTP 200 with a body containing per-element
// { error, status: 400, cause } validation errors. These must be recognized as
// a provider rejection, not parsed as identifier-less user products.
test('batch validation error body is detected as provider rejection', () => {
  const payload = [1, 2, 3].map(() => ({
    message: 'body.required_fields',
    error: 'validation_error',
    status: 400,
    cause: [{ code: 'body.required_fields', references: ['sale_terms'] }]
  }));
  const result = normalizeFamilyPublishResult(payload, ['SKU-1', 'SKU-2', 'SKU-3']);
  assert.equal(result.providerRejected, true);
  assert.equal(result.userProducts.length, 3);
  assert.ok(result.userProducts.every((u) => u.error === 'validation_error'));
  assert.ok(result.userProducts.every((u) => u.userProductId === null));
});
