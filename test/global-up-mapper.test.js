import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalUpFamilyPreview } from '../src/integrations/mercadolibre/global-up-mapper.js';

test('Global UP preview keeps six variants and three independent site conditions', () => {
  const variants = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'].map((color, index) => ({
    id: `v${index}`, sellerSku: `SKU-${index}`, color, stock: 10, participateInPublish: true
  }));
  const listings = [
    { site: 'MLM', title: 'Titulo MX', categoryId: 'MLM1', globalCategoryId: 'CBT1', currency: 'USD', price: 19 },
    { site: 'MCO', title: 'Titulo CO', categoryId: 'MCO1', globalCategoryId: 'CBT1', currency: 'USD', price: 18 },
    { site: 'MLC', title: 'Titulo CL', categoryId: 'MLC1', globalCategoryId: 'CBT1', currency: 'USD', price: 17 }
  ];
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Demo', familyName: 'Synthetic Demo Product', rawAttributes: {} },
    variants,
    listings,
    mediaByVariant: Object.fromEntries(variants.map((variant) => [variant.id, [{ externalUrl: `https://img.example/${variant.id}.jpg` }]]))
  });
  assert.equal(preview.requests.length, 6);
  assert.ok(preview.requests.every((request) => request.endpoint === '/global/items'));
  assert.ok(preview.requests.every((request) => request.body.sites_to_sell.length === 3));
  assert.ok(preview.requests.every((request) => request.body.category_id === 'CBT1'));
  assert.ok(preview.requests.every((request) => !Object.hasOwn(request.body, 'title')));
  assert.ok(preview.requests.every((request) => !Object.hasOwn(request.body, 'variations')));
  assert.equal(new Set(preview.summary.sellerSkus).size, 6);
  assert.ok(preview.requests.every((request) => request.body.pictures.length === 1));
});
