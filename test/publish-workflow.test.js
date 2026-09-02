import test from 'node:test';
import assert from 'node:assert/strict';
import { publishModeForWorkflow, resolveWorkflowPublishMode } from '../src/domain/publish-workflow.js';

test('new product workflow can only create a new Family', () => {
  assert.equal(publishModeForWorkflow('new_product'), 'create');
  assert.equal(resolveWorkflowPublishMode('new_product'), 'create');
  assert.throws(
    () => resolveWorkflowPublishMode('new_product', 'update'),
    (error) => error.code === 'publish_workflow_mismatch' && error.details.expectedMode === 'create'
  );
});

test('add variants workflow can only update an existing Family', () => {
  assert.equal(publishModeForWorkflow('add_variants'), 'update');
  assert.equal(resolveWorkflowPublishMode('add_variants'), 'update');
  assert.throws(
    () => resolveWorkflowPublishMode('add_variants', 'create'),
    (error) => error.code === 'publish_workflow_mismatch' && error.details.expectedMode === 'update'
  );
});

test('unknown workflows fail closed instead of silently creating a Family', () => {
  assert.throws(
    () => publishModeForWorkflow('legacy'),
    (error) => error.code === 'invalid_product_workflow' && error.statusCode === 422
  );
});
