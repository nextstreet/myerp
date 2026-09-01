const SITE_NAMES = Object.freeze({ MLM: 'Mexico', MCO: 'Colombia', MLC: 'Chile' });

function attributesFor(product, variant, listing) {
  const attributes = [];
  const push = (id, valueName) => {
    if (valueName !== undefined && valueName !== null && String(valueName).trim()) {
      attributes.push({ id, value_name: String(valueName) });
    }
  };
  push('SELLER_SKU', variant.sellerSku);
  push('COLOR', variant.color);
  push('SIZE', variant.size);
  for (const [id, value] of Object.entries(product.rawAttributes ?? {})) push(id, value);
  for (const [id, value] of Object.entries(variant.otherAttributes ?? {})) push(id, value);
  for (const [id, value] of Object.entries(listing.requiredAttributes ?? {})) push(id, value);
  return attributes;
}

function imagesFor(variant, mediaByVariant) {
  return (mediaByVariant[variant.id] ?? [])
    .map((media) => typeof media === 'string' ? { internalId: media } : media)
    .filter((media) => media.externalUrl || media.mercadoPictureId)
    .map((media) => media.mercadoPictureId ? { id: media.mercadoPictureId } : { source: media.externalUrl });
}

/**
 * Produces the reviewable Global Selling UP-family candidate used by the
 * adapter. It is never sent by this function. Category metadata and the
 * seller's user_product_seller tag must be checked before any live request.
 */
export function buildGlobalUpFamilyPreview({ product, variants, listings, mediaByVariant = {} }) {
  const selected = variants.filter((variant) => variant.participateInPublish !== false);
  const familyName = product.familyName ?? product.originalTitle;
  const globalCategoryId = product.globalCategoryId
    ?? listings.find((listing) => listing.globalCategoryId)?.globalCategoryId
    ?? null;
  return {
    schemaVersion: 'meli-global-item-batch-preview/v2',
    destructive: false,
    requiresExplicitPublishConfirmation: true,
    requests: selected.map((variant) => ({
      method: 'POST',
      endpoint: '/global/items',
      internalVariantId: variant.id,
      sellerSku: variant.sellerSku,
      body: {
        family_name: familyName,
        category_id: globalCategoryId,
        currency_id: listings[0]?.currency ?? 'USD',
        attributes: attributesFor(product, variant, listings[0] ?? {}),
        pictures: imagesFor(variant, mediaByVariant),
        sites_to_sell: listings.map((listing) => ({
          site_id: listing.site,
          logistic_type: 'remote',
          title: listing.title,
          price: listing.variantPrices?.[variant.id] ?? listing.price,
          available_quantity: variant.stock ?? 0,
          attributes: attributesFor(product, variant, listing)
        }))
      }
    })),
    summary: {
      familyName,
      globalCategoryId,
      userProductCount: selected.length,
      sites: listings.map((listing) => ({ id: listing.site, name: SITE_NAMES[listing.site] ?? listing.site })),
      sellerSkus: selected.map((variant) => variant.sellerSku)
    }
  };
}
