const HOSTS = new Map([
  ['www.amazon.com', 'Amazon'], ['amazon.com', 'Amazon'],
  ['www.amazon.com.br', 'Amazon'], ['amazon.com.br', 'Amazon'],
  ['www.amazon.com.mx', 'Amazon'], ['amazon.com.mx', 'Amazon'],
  ['www.temu.com', 'Temu'], ['temu.com', 'Temu'],
  ['shopee.com.br', 'Shopee'], ['www.shopee.com.br', 'Shopee'],
  ['shopee.com.mx', 'Shopee'], ['www.shopee.com.mx', 'Shopee'],
  ['produto.mercadolivre.com.br', 'MLB'], ['www.mercadolivre.com.br', 'MLB'],
  ['articulo.mercadolibre.com.mx', 'MLM'], ['www.mercadolibre.com.mx', 'MLM']
]);
const MAX_BYTES = 3_000_000;
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|nbsp|quot|lt|gt|#39);/g, v => ({ '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'" })[v] ?? v).replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values.map(clean).filter(Boolean))];

export function classifyProductUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw Object.assign(new Error('商品链接无效'), { statusCode: 400 }); }
  const platform = HOSTS.get(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !platform) throw Object.assign(new Error('只允许指定平台的 HTTPS 商品链接'), { statusCode: 400 });
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { throw Object.assign(new Error('商品链接路径无效'), { statusCode: 400 }); }
  const productPath = platform === 'Amazon' ? /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(path)
    : platform === 'Temu' ? /\/g-\d+\.html$/i.test(path)
      : platform === 'Shopee' ? /-i\.\d+\.\d+$/i.test(path)
        : /\b(?:MLB|MLM)[-_]?\d+\b/i.test(path);
  if (!productPath) throw Object.assign(new Error('请提供商品详情页链接，不支持搜索页或短链'), { statusCode: 400 });
  url.hash = ''; url.search = '';
  return { url: url.toString(), platform };
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find(x => x !== undefined) ?? '';
}
function meta(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ([attr(tag, 'property'), attr(tag, 'name')].includes(name)) return clean(attr(tag, 'content'));
  }
  return '';
}
function textAt(html, id) {
  const start = html.search(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, 'i'));
  if (start < 0) return '';
  const fragment = html.slice(start, start + 5000);
  return clean(fragment.split(/<\/(?:div|h1|h2|span)>/i)[0]);
}
function structuredProducts(html) {
  const products = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = value => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (!value || typeof value !== 'object') return;
        if (String(value['@type'] ?? '').toLowerCase() === 'product') products.push(value);
        for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
      };
      walk(JSON.parse(match[1]));
    } catch { /* malformed merchant JSON-LD is not trusted */ }
  }
  return products;
}
export function extractProductHtml(html, platform) {
  const product = structuredProducts(html)[0] ?? {};
  const title = clean(product.name || textAt(html, 'productTitle') || meta(html, 'og:title'));
  const description = clean(product.description || meta(html, 'description') || meta(html, 'og:description'));
  const bullets = [];
  if (platform === 'Amazon') {
    const region = html.match(/<div\b[^>]*id=["']feature-bullets["'][^>]*>([\s\S]{0,30000}?)<\/div>/i)?.[1] ?? '';
    for (const match of region.matchAll(/<span\b[^>]*class=["'][^"']*a-list-item[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)) bullets.push(clean(match[1]));
  }
  const attributes = {};
  for (const entry of Array.isArray(product.additionalProperty) ? product.additionalProperty : []) {
    if (entry?.name && entry?.value && Object.keys(attributes).length < 30) attributes[clean(entry.name).slice(0, 80)] = clean(entry.value).slice(0, 250);
  }
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const generic = /^(temu|amazon|shopee|mercado\s*libre)(?:\s*[|:-].*)?$/i.test(title);
  const usable = title.length >= 12 && !generic && !/captcha|robot check|access denied|enable javascript/i.test(title);
  return { usable, title: usable ? title.slice(0, 300) : '', description: description.slice(0, 3000), bullets: unique(bullets).slice(0, 10), attributes, image: typeof image === 'string' && image.startsWith('https://') ? image : null, fields: usable ? ['title', ...(description ? ['description'] : []), ...(bullets.length ? ['bullets'] : []), ...(Object.keys(attributes).length ? ['attributes'] : [])] : [] };
}

export async function extractProductUrl(input, fetcher = fetch) {
  const original = classifyProductUrl(input);
  let next = original.url;
  for (let redirects = 0; redirects <= 2; redirects++) {
    let response;
    try {
      response = await fetcher(next, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; TianchuanResearch/0.9)' } });
    } catch (error) {
      return { url: original.url, platform: original.platform, status: 'unavailable', reason: `网络请求失败：${error.code ?? error.name ?? 'unknown'}`, fields: [] };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      try { next = classifyProductUrl(new URL(location, next).toString()).url; } catch { return { url: original.url, platform: original.platform, status: 'blocked', reason: '商品页跳转到未允许的地址', fields: [] }; }
      continue;
    }
    if (!response.ok) return { url: original.url, platform: original.platform, status: 'blocked', httpStatus: response.status, reason: `商品页返回 HTTP ${response.status}`, fields: [] };
    const contentType = response.headers.get('content-type');
    if (contentType && !/text\/html/i.test(contentType)) return { url: original.url, platform: original.platform, status: 'unavailable', reason: '响应不是 HTML 商品页', fields: [] };
    const reader = response.body?.getReader();
    if (!reader) return { url: original.url, platform: original.platform, status: 'unavailable', reason: '响应内容为空', fields: [] };
    const parts = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return { url: original.url, platform: original.platform, status: 'unavailable', reason: '页面超过 3 MB 采集上限', fields: [] }; }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const html = new TextDecoder().decode(Buffer.concat(parts));
    if (!/^\s*(?:<!doctype html|<html)/i.test(html)) return { url: original.url, platform: original.platform, status: 'unavailable', reason: '响应不是 HTML 商品页', fields: [] };
    const parsed = extractProductHtml(html, original.platform);
    return { url: original.url, platform: original.platform, status: parsed.usable ? 'extracted' : 'unavailable', reason: parsed.usable ? '' : '页面未提供可验证的商品标题，可能需要 JavaScript 或已触发风控', fetchedAt: new Date().toISOString(), ...parsed };
  }
  return { url: original.url, platform: original.platform, status: 'blocked', reason: '跳转次数过多', fields: [] };
}

export async function extractMercadoProduct(input, accountId, oauth, fetcher = fetch) {
  const result = await extractProductUrl(input, fetcher);
  if (!['MLM', 'MLB'].includes(result.platform) || result.status === 'extracted' || !accountId || !oauth) return result;
  const itemId = new URL(result.url).pathname.match(/\b(?:MLM|MLB)[-_]?(\d+)\b/i);
  if (!itemId) return result;
  const id = `${result.platform}${itemId[1]}`;
  const item = await oauth.authenticatedRequest(accountId, `/items/${id}`);
  if (!item.ok || item.payload?.id !== id || !item.payload?.title) return { ...result, reason: `官方商品接口未返回详情（HTTP ${item.status}）` };
  const categoryId = String(item.payload.category_id ?? '');
  const [description, category] = await Promise.all([
    oauth.authenticatedRequest(accountId, `/items/${id}/description`),
    categoryId.startsWith(result.platform) ? oauth.authenticatedRequest(accountId, `/categories/${categoryId}`) : Promise.resolve(null)
  ]);
  const path = category?.ok ? category.payload?.path_from_root ?? [] : [];
  return {
    url: result.url, platform: result.platform, status: 'extracted', reason: '', fetchedAt: new Date().toISOString(),
    title: clean(item.payload.title).slice(0, 300), description: clean(description?.ok ? description.payload?.plain_text : '').slice(0, 3000),
    bullets: [], attributes: Object.fromEntries((item.payload.attributes ?? []).filter(a => a.id && (a.value_name || a.value_id)).slice(0, 30).map(a => [a.id, clean(a.value_name ?? a.value_id).slice(0, 250)])),
    image: item.payload.thumbnail?.startsWith('https://') ? item.payload.thumbnail : null,
    categoryId: categoryId.startsWith(result.platform) ? categoryId : null,
    categoryPath: path.map(part => ({ id: part.id, name: part.name })),
    fields: ['title', ...(description?.payload?.plain_text ? ['description'] : []), ...(item.payload.attributes?.length ? ['attributes'] : []), ...(categoryId.startsWith(result.platform) ? ['categoryId'] : []), ...(path.length ? ['categoryPath'] : [])],
    sourceMethod: 'official_item_api'
  };
}
