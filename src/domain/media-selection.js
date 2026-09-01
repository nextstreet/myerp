export function effectiveMediaForVariants({ variants, mediaRows, limit = 10 }) {
  const mediaValue = (row) => ({
    id: row.media_id, externalUrl: row.external_url, storageKey: row.storage_key,
    mercadoPictureId: row.mercado_picture_id, validationStatus: row.validation_status,
    mimeType: row.mime_type, originalFilename: row.original_filename, isPrimary: row.is_primary
  });
  const result = {};
  for (const row of mediaRows.filter((item) => item.variant_id)) {
    (result[row.variant_id] ??= []).push(mediaValue(row));
  }
  for (const variant of variants) {
    result[variant.id] = (result[variant.id] ?? []).slice(0, limit);
  }
  return result;
}
