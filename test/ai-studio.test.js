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
    baseFacts: { material: 'Metal', dimensions: { width: 24, height: 12 } },
    aiSuggestions: { material: 'Plastic', dimensions: { width: 25, depth: 12 }, compartments: 4 },
    manualFacts: { material: 'Iron', dimensions: { width: 24 } },
    confirmedFacts: { material: 'Iron / Metal Mesh', dimensions: { height: 12 } }
  });
  assert.equal(facts.material, 'Iron / Metal Mesh');
  assert.deepEqual(facts.dimensions, { width: 24, depth: 12, height: 12 });
  assert.equal(facts.compartments, 4);
});

test('generation facts exclude unconfirmed AI suggestions', () => {
  const facts = generationFacts({
    baseFacts: { productType: 'Organizer' },
    manualFacts: { material: 'Iron' },
    confirmedFacts: { compartments: 4 },
    aiSuggestions: { certification: 'Unverified', material: 'Plastic' }
  });
  assert.deepEqual(facts, { productType: 'Organizer', material: 'Iron', compartments: 4 });
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
    familyName: 'Metal Mesh Organizer',
    listings: {
      MLM: { title: 'Organizador de Escritorio de Malla Metálica', specificationsEnglish: { Material: 'Iron' } },
      MCO: { title: 'Organizador Metálico para Escritorio' },
      MLC: { title: 'Organizador de Escritorio Metálico' }
    }
  });
  assert.equal(result.listings.MLM.specificationsEnglish.Material, 'Iron');
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
