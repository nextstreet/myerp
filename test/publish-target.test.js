import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCbtCategory } from '../src/domain/publish-target.js';

test('CBT category comparison rejects only a proven CBT mismatch', () => {
  assert.deepEqual(compareCbtCategory('CBT100001', 'CBT100001', 'MCO123'), {
    status: 'matched', existingCategoryId: 'CBT100001'
  });
  assert.deepEqual(compareCbtCategory('CBT100001', 'CBT999999', 'MCO123'), {
    status: 'mismatched', existingCategoryId: 'CBT999999'
  });
});

test('a local marketplace category is not falsely compared with a CBT category', () => {
  assert.deepEqual(compareCbtCategory('CBT100001', null, 'MCO123'), {
    status: 'not_comparable', existingCategoryId: 'MCO123'
  });
});
