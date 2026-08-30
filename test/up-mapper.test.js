import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInternalUpDraft, preflightProductFamily } from '../src/domain/up-mapper.js';

const colors = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'];
const product = {
  id: 'product-1',
  internalCode: 'TEST-MESH-ORGANIZER-001',
  originalTitle: '六色金属网格桌面收纳盒',
  familyName: 'Metal Mesh Desktop Organizer - 4 Compartments',
  purchasePriceCny: 12.13,
  packedWeightG: 650,
  rawAttributes: { material: 'Iron / Metal Mesh', compartments: 4 },
  targetSites: ['MLM', 'MCO', 'MLC']
};
const variants = colors.map((color, index) => ({
  id: `variant-${index + 1}`,
  sellerSku: `MESH-4C-${index + 1}`,
  color,
  stock: 10,
  participateInPublish: true
}));
const listings = [
  { site: 'MLM', title: 'Organizador De Escritorio De Malla Metálica', categoryId: 'MLM-DEMO', currency: 'MXN', price: 399 },
  { site: 'MCO', title: 'Organizador De Escritorio En Malla Metálica', categoryId: 'MCO-DEMO', currency: 'COP', price: 89900 },
  { site: 'MLC', title: 'Organizador De Escritorio Malla Metálica', categoryId: 'MLC-DEMO', currency: 'CLP', price: 19900 }
];
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
