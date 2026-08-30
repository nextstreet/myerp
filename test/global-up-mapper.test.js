import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalUpFamilyPreview } from '../src/integrations/mercadolibre/global-up-mapper.js';

test('Global UP preview keeps six variants and three independent site conditions', () => {
  const variants = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'].map((color, index) => ({
    id: `v${index}`, sellerSku: `SKU-${index}`, color, stock: 10, participateInPublish: true
  }));
  const listings = [
    { site: 'MLM', title: 'Titulo MX', categoryId: 'MLM1', currency: 'MXN', price: 399 },
    { site: 'MCO', title: 'Titulo CO', categoryId: 'MCO1', currency: 'COP', price: 89900 },
    { site: 'MLC', title: 'Titulo CL', categoryId: 'MLC1', currency: 'CLP', price: 19900 }
  ];
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Organizer', familyName: 'Metal Mesh Organizer', rawAttributes: {} },
    variants,
    listings,
    mediaByVariant: Object.fromEntries(variants.map((variant) => [variant.id, [{ externalUrl: `https://img.example/${variant.id}.jpg` }]]))
  });
  assert.equal(preview.body.length, 6);
  assert.ok(preview.body.every((item) => item.sites_to_sell.length === 3));
  assert.equal(new Set(preview.summary.sellerSkus).size, 6);
  assert.ok(preview.body.every((item) => item.pictures.length === 1));
});
