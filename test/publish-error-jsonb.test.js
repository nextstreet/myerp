import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFamilyPublishResult } from '../src/integrations/mercadolibre/publish-result.js';

// The jsonb-safe wrapper used by persistPublishResult (src/routes/publish.js).
// It must never feed a bare string into a jsonb column (PostgreSQL 22P02).
function jsonb(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  return { message: String(value) };
}

// Regression: Mercado Libre may return a bare string (not an object) for
// entry.error / site.error. Persisting that string directly into the jsonb
// publish_error column raises 22P02, which silently loses a provider-accepted
// publish and trips the reconciliation guard on the next attempt.
test('string errors are wrapped into a JSON object before jsonb insert', () => {
  const payload = [{
    id: 'U-TEST-1',
    seller_sku: 'SKU-1',
    error: 'seller_item_failed',            // bare string on the UP root
    sites_to_sell: [
      { site_id: 'MLM', item_id: 'MLM-1' },
      { site_id: 'MCO', error: 'site_rejected' }  // bare string on a site
    ]
  }];
  const result = normalizeFamilyPublishResult(payload, ['SKU-1']);
  const item = result.userProducts[0];

  // publish_error value: what persistPublishResult writes for each site/variant
  for (const site of item.sites) {
    const rawError = item.error ?? site.error ?? (!site.itemId ? { code: 'item_id_missing' } : {});
    const stored = jsonb(rawError);
    assert.ok(typeof stored === 'object' && !Array.isArray(stored), 'jsonb output must be an object');
    assert.equal(typeof JSON.stringify(stored), 'string');
    assert.ok(stored.message === 'seller_item_failed' || stored.message === 'site_rejected' || stored.code,
      'error details preserved after wrapping');
  }

  // mercado_payload value: the whole entry must also survive jsonb round-trip
  const payloadStored = jsonb(item.raw);
  assert.ok(typeof payloadStored === 'object' && !Array.isArray(payloadStored));
  assert.equal(payloadStored.error, 'seller_item_failed');
});
