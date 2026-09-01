const SITE_NAMES = Object.freeze({ MLM: 'Mexico', MCO: 'Colombia', MLC: 'Chile' });

export function preflightProductFamily({ product, variants, listings = [], mediaByVariant = {} }) {
  const errors = [];
  const warnings = [];
  const selected = variants.filter((variant) => variant.participateInPublish !== false);
  const skuCounts = new Map();
  const primaryMediaOwners = new Map();

  for (const variant of selected) {
    const sku = String(variant.sellerSku ?? '').trim();
    if (!sku) errors.push({ code: 'missing_sku', variantId: variant.id });
    else skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    if (!variant.color && !variant.size && !Object.keys(variant.otherAttributes ?? {}).length) {
      errors.push({ code: 'missing_variant_attribute', variantId: variant.id, sellerSku: sku });
    }
    if (!Number.isFinite(Number(variant.globalNetProceedsUsd)) || Number(variant.globalNetProceedsUsd) <= 0) {
      errors.push({ code: 'missing_global_net_proceeds', variantId: variant.id, sellerSku: sku });
    }
    const images = mediaByVariant[variant.id] ?? variant.images ?? [];
    if (!images.length) errors.push({ code: 'missing_variant_image', variantId: variant.id, sellerSku: sku });
    else if (images.length < 7) warnings.push({ code: 'variant_gallery_below_recommended_minimum', variantId: variant.id, sellerSku: sku, count: images.length });
    if (images.length > 10) errors.push({ code: 'variant_gallery_exceeds_maximum', variantId: variant.id, sellerSku: sku, count: images.length });
    const structuredImages = images.filter((image) => image && typeof image === 'object');
    if (structuredImages.length) {
      const primary = structuredImages.find((image) => image.isPrimary === true);
      if (!primary) errors.push({ code: 'missing_primary_variant_image', variantId: variant.id, sellerSku: sku });
      else {
        const mediaId = primary.id ?? primary.mediaId;
        const previousOwner = primaryMediaOwners.get(mediaId);
        if (previousOwner && previousOwner !== variant.id) {
          errors.push({ code: 'shared_primary_variant_image', mediaId, variantIds: [previousOwner, variant.id] });
        } else if (mediaId) primaryMediaOwners.set(mediaId, variant.id);
      }
      if (!structuredImages.some((image) => image.storageKey || image.externalUrl || image.mercadoPictureId)) {
        errors.push({ code: 'variant_image_source_missing', variantId: variant.id, sellerSku: sku });
      }
      if (structuredImages.some((image) => image.validationStatus === 'rejected')) {
        errors.push({ code: 'rejected_variant_image', variantId: variant.id, sellerSku: sku });
      }
      if (structuredImages.some((image) => image.validationStatus && image.validationStatus !== 'ready')) {
        errors.push({ code: 'unreviewed_variant_image', variantId: variant.id, sellerSku: sku });
      }
    }
  }

  for (const [sku, count] of skuCounts) {
    if (count > 1) errors.push({ code: 'duplicate_sku', sellerSku: sku, count });
  }
  if (!selected.length) errors.push({ code: 'no_variants_selected' });

  for (const listing of listings) {
    if (!SITE_NAMES[listing.site]) errors.push({ code: 'unsupported_site', site: listing.site });
    if (!listing.title) errors.push({ code: 'missing_title', site: listing.site });
    if (listing.currency !== 'USD') errors.push({ code: 'global_selling_currency_must_be_usd', site: listing.site, currency: listing.currency });
    if (!listing.categoryId) warnings.push({ code: 'missing_category', site: listing.site });
    const variantPrices = listing.variantPrices ?? {};
    const hasVariantPrices = Object.keys(variantPrices).length > 0;
    if (hasVariantPrices) {
      for (const variant of selected) {
        const price = Number(variantPrices[variant.id]);
        if (!Number.isFinite(price) || price <= 0) {
          errors.push({ code: 'missing_variant_price', site: listing.site, variantId: variant.id, sellerSku: variant.sellerSku });
        }
      }
    } else if (!Number.isFinite(Number(listing.price)) || Number(listing.price) <= 0) {
      errors.push({ code: 'missing_price', site: listing.site });
    }
  }

  const familyNames = new Set(listings.map((listing) => String(listing.familyName ?? '').trim()).filter(Boolean));
  if (!familyNames.size) errors.push({ code: 'missing_family_name' });
  if (familyNames.size > 1) errors.push({ code: 'conflicting_family_names', values: [...familyNames] });
  for (const familyName of familyNames) {
    if (familyName.length > 60) errors.push({ code: 'family_name_too_long', length: familyName.length, maximum: 60 });
    if (/[\u3400-\u9fff]/u.test(familyName)) errors.push({ code: 'family_name_must_be_english' });
  }
  const globalCategoryIds = new Set(listings.map((listing) =>
    String(listing.globalCategoryId ?? listing.familyData?.globalCategoryId ?? '').trim()
  ).filter(Boolean));
  if (!globalCategoryIds.size) errors.push({ code: 'missing_global_category' });
  if (globalCategoryIds.size > 1) errors.push({ code: 'conflicting_global_categories', values: [...globalCategoryIds] });
  const descriptions = new Set(listings.map((listing) => String(listing.descriptionEnglish ?? '').trim()).filter(Boolean));
  if (!descriptions.size) errors.push({ code: 'missing_english_description' });
  if (descriptions.size > 1) errors.push({ code: 'conflicting_english_descriptions' });
  const globalAttributeSets = new Set(listings
    .map((listing) => listing.familyData?.globalAttributes)
    .filter((value) => value && Object.keys(value).length)
    .map((value) => JSON.stringify(value, Object.keys(value).sort())));
  if (globalAttributeSets.size > 1) errors.push({ code: 'conflicting_global_attributes' });
  const globalSaleTermSets = new Set(listings
    .map((listing) => listing.familyData?.globalSaleTerms)
    .filter((value) => Array.isArray(value) && value.length)
    .map((value) => JSON.stringify(value)));
  if (globalSaleTermSets.size > 1) errors.push({ code: 'conflicting_global_sale_terms' });

  // Normalize targetSites: node-postgres may deliver the enum[] column as a
  // text literal like "{MLM,MCO,MLC}"; ensure we always iterate a real array.
  const rawSites = product.targetSites ?? ['MLM', 'MCO', 'MLC'];
  const targetSites = Array.isArray(rawSites)
    ? rawSites
    : String(rawSites).replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const site of targetSites) {
    if (!listings.some((listing) => listing.site === site)) {
      errors.push({ code: 'missing_site_listing', site });
    }
  }

  return {
    valid: errors.length === 0,
    summary: {
      productId: product.id,
      familyName: product.familyName ?? product.originalTitle,
      targetSites,
      variantCount: selected.length,
      listingCount: listings.length,
      globalNetProceedsUsd: selected.map((variant) => ({
        sellerSku: variant.sellerSku,
        amount: Number(variant.globalNetProceedsUsd)
      })),
      imageCount: new Set(selected.flatMap((variant) =>
        (mediaByVariant[variant.id] ?? variant.images ?? []).map((image) =>
          image && typeof image === 'object' ? image.id ?? image.mediaId : image
        )
      )).size
    },
    errors,
    warnings
  };
}

/**
 * Builds an internal, site-neutral UP draft. The Mercado Libre adapter is
 * responsible for converting this model to the current official site schema.
 */
export function buildInternalUpDraft({ product, variants, listings, mediaByVariant = {} }) {
  const preflight = preflightProductFamily({ product, variants, listings, mediaByVariant });
  if (!preflight.valid) {
    const error = new Error('Product family failed preflight');
    error.code = 'preflight_failed';
    error.details = preflight;
    throw error;
  }

  const selected = variants.filter((variant) => variant.participateInPublish !== false);
  return {
    schemaVersion: 'internal-up-draft/v1',
    product: {
      internalProductId: product.id,
      internalCode: product.internalCode,
      originalTitle: product.originalTitle,
      sharedAttributes: product.rawAttributes ?? {}
    },
    family: {
      name: product.familyName ?? product.originalTitle,
      userProducts: selected.map((variant) => ({
        internalVariantId: variant.id,
        sellerSku: variant.sellerSku,
        variationAttributes: {
          ...(variant.color ? { color: variant.color } : {}),
          ...(variant.size ? { size: variant.size } : {}),
          ...(variant.otherAttributes ?? {})
        },
        purchasePriceCny: variant.purchasePriceCny ?? product.purchasePriceCny,
        packedWeightG: variant.packedWeightG ?? product.packedWeightG,
        stock: variant.stock ?? 0,
        globalNetProceedsUsd: variant.globalNetProceedsUsd,
        imageIds: mediaByVariant[variant.id] ?? variant.images ?? [],
        siteSales: listings.map((listing) => ({
          site: listing.site,
          title: listing.title,
          categoryId: listing.categoryId,
          currency: listing.currency,
          price: listing.variantPrices?.[variant.id] ?? listing.price,
          attributes: listing.requiredAttributes ?? {}
        }))
      }))
    }
  };
}
