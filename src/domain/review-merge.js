export function mergeReviewFields(current, patch, confirmedFields = {}, allowedFields = [], source = 'human') {
  const next = { ...current };
  const ignoredConfirmedFields = [];
  for (const field of allowedFields) {
    if (!Object.hasOwn(patch ?? {}, field)) continue;
    if (source === 'ai' && confirmedFields?.[field] === true) {
      ignoredConfirmedFields.push(field);
      continue;
    }
    next[field] = patch[field];
  }
  return { values: next, ignoredConfirmedFields };
}

export function updateConfirmations(current = {}, fields = [], confirmed = true) {
  const next = { ...current };
  for (const field of fields) {
    if (confirmed) next[field] = true;
    else delete next[field];
  }
  return next;
}
