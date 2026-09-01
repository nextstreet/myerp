const SITE_NAMES = Object.freeze({ MLM: 'Mexico', MCO: 'Colombia', MLC: 'Chile' });

function normalizedAttribute(id, value) {
  if (value === undefined || value === null || value === '') return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.values)) return { id, values: value.values.map((item) => ({
      ...(item?.id ? { id: item.id } : {}),
      ...(item?.name ? { name: item.name } : {})
    })).filter((item) => item.id || item.name) };
    return {
      id,
      ...(value.value_id ? { value_id: value.value_id } : {}),
      ...(value.value_name ? { value_name: value.value_name } : {})
    };
  }
  return { id, value_name: String(value) };
}

function attributesFor(_product, variant, listings) {
  const attributes = new Map();
  const push = (id, value) => {
    const attribute = normalizedAttribute(String(id).trim().toUpperCase(), value);
    if (attribute && (attribute.value_id || attribute.value_name || attribute.values?.length)) {
      attributes.set(attribute.id, attribute);
    }
  };
  const globalAttributes = listings.find((listing) => listing.familyData?.globalAttributes)?.familyData?.globalAttributes
    ?? {};
  for (const [id, value] of Object.entries(globalAttributes)) push(id, value);
  for (const [id, value] of Object.entries(variant.otherAttributes ?? {})) push(id, value);
  push('SELLER_SKU', variant.sellerSku);
  if (!attributes.has('COLOR')) push('COLOR', variant.color);
  if (!attributes.has('SIZE')) push('SIZE', variant.size);
  return [...attributes.values()];
}

function imagesFor(variant, mediaByVariant) {
  return (mediaByVariant[variant.id] ?? [])
    .map((media) => typeof media === 'string' ? { internalId: media } : media)
    .filter((media) => media.mercadoPictureId)
    .map((media) => ({ id: media.mercadoPictureId }));
}

/**
 * Produces the reviewable Global Selling UP-family candidate used by the
 * adapter. It is never sent by this function. Category metadata and the
 * seller's user_product_seller tag must be checked before any live request.
 */
export function buildGlobalUpFamilyPreview({ product, variants, listings, mediaByVariant = {}, publishTarget = { mode: 'create' } }) {
  const selected = variants.filter((variant) => variant.participateInPublish !== false);
  const familyName = product.familyName ?? product.originalTitle;
  const globalCategoryId = product.globalCategoryId
    ?? listings.find((listing) => listing.globalCategoryId)?.globalCategoryId
    ?? null;
  // Sale terms are Family-level CBT data. Ignore the empty arrays created for
  // site listings that have not been reviewed yet; otherwise the first empty
  // listing suppresses a valid value saved on another selected site.
  const saleTerms = listings.find((listing) => (
    Array.isArray(listing.familyData?.globalSaleTerms)
      && listing.familyData.globalSaleTerms.length > 0
  ))?.familyData?.globalSaleTerms ?? [];
  const publishMode = publishTarget?.mode === 'update' ? 'update' : 'create';
  const sitelessFamilyId = String(publishTarget?.sitelessFamilyId ?? '').trim();
  if (publishMode === 'update' && !sitelessFamilyId) {
    const error = new Error('A siteless Family ID is required when updating an existing Family');
    error.code = 'existing_family_id_required';
    throw error;
  }
  return {
    schemaVersion: 'meli-global-up-family-preview/v4',
    destructive: false,
    requiresExplicitPublishConfirmation: true,
    request: {
      method: publishMode === 'update' ? 'PUT' : 'POST',
      endpoint: publishMode === 'update'
        ? `/global/user-products/families/${encodeURIComponent(sitelessFamilyId)}`
        : '/global/user-products/families',
      body: selected.map((variant) => ({
        family_name: familyName,
        category_id: globalCategoryId,
        currency_id: listings[0]?.currency ?? 'USD',
        global_net_proceeds: variant.globalNetProceedsUsd,
        available_quantity: variant.stock ?? 0,
        description: {
          plain_text: listings.find((listing) => listing.descriptionEnglish)?.descriptionEnglish ?? ''
        },
        attributes: attributesFor(product, variant, listings),
        ...(saleTerms.length ? { sale_terms: saleTerms } : {}),
        pictures: imagesFor(variant, mediaByVariant),
        sites_to_sell: listings.map((listing) => ({
          site_id: listing.site,
          logistic_type: 'remote'
        }))
      }))
    },
    summary: {
      familyName,
      globalCategoryId,
      publishMode,
      sitelessFamilyId: publishMode === 'update' ? sitelessFamilyId : null,
      sourceItemId: publishMode === 'update' ? publishTarget.sourceItemId ?? null : null,
      userProductCount: selected.length,
      sites: listings.map((listing) => ({ id: listing.site, name: SITE_NAMES[listing.site] ?? listing.site })),
      sellerSkus: selected.map((variant) => variant.sellerSku)
    }
  };
}
