const SITES = Object.freeze(['MLM', 'MCO', 'MLC']);

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertFactObject(value, name) {
  if (!isPlainObject(value)) {
    const error = new Error(`${name} must be a JSON object`);
    error.code = 'validation_error';
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function effectiveFacts({ baseFacts = {}, manualFacts = {}, aiSuggestions = {}, confirmedFacts = {} }) {
  // Confirmed human facts always win. AI is only a fallback and can never
  // overwrite either manually supplied or explicitly confirmed values.
  return deepMerge(deepMerge(deepMerge({}, aiSuggestions), baseFacts), manualFacts, confirmedFacts);
}

export function generationFacts({ baseFacts = {}, manualFacts = {}, confirmedFacts = {} }) {
  // Unconfirmed AI suggestions are intentionally not accepted by this API.
  return deepMerge(baseFacts, manualFacts, confirmedFacts);
}

export function deepMerge(...values) {
  const result = {};
  for (const value of values) {
    if (!isPlainObject(value)) continue;
    for (const [key, next] of Object.entries(value)) {
      if (isPlainObject(next) && isPlainObject(result[key])) result[key] = deepMerge(result[key], next);
      else result[key] = structuredClone(next);
    }
  }
  return result;
}

export function productBaseFacts(product) {
  return {
    originalTitle: product.originalTitle,
    categoryHint: product.categoryHint,
    purchasePriceCny: product.purchasePriceCny,
    packedWeightG: product.packedWeightG,
    productDimensions: product.productDimensions,
    packageDimensions: product.packageDimensions,
    rawAttributes: product.rawAttributes,
    notes: product.notes,
    targetSites: product.targetSites,
    variants: (product.variants || []).map((variant) => ({
      sellerSku: variant.sellerSku,
      color: variant.color,
      size: variant.size,
      otherAttributes: variant.otherAttributes,
      packedWeightG: variant.packedWeightG,
      purchasePriceCny: variant.purchasePriceCny
    }))
  };
}

export function validateFactExtraction(output) {
  assertFactObject(output, 'AI fact extraction output');
  const suggestions = assertFactObject(output.suggestions ?? {}, 'suggestions');
  const confidence = assertFactObject(output.confidence ?? {}, 'confidence');
  const evidence = assertFactObject(output.evidence ?? {}, 'evidence');
  return { suggestions, confidence, evidence, warnings: Array.isArray(output.warnings) ? output.warnings : [] };
}

export function validateListingDrafts(output, selectedSites = SITES) {
  assertFactObject(output, 'AI listing output');
  const listings = assertFactObject(output.listings ?? {}, 'listings');
  const clean = {};
  for (const site of selectedSites) {
    const item = assertFactObject(listings[site] ?? {}, `listings.${site}`);
    clean[site] = {
      title: String(item.title ?? '').trim(),
      titleAlternatives: Array.isArray(item.titleAlternatives)
        ? item.titleAlternatives.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 3) : [],
      descriptionEnglish: String(item.descriptionEnglish ?? '').trim(),
      specificationsEnglish: isPlainObject(item.specificationsEnglish) ? item.specificationsEnglish : {},
      attributeSuggestions: isPlainObject(item.attributeSuggestions) ? item.attributeSuggestions : {},
      excludedClaims: Array.isArray(item.excludedClaims) ? item.excludedClaims.map(String).slice(0, 20) : []
    };
    if (!clean[site].title) {
      const error = new Error(`AI listing output is missing title for ${site}`);
      error.code = 'ai_output_invalid';
      error.statusCode = 502;
      throw error;
    }
  }
  return { familyName: String(output.familyName ?? '').trim(), listings: clean };
}

export function validateImagePlan(output) {
  assertFactObject(output, 'AI image plan output');
  if (!Array.isArray(output.images) || output.images.length < 7 || output.images.length > 10) {
    const error = new Error('AI image plan must contain between 7 and 10 images');
    error.code = 'ai_output_invalid';
    error.statusCode = 502;
    throw error;
  }
  const images = output.images.map((item, index) => ({
      order: index + 1,
      role: String(item?.role ?? 'feature').trim(),
      title: String(item?.title ?? `Image ${index + 1}`).trim(),
      prompt: String(item?.prompt ?? '').trim(),
      useRealProductCutout: item?.useRealProductCutout !== false,
      variantScope: String(item?.variantScope ?? 'shared').trim(),
      textPolicy: String(item?.textPolicy ?? 'neutral Spanish; no promotional claims').trim()
    }));
  if (images.some((item) => !item.prompt)) {
    const error = new Error('Every AI image plan item must contain a prompt');
    error.code = 'ai_output_invalid';
    error.statusCode = 502;
    throw error;
  }
  return { images };
}

export function factExtractionPrompt({ product, selectedMedia }) {
  return {
    system: [
      'You extract verifiable ecommerce product facts from user text and product images.',
      'Return one JSON object only. Never infer certification, brand, material, load capacity, safety, compatibility or dimensions without evidence.',
      'Keep uncertain observations in warnings, not as facts. Use English canonical values except source-language names.',
      'Evidence keys should contain arrays of {mediaId,note}. Confidence values must be numbers from 0 to 1.'
    ].join(' '),
    prompt: JSON.stringify({
      task: 'Extract product facts without overwriting human-confirmed information.',
      expectedShape: {
        suggestions: {
          productType: '', materials: [], structure: [], dimensions: {}, packageDimensions: {},
          packedWeightG: null, colors: [], sizes: [], functions: [], usageScenarios: [],
          includedItems: [], visibleDetails: [], claimsToVerify: []
        },
        confidence: { productType: 0 },
        evidence: { productType: [{ mediaId: '', note: '' }] },
        warnings: []
      },
      product,
      media: selectedMedia.map((item) => ({ id: item.id, filename: item.originalFilename, role: item.role }))
    }, null, 2)
  };
}

export function listingCopyPrompt({ facts, categoryRequirements, selectedSites }) {
  return {
    system: [
      'You create Mercado Libre listing drafts for Mexico (MLM), Colombia (MCO), and Chile (MLC).',
      'Titles must be natural local Spanish. Description and specification values must be English.',
      'Use platform enum values exactly when category metadata supplies them.',
      'Do not invent brand, model, certification, material, performance, warranty or compatibility claims.',
      'Return one JSON object only. Every selected site must be present.'
    ].join(' '),
    prompt: JSON.stringify({
      task: 'Create editable drafts. Keep country titles independent and explain risky claims through excludedClaims.',
      selectedSites,
      expectedShape: {
        familyName: '',
        listings: Object.fromEntries(selectedSites.map((site) => [site, {
          title: '', titleAlternatives: [], descriptionEnglish: '', specificationsEnglish: {},
          attributeSuggestions: {}, excludedClaims: []
        }]))
      },
      confirmedProductFacts: facts,
      officialCategoryRequirements: categoryRequirements
    }, null, 2)
  };
}

export function imagePlanPrompt({ facts }) {
  return {
    system: [
      'You design a 7 to 10 image ecommerce gallery using a real product cutout as the source of truth.',
      'Never alter product structure, proportions, compartment count, color or dimensions.',
      'Image 1 must be a clean white-background hero with no text, logo, border or watermark.',
      'Secondary images may use neutral Spanish labels but no price, discount, unsupported claims or competitor marks.',
      'Return one JSON object only.'
    ].join(' '),
    prompt: JSON.stringify({
      task: 'Create a production-ready gallery plan and detailed prompts.',
      expectedShape: { images: [{ role: 'white_background', title: '', prompt: '', useRealProductCutout: true, variantScope: 'per_color', textPolicy: 'no text' }] },
      confirmedProductFacts: facts
    }, null, 2)
  };
}

export function whiteBackgroundPrompt(facts) {
  return [
    'Create a marketplace-ready pure white background product image from the supplied reference.',
    'Preserve the exact product geometry, proportions, compartment count, mesh pattern, material appearance and color.',
    'Remove only the original background and unrelated objects. Use a subtle realistic contact shadow.',
    'Do not add text, logo, border, watermark, accessories or new product features.',
    `Confirmed facts: ${JSON.stringify(facts)}`
  ].join(' ');
}

export { SITES as AI_STUDIO_SITES };
