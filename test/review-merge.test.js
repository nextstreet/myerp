import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReviewFields, updateConfirmations } from '../src/domain/review-merge.js';

test('AI updates do not overwrite confirmed fields', () => {
  const result = mergeReviewFields(
    { title: 'Approved title', description: 'Old' },
    { title: 'AI title', description: 'New' },
    { title: true },
    ['title', 'description'],
    'ai'
  );
  assert.deepEqual(result.values, { title: 'Approved title', description: 'New' });
  assert.deepEqual(result.ignoredConfirmedFields, ['title']);
});

test('human updates may edit confirmed fields and confirmations can be removed', () => {
  const merged = mergeReviewFields({ title: 'A' }, { title: 'B' }, { title: true }, ['title'], 'human');
  assert.equal(merged.values.title, 'B');
  assert.deepEqual(updateConfirmations({ title: true }, ['title'], false), {});
});
