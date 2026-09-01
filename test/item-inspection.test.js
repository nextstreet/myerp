import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoLibreOAuthService, normalizeItemInspection, toSitelessUserProductId } from '../src/integrations/mercadolibre/oauth-service.js';

test('local User Product IDs normalize to the Siteless UP ID', () => {
  assert.equal(toSitelessUserProductId('MCOU123456'), 'U123456');
  assert.equal(toSitelessUserProductId('MLCU123456'), 'U123456');
  assert.equal(toSitelessUserProductId('CBTU123456'), 'U123456');
  assert.equal(toSitelessUserProductId('U123456'), 'U123456');
  assert.equal(toSitelessUserProductId(null), null);
});

test('item inspection keeps listing, category, UP family and picture facts', () => {
  const result = normalizeItemInspection({
    item: {
      id: 'MCO1000000000',
      site_id: 'MCO',
      seller_id: 1000000001,
      owner_id: 1000000002,
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
    globalItem: {
      id: 'CBT1234567890',
      family_name: 'Synthetic Demo Product',
      siteless_user_product_id: 'U123'
    },
    userProduct: {
      id: 'MCOU123',
      family_id: '12345',
      family_name: 'Synthetic Demo Product',
      status: 'active'
    },
    userProductStatus: 'ok'
  });

  assert.equal(result.item.sellerId, '1000000001');
  assert.equal(result.item.ownerId, '1000000002');
  assert.equal(result.item.cbtItemId, 'CBT1234567890');
  assert.deepEqual(result.item.netProceeds, { amount: 20, currency_id: 'USD' });
  assert.equal(result.item.categoryId, 'MCO388338');
  assert.equal(result.item.attributes[0].valueName, 'Negro');
  assert.equal(result.item.pictures[0].url, 'https://example.test/abc.jpg');
  assert.equal(result.description.plainText, 'English description');
  assert.equal(result.globalItem.sitelessUserProductId, 'U123');
  assert.equal(result.userProduct.familyId, '12345');
  assert.equal(result.lookups.userProduct, 'ok');
});

test('item inspection records optional lookup failures without losing the item', () => {
  const result = normalizeItemInspection({
    item: { id: 'MLC1000000000', seller_id: 1000000001 },
    description: null,
    userProduct: null,
    userProductStatus: 'not_applicable'
  });
  assert.equal(result.item.id, 'MLC1000000000');
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
        return { rowCount: 1, rows: [{ meli_user_id: '1000000001' }] };
      }
    },
    cipher: {},
    apiClient: {}
  });
  service.authenticatedRequest = async (_accountId, path) => {
    calls.push(path);
    if (path.startsWith('/marketplace/items/MCO')) {
      return {
        ok: true,
        status: 200,
        payload: {
          id: 'MCO1000000000',
          site_id: 'MCO',
          seller_id: 123456,
          owner_id: 1000000001,
          cbt_item_id: 'CBT1234567890',
          user_product_id: 'MCOU123',
          descriptions: [{ plain_text: 'Inline English description' }]
        }
      };
    }
    if (path.startsWith('/marketplace/items/CBT')) {
      return {
        ok: true,
        status: 200,
        payload: {
          id: 'CBT1234567890',
          site_id: 'CBT',
          family_name: 'Synthetic Demo Product',
          parent_user_product_id: 'CBTU123'
        }
      };
    }
    return { ok: false, status: 403, payload: {} };
  };

  const result = await service.inspectItem('account-1', 'MCO1000000000');

  assert.equal(calls[0], '/marketplace/items/MCO1000000000?include_attributes=all');
  assert.ok(calls.includes('/marketplace/items/CBT1234567890?include_attributes=all'));
  assert.ok(!calls.some((path) => path.startsWith('/global/user-products/')));
  assert.equal(result.item.cbtItemId, 'CBT1234567890');
  assert.equal(result.userProduct, null);
  assert.equal(result.lookups.userProduct, 'not_exposed_by_item_read_api');
  assert.equal(result.description.plainText, 'Inline English description');
});

test('CBT item inspection accepts an official marketplace child owner', async () => {
  const calls = [];
  const service = new MercadoLibreOAuthService({
    config: {},
    pool: { async query() { return { rowCount: 1, rows: [{ meli_user_id: '3385555772' }] }; } },
    cipher: {},
    apiClient: {}
  });
  service.authenticatedRequest = async (_accountId, path) => {
    calls.push(path);
    if (path.startsWith('/marketplace/items/CBT')) return {
      ok: true, status: 200, payload: {
        id: 'CBT4218176737', site_id: 'CBT', owner_id: 445566,
        seller_id: 445566, category_id: 'CBT388338', family_id: '99887766',
        family_name: 'Synthetic organizer'
      }
    };
    if (path === '/marketplace/users/3385555772') return {
      ok: true, status: 200, payload: { marketplaces: [{ site_id: 'MCO', user_id: 445566 }] }
    };
    return { ok: false, status: 404, payload: {} };
  };

  const result = await service.inspectItem('account-1', 'CBT4218176737');

  assert.ok(calls.includes('/marketplace/users/3385555772'));
  assert.equal(result.globalItem.familyId, '99887766');
  assert.equal(result.globalItem.categoryId, 'CBT388338');
});
