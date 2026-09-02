const SITES = Object.freeze(['MLM', 'MCO', 'MLC']);

function normalizedValues(variants, getter) {
  return new Set(variants.map(getter).map((value) => String(value ?? '').trim()).filter(Boolean));
}

export function variantAxes(variants = []) {
  const selected = variants.filter((variant) => variant.participateInPublish !== false);
  const axes = [];
  if (normalizedValues(selected, (variant) => variant.color).size > 1) axes.push('COLOR');
  if (normalizedValues(selected, (variant) => variant.size).size > 1) axes.push('SIZE');
  const otherIds = new Set(selected.flatMap((variant) => Object.keys(variant.otherAttributes ?? {})));
  for (const id of otherIds) {
    if (normalizedValues(selected, (variant) => variant.otherAttributes?.[id]).size > 1) {
      axes.push(String(id).trim().toUpperCase());
    }
  }
  return [...new Set(axes)];
}

export function assessVariationSupport(variants, variationAttributes = []) {
  const axes = variantAxes(variants);
  const allowed = new Set(variationAttributes.map((attribute) => String(attribute.id ?? '').trim().toUpperCase()));
  const missingAxes = axes.filter((axis) => !allowed.has(axis));
  return {
    isMultiVariant: variants.filter((variant) => variant.participateInPublish !== false).length > 1,
    requiredAxes: axes,
    allowedAxes: [...allowed],
    missingAxes,
    supported: axes.length > 0 && missingAxes.length === 0
  };
}

export function sameVariantAxes(left = [], right = []) {
  const a = [...new Set(left.map((value) => String(value).toUpperCase()))].sort();
  const b = [...new Set(right.map((value) => String(value).toUpperCase()))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function validateCategoryQueryPlan(output, selectedSites = SITES) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Invalid category query plan');
  const sites = {};
  for (const site of selectedSites) {
    const item = output.sites?.[site];
    const query = String(item?.query ?? '').trim();
    if (!query || query.length > 160) {
      const error = new Error(`AI category query is invalid for ${site}`);
      error.code = 'ai_output_invalid'; error.statusCode = 502; throw error;
    }
    sites[site] = { query, rationale: String(item?.rationale ?? '').trim().slice(0, 500) };
  }
  return { sites };
}

export function categoryQueryPrompt({ facts, selectedSites = SITES }) {
  return {
    system: [
      'You prepare category-search queries for Mercado Libre Mexico, Colombia and Chile.',
      'Use only verified product facts. Return concise natural Spanish product-type queries, not titles or marketing text.',
      'Do not invent brand, material, certification, function or compatibility. Return one JSON object only.'
    ].join(' '),
    prompt: JSON.stringify({
      task: 'Create one category discovery query per selected Mercado Libre site.',
      selectedSites,
      expectedShape: { sites: Object.fromEntries(selectedSites.map((site) => [site, { query: '', rationale: '' }])) },
      confirmedProductFacts: facts
    }, null, 2)
  };
}

export { SITES as CATEGORY_ASSESSMENT_SITES };
