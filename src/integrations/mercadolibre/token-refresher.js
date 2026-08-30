export function startTokenRefreshScheduler({ service, pool, logger, intervalSeconds }) {
  let running = false;
  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      const result = await pool.query(`
        SELECT seller_account_id
        FROM oauth_tokens
        WHERE access_expires_at <= now() + interval '30 minutes'
        ORDER BY access_expires_at
      `);
      for (const row of result.rows) {
        try {
          await service.refreshAccessToken(row.seller_account_id);
          logger.info({ accountId: row.seller_account_id }, 'Mercado Libre token refreshed');
        } catch (error) {
          logger.error({ accountId: row.seller_account_id, code: error.code }, 'Mercado Libre token refresh failed');
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(refresh, Math.max(intervalSeconds, 60) * 1000);
  timer.unref();
  return { runNow: refresh, stop: () => clearInterval(timer) };
}
