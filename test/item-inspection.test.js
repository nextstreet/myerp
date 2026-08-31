import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoLibreOAuthService, normalizeItemInspection } from '../src/integrations/mercadolibre/oauth-service.js';

test('item inspection keeps listing, category, UP family and picture facts', () => {
  const result = normalizeItemInspection({
    item: {
      id: 'MCO4393187474',
      site_id: 'MCO',
      seller_id: 3385555772,
      owner_id: 3385555000,
      cbt_item_id: 'CBT1234567890',
      title: 'Organizador de escritorio',
      category_id: 'MCO388338',
      user_product_id: 'MCOU123',
      status: 'active',
      price: 99900,
      net_proceeds: { amount: 20, currency_id: 'USD' },
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
  assert.equal(result.item.ownerId, '3385555000');
  assert.equal(result.item.cbtItemId, 'CBT1234567890');
  assert.deepEqual(result.item.netProceeds, { amount: 20, currency_id: 'USD' });
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


test('CBT item inspection uses the Global Selling marketplace item endpoint', async () => {
  const calls = [];
  const service = new MercadoLibreOAuthService({
    config: {},
    pool: {
      async query() {
        return { rowCount: 1, rows: [{ meli_user_id: '3385555772' }] };
      }
    },
    cipher: {},
    apiClient: {}
  });
  service.authenticatedRequest = async (_accountId, path) => {
    calls.push(path);
    if (path.startsWith('/marketplace/items/')) {
      return {
        ok: true,
        status: 200,
        payload: {
          id: 'MCO4393187474',
          site_id: 'MCO',
          seller_id: 123456,
          owner_id: 3385555772,
          cbt_item_id: 'CBT1234567890',
          descriptions: [{ plain_text: 'Inline English description' }]
        }
      };
    }
    return { ok: false, status: 403, payload: {} };
  };

  const result = await service.inspectItem('account-1', 'MCO4393187474');

  assert.equal(calls[0], '/marketplace/items/MCO4393187474?include_attributes=all');
  assert.equal(result.item.cbtItemId, 'CBT1234567890');
  assert.equal(result.description.plainText, 'Inline English description');
});
