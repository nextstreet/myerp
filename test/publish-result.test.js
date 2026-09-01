import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFamilyPublishResult } from '../src/integrations/mercadolibre/publish-result.js';

test('family publish response maps every synthetic SKU and site item', () => {
  const result = normalizeFamilyPublishResult({
    siteless_family_id: 'F-DEMO',
    user_products: [1, 2, 3, 4, 5, 6].map((number) => ({
      id: `U-DEMO-${number}`,
      attributes: [{ id: 'SELLER_SKU', value_name: `DEMO-${number}` }],
      sites_to_sell: [
        { site_id: 'MLM', item_id: `MLM-DEMO-${number}` },
        { site_id: 'MCO', item_id: `MCO-DEMO-${number}` },
        { site_id: 'MLC', item_id: `MLC-DEMO-${number}` }
      ]
    }))
  });
  assert.equal(result.familyId, 'F-DEMO');
  assert.equal(result.userProducts.length, 6);
  assert.equal(new Set(result.userProducts.map((item) => item.sellerSku)).size, 6);
  assert.ok(result.userProducts.every((item) => item.sites.length === 3));
});

test('family publish response accepts CBT parent items and site_items', () => {
  const payload = Array.from({ length: 6 }, (_, index) => ({
    item_id: `CBT-DEMO-${index}`,
    parent_user_product_id: `CBTU9000${index}`,
    family_id: 'FAMILY-DEMO',
    site_items: ['MLM', 'MCO', 'MLC'].map((site) => ({ site_id: site, item_id: `${site}-DEMO-${index}` }))
  }));
  const expectedSellerSkus = Array.from({ length: 6 }, (_, index) => `SKU-${index}`);
  const result = normalizeFamilyPublishResult(payload, expectedSellerSkus);
  assert.equal(result.userProducts.length, 6);
  assert.equal(result.userProducts[0].userProductId, 'U90000');
  assert.equal(result.userProducts[0].globalItemId, 'CBT-DEMO-0');
  assert.equal(result.userProducts[5].sellerSku, 'SKU-5');
  assert.equal(result.userProducts[0].sites.length, 3);
});
