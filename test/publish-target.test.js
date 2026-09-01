import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCbtCategory } from '../src/domain/publish-target.js';

test('CBT category comparison rejects only a proven CBT mismatch', () => {
  assert.deepEqual(compareCbtCategory('CBT388338', 'CBT388338', 'MCO123'), {
    status: 'matched', existingCategoryId: 'CBT388338'
  });
  assert.deepEqual(compareCbtCategory('CBT388338', 'CBT999999', 'MCO123'), {
    status: 'mismatched', existingCategoryId: 'CBT999999'
  });
});

test('a local marketplace category is not falsely compared with a CBT category', () => {
  assert.deepEqual(compareCbtCategory('CBT388338', null, 'MCO123'), {
    status: 'not_comparable', existingCategoryId: 'MCO123'
  });
});
