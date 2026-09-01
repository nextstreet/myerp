export function compareCbtCategory(expectedCategoryId, globalCategoryId, localCategoryId = null) {
  const expected = String(expectedCategoryId ?? '').trim().toUpperCase();
  const global = String(globalCategoryId ?? '').trim().toUpperCase();
  const local = String(localCategoryId ?? '').trim().toUpperCase();
  if (!expected) return { status: 'not_requested', existingCategoryId: global || local || null };
  if (!global || !expected.startsWith('CBT') || !global.startsWith('CBT')) {
    return { status: 'not_comparable', existingCategoryId: global || local || null };
  }
  return { status: expected === global ? 'matched' : 'mismatched', existingCategoryId: global };
}
