const WORKFLOW_MODES = Object.freeze({
  new_product: 'create',
  add_variants: 'update'
});

export function publishModeForWorkflow(workflowType) {
  const mode = WORKFLOW_MODES[workflowType];
  if (!mode) {
    const error = new Error('Unsupported product workflow');
    error.code = 'invalid_product_workflow';
    error.statusCode = 422;
    error.details = { workflowType, supportedWorkflows: Object.keys(WORKFLOW_MODES) };
    throw error;
  }
  return mode;
}

export function resolveWorkflowPublishMode(workflowType, requestedMode) {
  const expectedMode = publishModeForWorkflow(workflowType);
  const normalized = requestedMode === undefined || requestedMode === null || requestedMode === ''
    ? expectedMode
    : String(requestedMode).trim().toLowerCase();
  if (!['create', 'update'].includes(normalized)) {
    const error = new Error('publishMode must be create or update');
    error.code = 'invalid_publish_mode';
    error.statusCode = 400;
    throw error;
  }
  if (normalized !== expectedMode) {
    const error = new Error('The requested publish mode does not match this product workflow');
    error.code = 'publish_workflow_mismatch';
    error.statusCode = 409;
    error.details = { workflowType, expectedMode, requestedMode: normalized };
    throw error;
  }
  return expectedMode;
}

export const PRODUCT_WORKFLOWS = Object.freeze(Object.keys(WORKFLOW_MODES));
