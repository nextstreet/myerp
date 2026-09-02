import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessVariationSupport,
  sameVariantAxes,
  validateCategoryQueryPlan,
  variantAxes
} from '../src/domain/category-assessment.js';

const colors = ['Black', 'White', 'Gray', 'Green', 'Pink', 'Cream'].map((color, index) => ({
  id: `v${index}`, sellerSku: `SKU-${index}`, color, participateInPublish: true
}));

test('six colors require the COLOR variation axis', () => {
  assert.deepEqual(variantAxes(colors), ['COLOR']);
  assert.deepEqual(assessVariationSupport(colors, [{ id: 'COLOR' }]), {
    isMultiVariant: true,
    requiredAxes: ['COLOR'],
    allowedAxes: ['COLOR'],
    missingAxes: [],
    supported: true
  });
});

test('a category without COLOR support rejects a six-color product', () => {
  const result = assessVariationSupport(colors, [{ id: 'SIZE' }]);
  assert.equal(result.supported, false);
  assert.deepEqual(result.missingAxes, ['COLOR']);
});

test('all independently varying axes must be supported', () => {
  const variants = [
    { color: 'Black', size: 'Small' },
    { color: 'White', size: 'Large' }
  ];
  assert.deepEqual(variantAxes(variants), ['COLOR', 'SIZE']);
  assert.equal(assessVariationSupport(variants, [{ id: 'COLOR' }]).supported, false);
});

test('variants excluded from publication do not make category decisions stale or stricter', () => {
  const variants = [
    { color: 'Black', participateInPublish: true },
    { color: 'White', participateInPublish: true },
    { color: 'Red', size: 'Large', participateInPublish: false }
  ];
  assert.deepEqual(variantAxes(variants), ['COLOR']);
  assert.equal(assessVariationSupport(variants, [{ id: 'COLOR' }]).supported, true);
});

test('category query plans require one bounded query per selected site', () => {
  const plan = validateCategoryQueryPlan({ sites: {
    MLM: { query: 'organizador de archivos', rationale: 'type' },
    MCO: { query: 'organizador de archivos', rationale: 'type' },
    MLC: { query: 'organizador de archivos', rationale: 'type' }
  } });
  assert.equal(plan.sites.MCO.query, 'organizador de archivos');
  assert.throws(() => validateCategoryQueryPlan({ sites: { MLM: { query: '' } } }), /MLM/);
});

test('variant-axis comparison detects a stale category assessment', () => {
  assert.equal(sameVariantAxes(['COLOR'], ['color']), true);
  assert.equal(sameVariantAxes(['COLOR'], ['COLOR', 'SIZE']), false);
});
