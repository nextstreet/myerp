const SUPPORTED_SITES = Object.freeze(['MLM', 'MCO', 'MLC']);

export function normalizeSelectedSites(requestedSites, allowedSites) {
  const allowed = new Set((allowedSites ?? SUPPORTED_SITES).filter((site) => SUPPORTED_SITES.includes(site)));
  if (!Array.isArray(requestedSites) || !requestedSites.length) {
    const error = new Error('Select at least one target site');
    error.code = 'publish_sites_required';
    throw error;
  }
  const selected = [...new Set(requestedSites.map((site) => String(site).trim().toUpperCase()))];
  if (selected.some((site) => !allowed.has(site))) {
    const error = new Error('One or more selected sites are not enabled for this product');
    error.code = 'unsupported_publish_site';
    throw error;
  }
  return SUPPORTED_SITES.filter((site) => selected.includes(site));
}

export function scopeFamilyToSites(family, selectedSites) {
  return {
    ...family,
    product: { ...family.product, targetSites: selectedSites },
    listings: family.listings.filter((listing) => selectedSites.includes(listing.site))
  };
}
