function valueFor(attributes, id) {
  const attribute = Array.isArray(attributes) ? attributes.find((item) => item?.id === id) : null;
  return attribute?.value_name ?? attribute?.valueName ?? attribute?.values?.[0]?.name ?? null;
}

function resultEntries(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['user_products', 'userProducts', 'results', 'items']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return payload && typeof payload === 'object' ? [payload] : [];
}

function sitelessUserProductId(value) {
  const match = String(value ?? '').toUpperCase().match(/U(\d+)$/);
  return match ? `U${match[1]}` : null;
}

export function normalizeFamilyPublishResult(payload, expectedSellerSkus = []) {
  const entries = resultEntries(payload);
  // Mercado Libre's /global/user-products/families endpoint returns HTTP 200
  // even when a batch element failed validation; the per-element errors are
  // embedded in the body as { error, status, cause } objects instead of a
  // user product. Detect those before treating them as identifier-less UPs.
  const rejectedEntries = entries.filter((entry) => entry && typeof entry === 'object'
    && (Number(entry.status) >= 400 || Boolean(entry.error)
      || (Array.isArray(entry.cause) ? entry.cause.length > 0 : Boolean(entry.cause))));
  if (rejectedEntries.length) {
    const acceptedEntries = entries.filter((entry) => !rejectedEntries.includes(entry));
    return {
      familyId: payload?.siteless_family_id ?? payload?.family_id ?? payload?.familyId ?? null,
      providerRejected: true,
      providerPartiallyAccepted: acceptedEntries.length > 0,
      userProducts: entries.map((entry) => ({
        sellerSku: valueFor(entry.attributes, 'SELLER_SKU') ?? null,
        userProductId: sitelessUserProductId(entry.siteless_user_product_id
          ?? entry.parent_user_product_id ?? entry.user_product_id ?? entry.id),
        familyId: entry.siteless_family_id ?? entry.family_id ?? null,
        globalItemId: entry.item_id ?? entry.global_item_id ?? null,
        status: String(entry.status ?? ''),
        error: rejectedEntries.includes(entry) ? entry.error ?? entry.message ?? entry.cause ?? 'provider_rejected' : null,
        sites: (entry.site_items ?? entry.sites_to_sell ?? entry.sites ?? []).map((site) => ({
          site: site.site_id ?? site.site ?? null,
          itemId: site.item_id ?? site.itemId ?? site.mercado_libre_item_id ?? null,
          status: site.status ?? null,
          error: site.error ?? site.cause ?? null
        })).filter((site) => site.site),
        raw: entry
      }))
    };
  }
  const rootFamilyId = payload?.siteless_family_id ?? payload?.family_id ?? payload?.familyId ?? null;
  const userProducts = entries.map((entry, index) => {
    const sellerSku = entry.seller_sku ?? entry.sellerSku ?? valueFor(entry.attributes, 'SELLER_SKU')
      ?? expectedSellerSkus[index] ?? null;
    const sites = (entry.site_items ?? entry.sites_to_sell ?? entry.sites ?? []).map((site) => ({
      site: site.site_id ?? site.site ?? null,
      itemId: site.item_id ?? site.itemId ?? site.mercado_libre_item_id ?? null,
      status: site.status ?? null,
      error: site.error ?? site.cause ?? null
    })).filter((site) => site.site);
    return {
      sellerSku,
      userProductId: sitelessUserProductId(entry.siteless_user_product_id
        ?? entry.parent_user_product_id ?? entry.user_product_id ?? entry.id),
      familyId: entry.siteless_family_id ?? entry.family_id ?? rootFamilyId,
      globalItemId: entry.item_id ?? entry.global_item_id ?? null,
      status: entry.status ?? null,
      error: entry.error ?? entry.cause ?? null,
      sites,
      raw: entry
    };
  });
  return {
    familyId: rootFamilyId ?? userProducts.find((item) => item.familyId)?.familyId ?? null,
    userProducts
  };
}
