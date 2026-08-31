import { createHash, randomBytes } from 'node:crypto';

async function withTransaction(pool, callback) {
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function scopes(value) {
  return String(value ?? '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function oauthError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function compactAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  return attributes.map((attribute) => ({
    id: attribute.id ?? null,
    name: attribute.name ?? null,
    valueId: attribute.value_id ?? null,
    valueName: attribute.value_name ?? null,
    values: Array.isArray(attribute.values) ? attribute.values.map((value) => ({
      id: value.id ?? null,
      name: value.name ?? null,
      struct: value.struct ?? null
    })) : [],
    valueStruct: attribute.value_struct ?? null
  }));
}

function compactPictures(pictures) {
  if (!Array.isArray(pictures)) return [];
  return pictures.map((picture) => ({
    id: picture.id ?? null,
    url: picture.secure_url ?? picture.url ?? null,
    size: picture.size ?? null,
    maxSize: picture.max_size ?? null,
    quality: picture.quality ?? null
  }));
}

export function normalizeItemInspection({ item, description, userProduct, userProductStatus }) {
  return {
    item: {
      id: item.id,
      siteId: item.site_id ?? null,
      title: item.title ?? null,
      subtitle: item.subtitle ?? null,
      status: item.status ?? null,
      subStatus: item.sub_status ?? [],
      categoryId: item.category_id ?? null,
      sellerId: item.seller_id === undefined ? null : String(item.seller_id),
      listingTypeId: item.listing_type_id ?? null,
      currencyId: item.currency_id ?? null,
      price: item.price ?? null,
      basePrice: item.base_price ?? null,
      availableQuantity: item.available_quantity ?? null,
      soldQuantity: item.sold_quantity ?? null,
      permalink: item.permalink ?? null,
      userProductId: item.user_product_id ?? null,
      familyName: item.family_name ?? null,
      sellerCustomField: item.seller_custom_field ?? null,
      attributes: compactAttributes(item.attributes),
      variations: Array.isArray(item.variations) ? item.variations.map((variation) => ({
        id: variation.id ?? null,
        price: variation.price ?? null,
        availableQuantity: variation.available_quantity ?? null,
        soldQuantity: variation.sold_quantity ?? null,
        sellerCustomField: variation.seller_custom_field ?? null,
        attributes: compactAttributes(variation.attribute_combinations),
        pictureIds: Array.isArray(variation.picture_ids) ? variation.picture_ids : []
      })) : [],
      pictures: compactPictures(item.pictures),
      saleTerms: compactAttributes(item.sale_terms),
      dateCreated: item.date_created ?? null,
      lastUpdated: item.last_updated ?? null
    },
    description: description ? {
      plainText: description.plain_text ?? null,
      lastUpdated: description.last_updated ?? null
    } : null,
    userProduct: userProduct ? {
      id: userProduct.id ?? null,
      status: userProduct.status ?? null,
      familyId: userProduct.family_id ?? null,
      familyName: userProduct.family_name ?? null,
      attributes: compactAttributes(userProduct.attributes),
      pictures: compactPictures(userProduct.pictures),
      sitesToSell: userProduct.sites_to_sell ?? []
    } : null,
    lookups: {
      description: description ? 'ok' : 'unavailable',
      userProduct: userProduct ? 'ok' : userProductStatus
    }
  };
}

export class MercadoLibreOAuthService {
  constructor({ config, pool, cipher, apiClient }) {
    this.config = config;
    this.pool = pool;
    this.cipher = cipher;
    this.apiClient = apiClient;
  }

  async createAuthorizationRequest() {
    const state = randomBytes(32).toString('base64url');
    await this.pool.query(`
      INSERT INTO oauth_states (state_hash, expires_at)
      VALUES ($1, now() + ($2 * interval '1 second'))
    `, [sha256(state), this.config.stateTtlSeconds]);
    await this.pool.query("DELETE FROM oauth_states WHERE expires_at < now() - interval '1 day'");

    const url = new URL('/authorization', `${this.config.authBaseUrl}/`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString(), expiresInSeconds: this.config.stateTtlSeconds };
  }

  async consumeState(state) {
    if (!state || state.length < 32) throw oauthError('OAuth state is missing or invalid', 'invalid_oauth_state', 400);
    const result = await this.pool.query(`
      UPDATE oauth_states
      SET consumed_at = now()
      WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING id
    `, [sha256(state)]);
    if (!result.rowCount) throw oauthError('OAuth state has expired or was already used', 'invalid_oauth_state', 400);
  }

  async requestToken(parameters) {
    const response = await fetch(`${this.config.apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const providerCode = String(payload.error ?? 'unknown_error').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
      throw oauthError(`Mercado Libre OAuth returned HTTP ${response.status}`, `meli_oauth_${providerCode}`);
    }
    return payload;
  }

  async exchangeAuthorizationCode({ code, state }) {
    if (!code) throw oauthError('Authorization code is missing', 'authorization_code_missing', 400);
    await this.consumeState(state);
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri
    });
    const profileResponse = await this.apiClient.request('/users/me', { accessToken: token.access_token });
    if (!profileResponse.ok || !profileResponse.payload?.id) {
      throw oauthError(`Mercado Libre user lookup returned HTTP ${profileResponse.status}`, 'meli_user_lookup_failed');
    }
    return this.storeGrant({ token, profile: profileResponse.payload });
  }

  async storeGrant({ token, profile }) {
    const expiresIn = Math.max(Number(token.expires_in ?? 0), 60);
    return withTransaction(this.pool, async (client) => {
      const account = await client.query(`
        INSERT INTO seller_accounts (
          meli_user_id, nickname, site_default, granted_scopes, status, metadata, last_verified_at
        ) VALUES ($1,$2,$3,$4,'connected',$5,now())
        ON CONFLICT (meli_user_id) DO UPDATE SET
          nickname = EXCLUDED.nickname,
          site_default = EXCLUDED.site_default,
          granted_scopes = EXCLUDED.granted_scopes,
          status = 'connected',
          metadata = EXCLUDED.metadata,
          last_verified_at = now()
        RETURNING id, meli_user_id, nickname, site_default, granted_scopes, status
      `, [
        profile.id,
        profile.nickname ?? null,
        profile.site_id ?? null,
        scopes(token.scope),
        { accountType: 'global_selling' }
      ]);
      const accountId = account.rows[0].id;
      const existing = await client.query('SELECT refresh_token_enc FROM oauth_tokens WHERE seller_account_id = $1', [accountId]);
      const refreshTokenEnc = token.refresh_token
        ? this.cipher.encrypt(token.refresh_token, `refresh:${profile.id}`)
        : existing.rows[0]?.refresh_token_enc ?? null;
      await client.query(`
        INSERT INTO oauth_tokens (
          seller_account_id, access_token_enc, refresh_token_enc, access_expires_at, token_type
        ) VALUES ($1,$2,$3,now() + ($4 * interval '1 second'),$5)
        ON CONFLICT (seller_account_id) DO UPDATE SET
          access_token_enc = EXCLUDED.access_token_enc,
          refresh_token_enc = EXCLUDED.refresh_token_enc,
          access_expires_at = EXCLUDED.access_expires_at,
          token_type = EXCLUDED.token_type,
          updated_at = now()
      `, [
        accountId,
        this.cipher.encrypt(token.access_token, `access:${profile.id}`),
        refreshTokenEnc,
        expiresIn,
        token.token_type ?? 'bearer'
      ]);
      return account.rows[0];
    });
  }

  async refreshAccessToken(accountId) {
    return withTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`meli-refresh:${accountId}`]);
      const result = await client.query(`
        SELECT sa.meli_user_id, ot.refresh_token_enc
        FROM seller_accounts sa
        JOIN oauth_tokens ot ON ot.seller_account_id = sa.id
        WHERE sa.id = $1
        FOR UPDATE OF ot
      `, [accountId]);
      if (!result.rowCount) throw oauthError('Seller account is not connected', 'seller_account_not_connected', 404);
      const row = result.rows[0];
      if (!row.refresh_token_enc) throw oauthError('No refresh token was granted', 'refresh_token_missing', 409);
      const refreshToken = this.cipher.decrypt(row.refresh_token_enc, `refresh:${row.meli_user_id}`);
      const token = await this.requestToken({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
      });
      const expiresIn = Math.max(Number(token.expires_in ?? 0), 60);
      await client.query(`
        UPDATE oauth_tokens SET
          access_token_enc = $2,
          refresh_token_enc = COALESCE($3, refresh_token_enc),
          access_expires_at = now() + ($4 * interval '1 second'),
          token_type = $5,
          updated_at = now()
        WHERE seller_account_id = $1
      `, [
        accountId,
        this.cipher.encrypt(token.access_token, `access:${row.meli_user_id}`),
        token.refresh_token ? this.cipher.encrypt(token.refresh_token, `refresh:${row.meli_user_id}`) : null,
        expiresIn,
        token.token_type ?? 'bearer'
      ]);
      return { accountId, expiresIn, scopes: scopes(token.scope) };
    });
  }

  async getAccessToken(accountId, { forceRefresh = false } = {}) {
    const result = await this.pool.query(`
      SELECT sa.meli_user_id, ot.access_token_enc,
             ot.access_expires_at > now() + interval '5 minutes' AS is_valid
      FROM seller_accounts sa
      JOIN oauth_tokens ot ON ot.seller_account_id = sa.id
      WHERE sa.id = $1 AND sa.status = 'connected'
    `, [accountId]);
    if (!result.rowCount) throw oauthError('Seller account is not connected', 'seller_account_not_connected', 404);
    if (forceRefresh || !result.rows[0].is_valid) {
      await this.refreshAccessToken(accountId);
      return this.getAccessToken(accountId);
    }
    return this.cipher.decrypt(result.rows[0].access_token_enc, `access:${result.rows[0].meli_user_id}`);
  }

  async authenticatedRequest(accountId, path, options = {}) {
    let token = await this.getAccessToken(accountId);
    let response = await this.apiClient.request(path, { ...options, accessToken: token });
    if (response.status === 401) {
      token = await this.getAccessToken(accountId, { forceRefresh: true });
      response = await this.apiClient.request(path, { ...options, accessToken: token });
    }
    return response;
  }

  async listAccounts() {
    const result = await this.pool.query(`
      SELECT sa.id, sa.meli_user_id, sa.nickname, sa.site_default, sa.account_type,
             sa.granted_scopes, sa.status, sa.last_verified_at,
             ot.access_expires_at, ot.refresh_token_enc IS NOT NULL AS has_refresh_token,
             sa.capabilities, sa.capabilities_checked_at
      FROM seller_accounts sa
      LEFT JOIN oauth_tokens ot ON ot.seller_account_id = sa.id
      ORDER BY sa.created_at
    `);
    return result.rows.map((row) => ({
      id: row.id,
      mercadoLibreUserId: String(row.meli_user_id),
      nickname: row.nickname,
      siteDefault: row.site_default,
      accountType: row.account_type,
      grantedScopes: row.granted_scopes,
      status: row.status,
      accessExpiresAt: row.access_expires_at,
      hasRefreshToken: row.has_refresh_token,
      lastVerifiedAt: row.last_verified_at,
      capabilities: row.capabilities ?? {},
      capabilitiesCheckedAt: row.capabilities_checked_at
    }));
  }

  async inspectCapabilities(accountId) {
    const account = await this.pool.query('SELECT meli_user_id FROM seller_accounts WHERE id=$1', [accountId]);
    if (!account.rowCount) throw oauthError('Seller account is not connected', 'seller_account_not_connected', 404);
    const userId = account.rows[0].meli_user_id;
    const profile = await this.authenticatedRequest(accountId, `/users/${userId}`);
    if (!profile.ok) throw oauthError(`Mercado Libre user capability lookup returned HTTP ${profile.status}`, 'meli_capability_lookup_failed');
    const tags = Array.isArray(profile.payload?.tags) ? profile.payload.tags : [];
    const capabilities = {
      userProductSeller: tags.includes('user_product_seller'),
      globalSelling: profile.payload?.site_id === 'CBT',
      siteId: profile.payload?.site_id ?? null,
      tags
    };
    await this.pool.query(`
      UPDATE seller_accounts SET capabilities=$2,capabilities_checked_at=now(),last_verified_at=now()
      WHERE id=$1
    `, [accountId, capabilities]);
    return capabilities;
  }

  async categoryRequirements(accountId, categoryIds) {
    const unique = [...new Set(categoryIds.filter(Boolean))];
    const categories = [];
    for (const categoryId of unique) {
      const response = await this.authenticatedRequest(accountId, `/categories/${encodeURIComponent(categoryId)}/attributes`);
      const attributes = Array.isArray(response.payload) ? response.payload : [];
      categories.push({
        categoryId,
        ok: response.ok,
        httpStatus: response.status,
        requiredAttributes: attributes.filter((attribute) =>
          attribute.tags?.required === true || attribute.tags?.catalog_required === true
        ).map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          valueType: attribute.value_type,
          values: Array.isArray(attribute.values) ? attribute.values.slice(0, 100) : []
        })),
        variationAttributes: attributes.filter((attribute) => attribute.tags?.allow_variations === true).map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          valueType: attribute.value_type
        }))
      });
    }
    return { ok: categories.every((category) => category.ok), categories };
  }

  async inspectItem(accountId, itemId) {
    const account = await this.pool.query('SELECT meli_user_id FROM seller_accounts WHERE id=$1', [accountId]);
    if (!account.rowCount) throw oauthError('Seller account is not connected', 'seller_account_not_connected', 404);

    const itemResponse = await this.authenticatedRequest(
      accountId,
      `/items/${encodeURIComponent(itemId)}?include_attributes=all`
    );
    if (!itemResponse.ok || !itemResponse.payload?.id) {
      const status = itemResponse.status >= 400 && itemResponse.status < 500 ? itemResponse.status : 502;
      throw oauthError(`Mercado Libre item lookup returned HTTP ${itemResponse.status}`, 'meli_item_lookup_failed', status);
    }

    const item = itemResponse.payload;
    if (String(item.seller_id ?? '') !== String(account.rows[0].meli_user_id)) {
      throw oauthError('The requested item does not belong to the connected seller account', 'meli_item_not_owned', 403);
    }

    const descriptionResponse = await this.authenticatedRequest(
      accountId,
      `/items/${encodeURIComponent(itemId)}/description`
    );
    let userProductResponse = null;
    if (item.user_product_id) {
      userProductResponse = await this.authenticatedRequest(
        accountId,
        `/global/user-products/${encodeURIComponent(item.user_product_id)}`
      );
    }

    return normalizeItemInspection({
      item,
      description: descriptionResponse.ok ? descriptionResponse.payload : null,
      userProduct: userProductResponse?.ok ? userProductResponse.payload : null,
      userProductStatus: item.user_product_id
        ? `http_${userProductResponse?.status ?? 'unknown'}`
        : 'not_applicable'
    });
  }

  async discoverCategories(accountId, { query, sites = ['MLM', 'MCO', 'MLC'], limit = 5 }) {
    const results = [];
    for (const site of sites) {
      const path = `/sites/${site}/domain_discovery/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await this.authenticatedRequest(accountId, path);
      const suggestions = Array.isArray(response.payload) ? response.payload : [];
      results.push({
        site,
        ok: response.ok,
        httpStatus: response.status,
        suggestions: suggestions.map((item) => ({
          domainId: item.domain_id ?? null,
          domainName: item.domain_name ?? null,
          categoryId: item.category_id ?? null,
          categoryName: item.category_name ?? null,
          attributes: item.attributes ?? []
        }))
      });
    }
    return { ok: results.every((result) => result.ok), query, results };
  }

  async smokeTest(accountId) {
    const checks = [];
    const request = async (name, path) => {
      const response = await this.authenticatedRequest(accountId, path);
      checks.push({ name, path, ok: response.ok, httpStatus: response.status });
      return response;
    };
    const profile = await request('authenticated_user', '/users/me');
    await request('sites', '/sites');
    const query = encodeURIComponent('organizador de escritorio');
    for (const site of ['MLM', 'MCO', 'MLC']) {
      await request(`category_discovery_${site}`, `/sites/${site}/domain_discovery/search?q=${query}&limit=1`);
    }
    const accountResult = await this.pool.query(`
      UPDATE seller_accounts SET last_verified_at = now()
      WHERE id = $1
      RETURNING granted_scopes
    `, [accountId]);
    const granted = accountResult.rows[0]?.granted_scopes ?? [];
    return {
      ok: checks.every((check) => check.ok),
      account: profile.ok ? {
        id: String(profile.payload.id),
        nickname: profile.payload.nickname ?? null,
        siteId: profile.payload.site_id ?? null
      } : null,
      permissions: {
        read: granted.includes('read'),
        write: granted.includes('write'),
        offlineAccess: granted.includes('offline_access')
      },
      checks
    };
  }
}
