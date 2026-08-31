import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItemInspection } from '../src/integrations/mercadolibre/oauth-service.js';

test('item inspection keeps listing, category, UP family and picture facts', () => {
  const result = normalizeItemInspection({
    item: {
      id: 'MCO4393187474',
      site_id: 'MCO',
      seller_id: 3385555772,
      title: 'Organizador de escritorio',
      category_id: 'MCO388338',
      user_product_id: 'MCOU123',
      status: 'active',
      price: 99900,
      attributes: [{ id: 'COLOR', name: 'Color', value_id: '52049', value_name: 'Negro' }],
      pictures: [{ id: 'abc', secure_url: 'https://example.test/abc.jpg', size: '500x500' }]
    },
    description: { plain_text: 'English description' },
    userProduct: {
      id: 'MCOU123',
      family_id: '12345',
      family_name: 'Metal Mesh Desktop Organizer',
      status: 'active'
    },
    userProductStatus: 'ok'
  });

  assert.equal(result.item.sellerId, '3385555772');
  assert.equal(result.item.categoryId, 'MCO388338');
  assert.equal(result.item.attributes[0].valueName, 'Negro');
  assert.equal(result.item.pictures[0].url, 'https://example.test/abc.jpg');
  assert.equal(result.description.plainText, 'English description');
  assert.equal(result.userProduct.familyId, '12345');
  assert.equal(result.lookups.userProduct, 'ok');
});

test('item inspection records optional lookup failures without losing the item', () => {
  const result = normalizeItemInspection({
    item: { id: 'MLC4426912152', seller_id: 3385555772 },
    description: null,
    userProduct: null,
    userProductStatus: 'not_applicable'
  });
  assert.equal(result.item.id, 'MLC4426912152');
  assert.equal(result.description, null);
  assert.equal(result.userProduct, null);
  assert.deepEqual(result.lookups, { description: 'unavailable', userProduct: 'not_applicable' });
});
