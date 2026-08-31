import pg from 'pg';

const { Pool } = pg;

// Parses a PostgreSQL array literal string like "{MLM,MCO,MLC}" into an array.
function parsePgArray(input) {
  if (input == null || input === '{}') return [];
  const value = String(input).trim();
  if (!value.startsWith('{')) return [value];
  // Simple splitter for flat string arrays produced by enum[] columns.
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter((item) => item.length > 0);
}

// Deterministically resolves the site_code[] OID and registers a JS-array type
// parser for it, so reads return ["MLM","MCO","MLC"] instead of "{MLM,MCO,MLC}".
// Await this before handling requests to avoid the first-query race.
export async function registerSiteCodeArrayParser(pool) {
  try {
    const res = await pool.query(`
      SELECT t.oid
      FROM pg_type t
      JOIN pg_type e ON e.oid = t.typelem
      WHERE t.typname = '_site_code'
      LIMIT 1
    `);
    const oid = res.rows[0]?.oid;
    if (oid != null) {
      // Pool objects don't expose .types; the shared registry lives on pg.types.
      pg.types.setTypeParser(oid, parsePgArray);
      return true;
    }
    return false;
  } catch (error) {
    throw new Error(`Failed to register site_code array parser: ${error.message}`);
  }
}

export function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
