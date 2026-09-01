-- Images without an explicit variant link were treated as shared by older
-- versions. Materialize those effective selections before switching the
-- publisher to an explicit per-variant image model.
INSERT INTO variant_media (variant_id,media_id,sort_order,is_primary)
SELECT v.id,pm.id,pm.sort_order + 100,false
FROM product_media pm
JOIN variants v ON v.product_id=pm.product_id
WHERE pm.media_type='image'
  AND NOT EXISTS (SELECT 1 FROM variant_media linked WHERE linked.media_id=pm.id)
ON CONFLICT (variant_id,media_id) DO NOTHING;
