import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMediaForVariants } from '../src/domain/media-selection.js';

test('effective media uses only explicit per-variant selections', () => {
  const variants = [{ id: 'black' }, { id: 'white' }];
  const row = (media, variant = null, primary = false) => ({
    media_id: media, variant_id: variant, is_primary: primary, original_filename: `${media}.png`
  });
  const result = effectiveMediaForVariants({
    variants,
    mediaRows: [row('black-main', 'black', true), row('white-main', 'white', true), row('shared-1', 'black'), row('shared-1', 'white'), row('shared-2', 'black')]
  });
  assert.deepEqual(result.black.map((item) => item.id), ['black-main', 'shared-1', 'shared-2']);
  assert.deepEqual(result.white.map((item) => item.id), ['white-main', 'shared-1']);
});

test('effective media caps the final API selection at ten pictures', () => {
  const mediaRows = Array.from({ length: 12 }, (_, index) => ({ media_id: `m${index}`, variant_id: 'v1' }));
  const result = effectiveMediaForVariants({ variants: [{ id: 'v1' }], mediaRows });
  assert.equal(result.v1.length, 10);
});
