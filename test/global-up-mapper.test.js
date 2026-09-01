import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalUpFamilyPreview } from '../src/integrations/mercadolibre/global-up-mapper.js';

test('Global UP preview keeps six variants and three independent site conditions', () => {
  const variants = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'].map((color, index) => ({
    id: `v${index}`, sellerSku: `SKU-${index}`, color, stock: 10,
    globalNetProceedsUsd: 12 + index, participateInPublish: true
  }));
  const listings = [
    { site: 'MLM', title: 'Titulo MX', categoryId: 'MLM1', globalCategoryId: 'CBT1', currency: 'USD', price: 19 },
    { site: 'MCO', title: 'Titulo CO', categoryId: 'MCO1', globalCategoryId: 'CBT1', currency: 'USD', price: 18 },
    { site: 'MLC', title: 'Titulo CL', categoryId: 'MLC1', globalCategoryId: 'CBT1', currency: 'USD', price: 17 }
  ];
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Demo', familyName: 'Synthetic Demo Product', rawAttributes: {} },
    variants,
    listings: listings.map((listing) => ({
      ...listing,
      descriptionEnglish: 'Synthetic English description.',
      familyData: {
        globalAttributes: { ITEM_CONDITION: { values: [{ id: '2230284', name: 'New' }] } },
        globalSaleTerms: [{ id: 'WARRANTY_TYPE', value_id: '6150835', value_name: 'No warranty' }]
      }
    })),
    mediaByVariant: Object.fromEntries(variants.map((variant) => [variant.id, [{ mercadoPictureId: `PIC-${variant.id}` }]]))
  });
  assert.equal(preview.request.endpoint, '/global/user-products/families');
  assert.equal(preview.request.body.length, 6);
  assert.ok(preview.request.body.every((item) => item.sites_to_sell.length === 3));
  assert.ok(preview.request.body.every((item) => item.category_id === 'CBT1'));
  assert.ok(preview.request.body.every((item) => !Object.hasOwn(item, 'title')));
  assert.ok(preview.request.body.every((item) => !Object.hasOwn(item, 'variations')));
  assert.ok(preview.request.body.every((item) => item.global_net_proceeds > 0));
  assert.ok(preview.request.body.every((item) => item.available_quantity === 10));
  assert.ok(preview.request.body.every((item) => item.description.plain_text === 'Synthetic English description.'));
  assert.ok(preview.request.body.every((item) => item.sites_to_sell.every((site) => Object.keys(site).sort().join(',') === 'logistic_type,site_id')));
  assert.equal(new Set(preview.summary.sellerSkus).size, 6);
  assert.ok(preview.request.body.every((item) => item.pictures.length === 1));
  assert.ok(preview.request.body.every((item) => item.pictures.every((picture) => Object.keys(picture).join(',') === 'id')));
  assert.ok(preview.request.body.every((item) => item.attributes.find((attribute) => attribute.id === 'SELLER_SKU')));
  assert.ok(preview.request.body.every((item) => item.attributes.find((attribute) => attribute.id === 'ITEM_CONDITION')?.values?.[0]?.id === '2230284'));
  assert.ok(preview.request.body.every((item) => item.sale_terms[0].id === 'WARRANTY_TYPE'));
});

test('Global UP preview ignores an empty site sale-terms array', () => {
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Synthetic organizer', familyName: 'Synthetic organizer' },
    variants: [{
      id: 'v1', sellerSku: 'SKU-WHITE', color: 'White', stock: 10,
      globalNetProceedsUsd: 6, participateInPublish: true
    }],
    listings: [
      {
        site: 'MLC', currency: 'USD', globalCategoryId: 'CBT388338',
        descriptionEnglish: 'Synthetic description.',
        familyData: { globalSaleTerms: [] }
      },
      {
        site: 'MCO', currency: 'USD', globalCategoryId: 'CBT388338',
        descriptionEnglish: 'Synthetic description.',
        familyData: {
          globalSaleTerms: [{
            id: 'WARRANTY_TYPE', value_id: '6150835', value_name: 'No warranty'
          }]
        }
      }
    ],
    mediaByVariant: { v1: [{ mercadoPictureId: 'PIC-WHITE' }] }
  });

  assert.deepEqual(preview.request.body[0].sale_terms, [{
    id: 'WARRANTY_TYPE', value_id: '6150835', value_name: 'No warranty'
  }]);
});

test('existing Family preview targets the Siteless Family with PUT', () => {
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Synthetic organizer', familyName: 'Synthetic organizer' },
    variants: [{ id: 'v1', sellerSku: 'SKU-WHITE', color: 'White', stock: 10,
      globalNetProceedsUsd: 6, participateInPublish: true }],
    listings: [{ site: 'MCO', currency: 'USD', globalCategoryId: 'CBT388338',
      descriptionEnglish: 'Synthetic description.', familyData: {} }],
    mediaByVariant: { v1: [{ mercadoPictureId: 'PIC-WHITE' }] },
    publishTarget: { mode: 'update', sitelessFamilyId: '123456789', sourceItemId: 'CBT123' }
  });

  assert.equal(preview.request.method, 'PUT');
  assert.equal(preview.request.endpoint, '/global/user-products/families/123456789');
  assert.equal(preview.summary.publishMode, 'update');
  assert.equal(preview.summary.sitelessFamilyId, '123456789');
});

test('existing Family preview preserves the provider-read Family name', () => {
  const preview = buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Draft name', familyName: 'Changed draft name' },
    variants: [{ id: 'v1', sellerSku: 'SKU-WHITE', color: 'White', stock: 10,
      globalNetProceedsUsd: 6, participateInPublish: true }],
    listings: [{ site: 'MCO', currency: 'USD', globalCategoryId: 'CBT388338',
      descriptionEnglish: 'Synthetic description.', familyData: {} }],
    mediaByVariant: { v1: [{ mercadoPictureId: 'PIC-WHITE' }] },
    publishTarget: {
      mode: 'update', sitelessFamilyId: '123456789', sourceItemId: 'CBT123',
      existingFamilyName: 'Original Family Name'
    }
  });

  assert.equal(preview.request.body[0].family_name, 'Original Family Name');
  assert.equal(preview.summary.familyName, 'Original Family Name');
  assert.equal(preview.summary.requestedFamilyName, 'Changed draft name');
  assert.equal(preview.summary.familyNamePreserved, true);
});

test('existing Family preview refuses to fall back to creating a Family', () => {
  assert.throws(() => buildGlobalUpFamilyPreview({
    product: { originalTitle: 'Synthetic organizer' }, variants: [], listings: [],
    publishTarget: { mode: 'update' }
  }), { code: 'existing_family_id_required' });
});
