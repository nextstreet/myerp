import { loadConfig } from '../src/config.js';
import { createPool, withTransaction } from '../src/db/pool.js';

const pool = createPool(loadConfig());
const colors = [
  ['BLK', 'Black'], ['WHT', 'White'], ['GRY', 'Gray'],
  ['GRN', 'Green'], ['PNK', 'Pink'], ['CRM', 'Cream']
];

try {
  const productId = await withTransaction(pool, async (client) => {
    const product = await client.query(`
      INSERT INTO products (
        internal_code, original_title, category_hint, purchase_price_cny,
        packed_weight_g, product_dimensions, raw_attributes, target_sites, status
      ) VALUES (
        'TEST-MESH-ORGANIZER-001', '六色金属网格桌面收纳盒', 'Desktop organizers',
        12.13, 650, $1, $2, ARRAY['MLM','MCO','MLC']::site_code[], 'pending_review'
      )
      ON CONFLICT (internal_code) DO UPDATE SET updated_at = now()
      RETURNING id
    `, [
      { lengthCm: 24, widthCm: 12, heightCm: 12 },
      { material: 'Iron / Metal Mesh', compartments: 4, design: 'Open top' }
    ]);
    const id = product.rows[0].id;

    for (const [code, color] of colors) {
      await client.query(`
        INSERT INTO variants (
          product_id, seller_sku, color, purchase_price_cny,
          packed_weight_g, stock, participate_in_publish
        ) VALUES ($1,$2,$3,12.13,650,10,true)
        ON CONFLICT (seller_sku) DO UPDATE SET color = EXCLUDED.color
      `, [id, `MESH-4C-${code}`, color]);
    }

    const listings = [
      ['MLM', 'Organizador De Escritorio De Malla Metálica 4 Compartimentos', 'MXN'],
      ['MCO', 'Organizador De Escritorio En Malla Metálica 4 Compartimentos', 'COP'],
      ['MLC', 'Organizador De Escritorio Malla Metálica 4 Compartimentos', 'CLP']
    ];
    for (const [site, title, currency] of listings) {
      await client.query(`
        INSERT INTO listings (
          product_id, site, title, description_english, specifications_english,
          family_name, currency, target_profit_usd, target_margin_rate, pricing_basis
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,5,0.25,$8)
        ON CONFLICT (product_id, site) DO UPDATE SET
          title = EXCLUDED.title,
          description_english = EXCLUDED.description_english,
          specifications_english = EXCLUDED.specifications_english,
          family_name = EXCLUDED.family_name
      `, [
        id, site, title,
        'Open-top metal mesh desktop organizer with four compartments for everyday desk storage.',
        { material: 'Iron / Metal Mesh', compartments: 4, size: '24 × 12 × 12 cm' },
        'Metal Mesh Desktop Organizer - 4 Compartments', currency,
        { normalPrice: null, note: 'Run the pricing endpoint with current logistics costs and exchange rates.' }
      ]);
    }
    return id;
  });
  console.log(`Seeded six-color test product: ${productId}`);
} finally {
  await pool.end();
}
