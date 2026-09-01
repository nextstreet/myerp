import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveFacts,
  generationFacts,
  validateFactExtraction,
  validateImagePlan,
  validateListingDrafts
} from '../src/domain/ai-studio.js';
import { parseJsonOutput } from '../src/integrations/ai/provider.js';

test('effective facts keep confirmed and manual values above AI suggestions', () => {
  const facts = effectiveFacts({
    baseFacts: { material: 'Demo A', dimensions: { width: 20, height: 10 } },
    aiSuggestions: { material: 'Demo B', dimensions: { width: 21, depth: 8 }, featureCount: 3 },
    manualFacts: { material: 'Demo C', dimensions: { width: 20 } },
    confirmedFacts: { material: 'Confirmed demo material', dimensions: { height: 10 } }
  });
  assert.equal(facts.material, 'Confirmed demo material');
  assert.deepEqual(facts.dimensions, { width: 20, depth: 8, height: 10 });
  assert.equal(facts.featureCount, 3);
});

test('generation facts exclude unconfirmed AI suggestions', () => {
  const facts = generationFacts({
    baseFacts: { productType: 'Demo product' },
    manualFacts: { material: 'Demo material' },
    confirmedFacts: { featureCount: 3 },
    aiSuggestions: { certification: 'Unverified', material: 'Plastic' }
  });
  assert.deepEqual(facts, { productType: 'Demo product', material: 'Demo material', featureCount: 3 });
});

test('AI JSON parser accepts plain and fenced JSON only', () => {
  assert.deepEqual(parseJsonOutput('{"ok":true}'), { ok: true });
  assert.deepEqual(parseJsonOutput('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseJsonOutput('explanation {"ok":true}'), { code: 'ai_output_invalid' });
  assert.throws(() => parseJsonOutput('[]'), { code: 'ai_output_invalid' });
});

test('fact extraction normalizes optional sections', () => {
  assert.deepEqual(validateFactExtraction({ suggestions: { compartments: 4 } }), {
    suggestions: { compartments: 4 }, confidence: {}, evidence: {}, warnings: []
  });
});

test('listing drafts require every selected site title', () => {
  const result = validateListingDrafts({
    familyName: 'Synthetic Demo Product',
    listings: {
      MLM: { title: 'Producto De Demostración', specificationsEnglish: { Material: 'Demo' } },
      MCO: { title: 'Producto De Demostración' },
      MLC: { title: 'Producto De Demostración' }
    }
  });
  assert.equal(result.listings.MLM.specificationsEnglish.Material, 'Demo');
  assert.throws(() => validateListingDrafts({ listings: { MLM: { title: 'Only one' } } }), { code: 'ai_output_invalid' });
});

test('image plan enforces a 7 to 10 image gallery', () => {
  const images = Array.from({ length: 7 }, (_, index) => ({
    role: index ? 'feature' : 'white_background', title: `Image ${index + 1}`, prompt: 'Keep exact product'
  }));
  const result = validateImagePlan({ images });
  assert.equal(result.images.length, 7);
  assert.equal(result.images[0].order, 1);
  assert.throws(() => validateImagePlan({ images: images.slice(0, 6) }), { code: 'ai_output_invalid' });
});
