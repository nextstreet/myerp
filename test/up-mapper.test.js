import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInternalUpDraft, preflightProductFamily } from '../src/domain/up-mapper.js';

const colors = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'];
const product = {
  id: 'product-1',
  internalCode: 'DEMO-PRODUCT-001',
  originalTitle: '非真实业务演示商品',
  familyName: 'Synthetic Demo Product',
  purchasePriceCny: 10,
  packedWeightG: 500,
  rawAttributes: { material: 'Demo material', featureCount: 3 },
  targetSites: ['MLM', 'MCO', 'MLC']
};
const variants = colors.map((color, index) => ({
  id: `variant-${index + 1}`,
  sellerSku: `DEMO-${index + 1}`,
  color,
  stock: 10,
  globalNetProceedsUsd: 12,
  participateInPublish: true
}));
const listings = [
  { site: 'MLM', title: 'Producto De Demostración', categoryId: 'MLM-DEMO', currency: 'USD', price: 19 },
  { site: 'MCO', title: 'Producto De Demostración', categoryId: 'MCO-DEMO', currency: 'USD', price: 18 },
  { site: 'MLC', title: 'Producto De Demostración', categoryId: 'MLC-DEMO', currency: 'USD', price: 17 }
].map((listing) => ({
  ...listing,
  familyName: 'Synthetic Demo Family',
  descriptionEnglish: 'Synthetic English description.',
  familyData: { globalCategoryId: 'CBT-DEMO', globalAttributes: {} },
  globalCategoryId: 'CBT-DEMO'
}));
const mediaByVariant = Object.fromEntries(variants.map((variant) => [variant.id, [`image-${variant.id}`]]));

test('six variants remain six User Products in one family', () => {
  const draft = buildInternalUpDraft({ product, variants, listings, mediaByVariant });
  assert.equal(draft.family.userProducts.length, 6);
  assert.equal(new Set(draft.family.userProducts.map((item) => item.sellerSku)).size, 6);
  assert.ok(draft.family.userProducts.every((item) => item.siteSales.length === 3));
});

test('preflight identifies a missing color image', () => {
  const incompleteMedia = { ...mediaByVariant };
  delete incompleteMedia['variant-6'];
  const result = preflightProductFamily({ product, variants, listings, mediaByVariant: incompleteMedia });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'missing_variant_image'));
});

test('preflight rejects duplicate Seller SKU', () => {
  const duplicate = variants.map((variant) => ({ ...variant }));
  duplicate[5].sellerSku = duplicate[0].sellerSku;
  const result = preflightProductFamily({ product, variants: duplicate, listings, mediaByVariant });
  assert.ok(result.errors.some((error) => error.code === 'duplicate_sku'));
});

test('structured color images require one exclusive publishable primary per variant', () => {
  const structuredMedia = Object.fromEntries(variants.map((variant) => [variant.id, [{
    id: `media-${variant.id}`,
    externalUrl: `https://images.example/${variant.id}.jpg`,
    isPrimary: true,
    validationStatus: 'ready'
  }]]));
  const complete = preflightProductFamily({ product, variants, listings, mediaByVariant: structuredMedia });
  assert.equal(complete.valid, true);

  structuredMedia['variant-6'][0].id = structuredMedia['variant-1'][0].id;
  const duplicatePrimary = preflightProductFamily({ product, variants, listings, mediaByVariant: structuredMedia });
  assert.ok(duplicatePrimary.errors.some((error) => error.code === 'shared_primary_variant_image'));
});

test('variant pricing must cover every selected variant for each site', () => {
  const partialListings = listings.map((listing) => ({
    ...listing,
    variantPrices: Object.fromEntries(variants.slice(0, 5).map((variant) => [variant.id, listing.price]))
  }));
  const result = preflightProductFamily({ product, variants, listings: partialListings, mediaByVariant });
  assert.equal(result.errors.filter((error) => error.code === 'missing_variant_price').length, 3);
  assert.ok(result.errors.every((error) => error.variantId !== 'variant-1' || error.code !== 'missing_variant_price'));
});

test('preflight requires an explicit global net proceeds amount for every User Product', () => {
  const incomplete = variants.map((variant) => ({ ...variant }));
  incomplete[4].globalNetProceedsUsd = null;
  const result = preflightProductFamily({ product, variants: incomplete, listings, mediaByVariant });
  assert.ok(result.errors.some((error) => error.code === 'missing_global_net_proceeds' && error.variantId === 'variant-5'));
});

test('preflight requires one short English family name across all sites', () => {
  const conflicting = listings.map((listing, index) => ({
    ...listing,
    familyName: index === 2 ? '不同规格名称' : listing.familyName
  }));
  const result = preflightProductFamily({ product, variants, listings: conflicting, mediaByVariant });
  assert.ok(result.errors.some((error) => error.code === 'conflicting_family_names'));
  assert.ok(result.errors.some((error) => error.code === 'family_name_must_be_english'));
});
