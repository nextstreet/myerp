import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoLibreOAuthService, normalizeItemInspection, toSitelessUserProductId } from '../src/integrations/mercadolibre/oauth-service.js';

test('local User Product IDs normalize to the Siteless UP ID', () => {
  assert.equal(toSitelessUserProductId('MCOU4994489795'), 'U4994489795');
  assert.equal(toSitelessUserProductId('MLCU4994489795'), 'U4994489795');
  assert.equal(toSitelessUserProductId('CBTU4994489795'), 'U4994489795');
  assert.equal(toSitelessUserProductId('U4994489795'), 'U4994489795');
  assert.equal(toSitelessUserProductId(null), null);
});

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
    globalItem: {
      id: 'CBT1234567890',
      family_name: 'Metal Mesh Desktop Organizer',
      siteless_user_product_id: 'U123'
    },
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
  assert.equal(result.globalItem.sitelessUserProductId, 'U123');
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
    if (path.startsWith('/marketplace/items/MCO')) {
      return {
        ok: true,
        status: 200,
        payload: {
          id: 'MCO4393187474',
          site_id: 'MCO',
          seller_id: 123456,
          owner_id: 3385555772,
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
          family_name: 'Metal Mesh Desktop Organizer',
          parent_user_product_id: 'CBTU123'
        }
      };
    }
    if (path === '/global/user-products/U123') {
      return {
        ok: true,
        status: 200,
        payload: { id: 'U123', family_id: 'family-1', family_name: 'Metal Mesh Desktop Organizer' }
      };
    }
    return { ok: false, status: 403, payload: {} };
  };

  const result = await service.inspectItem('account-1', 'MCO4393187474');

  assert.equal(calls[0], '/marketplace/items/MCO4393187474?include_attributes=all');
  assert.ok(calls.includes('/marketplace/items/CBT1234567890?include_attributes=all'));
  assert.ok(calls.includes('/global/user-products/U123'));
  assert.equal(result.item.cbtItemId, 'CBT1234567890');
  assert.equal(result.userProduct.familyId, 'family-1');
  assert.equal(result.description.plainText, 'Inline English description');
});
