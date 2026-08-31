const state = { products: [], review: null, accounts: [], preview: {}, quotes: {} };
const sites = [
  { id: 'MLM', name: 'Mexico', currency: 'MXN' },
  { id: 'MCO', name: 'Colombia', currency: 'COP' },
  { id: 'MLC', name: 'Chile', currency: 'CLP' }
];
const statusLabels = {
  pending_import: '待导入', pending_ai: '待AI处理', ai_processing: 'AI处理中',
  pending_review: '待审核', pending_publish: '待发布', publishing: '发布中',
  published: '已发布', publish_failed: '发布失败', paused: '已暂停'
};
const $ = (id) => document.getElementById(id);

function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body instanceof FormData ? options.headers : {
      'content-type': 'application/json', ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body.details?.errors) ? body.details.errors.map((item) => item.code).join(', ') : '';
    throw new Error(body.message || body.error || details || `HTTP ${response.status}`);
  }
  return body;
}

function showLogin(message = '') {
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginError').textContent = message;
  $('loginPassword').focus();
}

function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function input(type, value, className = '') {
  const node = document.createElement('input');
  node.type = type;
  node.value = value ?? '';
  node.className = className;
  return node;
}

function button(label, className, handler) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', handler);
  return node;
}

function statusPill(status) {
  const node = document.createElement('span');
  node.className = `status-pill ${status === 'published' ? 'good' : status === 'publish_failed' ? 'bad' : ''}`;
  node.textContent = statusLabels[status] || status;
  return node;
}

function navigate(page) {
  document.querySelectorAll('.page').forEach((node) => node.classList.toggle('active', node.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.page === page));
  const titles = { products: '产品列表', import: '导入产品', review: 'AI处理与人工审核', publish: '发布预检' };
  $('pageTitle').textContent = titles[page];
  if (page === 'products') loadProducts();
  if (page === 'review') prepareReview();
  if (page === 'publish') preparePublish();
}

async function loadProducts() {
  try {
    const filter = $('productStatusFilter').value;
    state.products = await api(`/api/products${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
    renderProducts();
    populateProductSelects();
  } catch (error) { toast(error.message, true); }
}

function renderProducts() {
  const body = $('productsBody');
  body.replaceChildren();
  $('productsEmpty').classList.toggle('hidden', state.products.length > 0);
  $('metricProducts').textContent = state.products.length;
  $('metricVariants').textContent = state.products.reduce((sum, item) => sum + item.variantCount, 0);
  $('metricReview').textContent = state.products.filter((item) => item.status === 'pending_review').length;
  $('metricPublish').textContent = state.products.filter((item) => item.status === 'pending_publish').length;

  for (const product of state.products) {
    const row = document.createElement('tr');
    const productCell = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'product-cell';
    if (product.thumbnailMediaId) {
      const image = document.createElement('img');
      image.className = 'thumb'; image.alt = ''; image.loading = 'lazy';
      image.src = `/api/products/${product.id}/media/${product.thumbnailMediaId}/content`;
      wrap.append(image);
    } else {
      const placeholder = document.createElement('span'); placeholder.className = 'thumb'; wrap.append(placeholder);
    }
    const title = document.createElement('span'); title.textContent = product.originalTitle; wrap.append(title); productCell.append(wrap);
    row.append(productCell);
    for (const value of [product.internalCode, product.variantCount, product.targetSites.join(' · '), `¥${product.purchasePriceCny}`, `${product.packedWeightG}g`]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    const statusCell = document.createElement('td'); statusCell.append(statusPill(product.status)); row.append(statusCell);
    const updated = document.createElement('td'); updated.textContent = new Date(product.updatedAt).toLocaleString('zh-CN'); row.append(updated);
    const action = document.createElement('td'); action.append(button('审核', 'button ghost small', () => openReview(product.id))); row.append(action);
    body.append(row);
  }
}

function populateProductSelects() {
  for (const id of ['reviewProductSelect', 'publishProductSelect']) {
    const select = $(id); const selected = select.value;
    select.replaceChildren(option('', '选择产品'));
    state.products.forEach((product) => select.append(option(product.id, `${product.internalCode} · ${product.originalTitle}`)));
    if (state.products.some((product) => product.id === selected)) select.value = selected;
  }
}

function addImportVariant(values = {}) {
  const row = document.createElement('tr');
  const fields = [
    ['sellerSku', 'text', values.sellerSku], ['color', 'text', values.color], ['size', 'text', values.size],
    ['stock', 'number', values.stock ?? 10], ['purchasePriceCny', 'number', values.purchasePriceCny],
    ['packedWeightG', 'number', values.packedWeightG]
  ];
  fields.forEach(([name, type, value]) => {
    const cell = document.createElement('td'); const control = input(type, value); control.dataset.field = name;
    if (type === 'number') { control.min = '0'; control.step = name === 'stock' ? '1' : '0.0001'; }
    cell.append(control); row.append(cell);
  });
  const action = document.createElement('td'); action.append(button('移除', 'button ghost small', () => row.remove())); row.append(action);
  $('importVariantsBody').append(row);
}

function importVariants() {
  return [...$('importVariantsBody').querySelectorAll('tr')].map((row) => {
    const get = (name) => row.querySelector(`[data-field="${name}"]`).value.trim();
    return {
      sellerSku: get('sellerSku'), color: get('color') || null, size: get('size') || null,
      stock: Number(get('stock') || 0), purchasePriceCny: get('purchasePriceCny') ? Number(get('purchasePriceCny')) : null,
      packedWeightG: get('packedWeightG') ? Number(get('packedWeightG')) : null, participateInPublish: true
    };
  });
}

async function createProduct(event) {
  event.preventDefault();
  try {
    const data = new FormData(event.currentTarget);
    let rawAttributes = {};
    if (data.get('rawAttributes').trim()) rawAttributes = JSON.parse(data.get('rawAttributes'));
    const variants = importVariants();
    if (!variants.length) throw new Error('至少添加一个规格');
    const result = await api('/api/products', { method: 'POST', body: JSON.stringify({
      internalCode: data.get('internalCode'), sourceUrl: data.get('sourceUrl') || null,
      originalTitle: data.get('originalTitle'), categoryHint: data.get('categoryHint') || null,
      purchasePriceCny: Number(data.get('purchasePriceCny')), packedWeightG: Number(data.get('packedWeightG')),
      productDimensions: data.get('productSize') ? { text: data.get('productSize') } : {},
      packageDimensions: data.get('packageSize') ? { text: data.get('packageSize') } : {},
      rawAttributes, notes: data.get('notes') || null, targetSites: ['MLM', 'MCO', 'MLC'], variants
    }) });
    toast(`产品已创建，保留 ${result.variantCount} 个规格`);
    event.currentTarget.reset(); $('importVariantsBody').replaceChildren(); addImportVariant();
    await loadProducts(); openReview(result.id);
  } catch (error) { toast(error.message, true); }
}

async function prepareReview() {
  if (!state.products.length) await loadProducts();
  if ($('reviewProductSelect').value) await loadReview($('reviewProductSelect').value);
}

function openReview(productId) {
  navigate('review'); $('reviewProductSelect').value = productId; loadReview(productId);
}

async function loadReview(productId) {
  if (!productId) return;
  try {
    state.review = await api(`/api/products/${productId}`);
    $('reviewEmpty').classList.add('hidden'); $('reviewContent').classList.remove('hidden');
    $('reviewProductName').textContent = state.review.originalTitle;
    $('reviewProductMeta').textContent = `${state.review.internalCode} · ¥${state.review.purchasePriceCny} · ${state.review.packedWeightG}g · ${state.review.targetSites.join(' / ')}`;
    $('reviewProductStatus').replaceChildren(); $('reviewProductStatus').textContent = statusLabels[state.review.status] || state.review.status;
    $('reviewVariantCount').textContent = `${state.review.variants.length} 个 User Product`;
    $('quotePurchase').value = state.review.purchasePriceCny;
    $('quoteWeight').value = state.review.packedWeightG;
    const quoteListing = state.review.listings.find((item) => item.targetProfitUsd !== null) || {};
    if (!$('quoteProfit').value && quoteListing.targetProfitUsd !== undefined) $('quoteProfit').value = quoteListing.targetProfitUsd ?? '';
    if (!$('quoteMargin').value && quoteListing.targetMarginRate !== undefined) $('quoteMargin').value = quoteListing.targetMarginRate ?? '';
    renderReviewVariants(); renderMedia(); renderListings();
  } catch (error) { toast(error.message, true); }
}

function primaryFor(variantId) {
  const link = state.review.variantMedia.find((item) => item.variant_id === variantId && item.is_primary);
  return link ? state.review.media.find((item) => item.id === link.media_id) : null;
}

function renderReviewVariants() {
  const body = $('reviewVariantsBody'); body.replaceChildren();
  for (const variant of state.review.variants) {
    const row = document.createElement('tr');
    const sku = input('text', variant.sellerSku); const color = input('text', variant.color); const size = input('text', variant.size); const stock = input('number', variant.stock); stock.min = '0'; stock.step = '1';
    [sku, color, size, stock].forEach((control) => { const cell = document.createElement('td'); cell.append(control); row.append(cell); });
    const participateCell = document.createElement('td'); const participate = input('checkbox'); participate.checked = variant.participateInPublish; participateCell.append(participate); row.append(participateCell);
    const primaryCell = document.createElement('td'); const primary = primaryFor(variant.id); primaryCell.textContent = primary ? primary.original_filename : '未设置'; row.append(primaryCell);
    const action = document.createElement('td'); action.append(button('保存', 'button secondary small', async () => {
      try {
        await api(`/api/products/${state.review.id}/variants/${variant.id}`, { method: 'PATCH', body: JSON.stringify({ sellerSku: sku.value, color: color.value || null, size: size.value || null, stock: Number(stock.value), participateInPublish: participate.checked }) });
        toast(`规格 ${sku.value} 已保存`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); row.append(action); body.append(row);
  }
}

function renderMedia() {
  const grid = $('mediaGrid'); grid.replaceChildren();
  if (!state.review.media.length) { const empty = document.createElement('div'); empty.className = 'panel empty'; empty.textContent = '还没有图片。'; grid.append(empty); return; }
  for (const media of state.review.media.filter((item) => item.media_type === 'image')) {
    const card = document.createElement('article'); card.className = 'media-card';
    const image = document.createElement('img'); image.src = `/api/products/${state.review.id}/media/${media.id}/content`; image.alt = media.alt_text || ''; image.loading = 'lazy'; card.append(image);
    const name = document.createElement('small'); name.textContent = `${media.role} · ${media.original_filename}`; card.append(name);
    const select = document.createElement('select'); select.append(option('', '关联到颜色规格'));
    state.review.variants.forEach((variant) => select.append(option(variant.id, `${variant.color || variant.size || '规格'} · ${variant.sellerSku}`))); card.append(select);
    card.append(button('设为该规格主图', 'button secondary small wide', async () => {
      if (!select.value) return toast('请先选择规格', true);
      try {
        await api(`/api/products/${state.review.id}/variants/${select.value}/media/${media.id}`, { method: 'POST', body: JSON.stringify({ isPrimary: true, sortOrder: 0 }) });
        toast('主图关联已保存'); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); grid.append(card);
  }
}

async function uploadMedia() {
  const file = $('mediaFile').files[0];
  if (!file || !state.review) return toast('请先选择图片', true);
  const data = new FormData(); data.append('role', $('mediaRole').value); data.append('file', file);
  try {
    await api(`/api/products/${state.review.id}/media`, { method: 'POST', body: data });
    $('mediaFile').value = ''; toast('图片上传成功'); await loadReview(state.review.id);
  } catch (error) { toast(error.message, true); }
}

function listingFor(site) { return state.review.listings.find((item) => item.site === site.id) || { site: site.id, currency: site.currency, requiredAttributes: {}, specificationsEnglish: {}, pricingBasis: {} }; }

function renderListings() {
  const container = $('listingPanels'); container.replaceChildren();
  for (const site of sites) {
    const listing = listingFor(site); const card = document.createElement('article'); card.className = 'panel country-card'; card.dataset.site = site.id;
    const head = document.createElement('div'); head.className = 'country-head'; const title = document.createElement('h4'); title.textContent = site.name; const code = document.createElement('span'); code.className = 'flag-code'; code.textContent = `${site.id} · ${site.currency}`; head.append(title, code); card.append(head);
    const stack = document.createElement('div'); stack.className = 'field-stack';
    const controls = {};
    for (const field of [
      ['title', '西班牙语标题', listing.title || '', 'input'], ['categoryId', '类目 ID', listing.categoryId || '', 'input'],
      ['familyName', 'Family 名称', listing.familyName || '', 'input'], ['descriptionEnglish', 'English Description', listing.descriptionEnglish || '', 'textarea'],
      ['requiredAttributes', '必填属性 JSON', JSON.stringify(listing.requiredAttributes || {}, null, 2), 'textarea']
    ]) {
      const label = document.createElement('label'); label.textContent = field[1]; const control = document.createElement(field[3]); control.value = field[2]; if (field[3] === 'textarea') control.rows = field[0] === 'descriptionEnglish' ? 5 : 6; control.dataset.field = field[0]; controls[field[0]] = control; label.append(control); stack.append(label);
    }
    stack.append(button('保存刊登资料', 'button secondary', async () => {
      try {
        const requiredAttributes = controls.requiredAttributes.value.trim() ? JSON.parse(controls.requiredAttributes.value) : {};
        await api(`/api/products/${state.review.id}/listings/${site.id}`, { method: 'PUT', body: JSON.stringify({ title: controls.title.value, categoryId: controls.categoryId.value, familyName: controls.familyName.value, descriptionEnglish: controls.descriptionEnglish.value, requiredAttributes, currency: site.currency }) });
        toast(`${site.name} 刊登资料已保存`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); card.append(stack);

    const priceWrap = document.createElement('div'); priceWrap.className = 'price-table'; const table = document.createElement('table'); const tbody = document.createElement('tbody');
    const header = document.createElement('thead'); const headerRow = document.createElement('tr'); ['规格', '正常价', '促销价'].forEach((text) => { const th = document.createElement('th'); th.textContent = text; headerRow.append(th); }); header.append(headerRow); table.append(header);
    for (const variant of state.review.variants.filter((item) => item.participateInPublish)) {
      const saved = state.review.listingVariants.find((item) => item.variantId === variant.id && item.listingId === listing.id);
      const row = document.createElement('tr'); const label = document.createElement('td'); label.textContent = `${variant.color || variant.size || '规格'} · ${variant.sellerSku}`; const normalCell = document.createElement('td'); const normal = input('number', saved?.price); normal.min = '0'; normal.step = '0.01'; normal.dataset.variant = variant.id; normal.dataset.kind = 'normal'; normalCell.append(normal); const promoCell = document.createElement('td'); const promo = input('number', saved?.promotionalPrice); promo.min = '0'; promo.step = '0.01'; promo.dataset.variant = variant.id; promo.dataset.kind = 'promo'; promoCell.append(promo); row.append(label, normalCell, promoCell); tbody.append(row);
    }
    table.append(tbody); priceWrap.append(table); card.append(priceWrap);
    card.append(button('保存全部规格价格', 'button primary wide', async () => {
      try {
        const prices = state.review.variants.filter((item) => item.participateInPublish).map((variant) => {
          const normal = card.querySelector(`[data-variant="${variant.id}"][data-kind="normal"]`).value;
          const promo = card.querySelector(`[data-variant="${variant.id}"][data-kind="promo"]`).value;
          return { variantId: variant.id, price: Number(normal), promotionalPrice: promo ? Number(promo) : null, pricingBasis: state.quotes[site.id]?.basis || {} };
        });
        await api(`/api/products/${state.review.id}/listings/${site.id}/prices`, { method: 'PUT', body: JSON.stringify({ prices }) });
        toast(`${site.name} 规格价格已保存`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); container.append(card);
  }
}

function numericValue(id) {
  const value = $(id).value.trim();
  if (value === '') throw new Error('请完整填写报价计算依据');
  return Number(value);
}

async function calculateQuotes() {
  if (!state.review) return toast('请先选择产品', true);
  try {
    const common = {
      purchasePriceCny: numericValue('quotePurchase'), packedWeightG: numericValue('quoteWeight'),
      cnyPerUsd: numericValue('quoteCnyUsd'), internationalFreightUsd: numericValue('quoteFreight'),
      commissionRate: numericValue('quoteCommission'), taxRate: numericValue('quoteTax'),
      targetProfitUsd: numericValue('quoteProfit'), targetMarginRate: numericValue('quoteMargin'),
      promotionDiscountRate: numericValue('quoteDiscount')
    };
    const siteInputs = {};
    for (const site of sites) siteInputs[site.id] = {
      siteCurrencyPerUsd: numericValue(`quoteRate${site.id}`),
      localFulfillmentFee: numericValue(`quoteLocal${site.id}`),
      otherFixedCost: numericValue(`quoteOther${site.id}`)
    };
    const data = await api('/api/pricing/quote-all', { method: 'POST', body: JSON.stringify({ common, sites: siteInputs }) });
    state.quotes = Object.fromEntries(data.quotes.map((quote) => [quote.site, quote]));
    for (const quote of data.quotes) {
      const card = document.querySelector(`.country-card[data-site="${quote.site}"]`);
      if (!card) continue;
      card.querySelectorAll('[data-kind="normal"]').forEach((control) => { control.value = quote.normal.price; });
      card.querySelectorAll('[data-kind="promo"]').forEach((control) => { control.value = quote.promotion.price; });
    }
    $('quoteResults').textContent = data.quotes.map((quote) =>
      `${quote.country}: ${quote.normal.price} ${quote.currency} / 促销 ${quote.promotion.price} / 净收益 ${quote.promotion.netProfitUsd} USD / 利润率 ${(quote.promotion.netMarginRate * 100).toFixed(1)}%`
    ).join('　｜　');
    toast('三国价格已计算并填入，确认后再保存');
  } catch (error) { toast(error.message, true); }
}

async function accountId() {
  if (!state.accounts.length) state.accounts = (await api('/api/integrations/mercadolibre/accounts')).accounts || [];
  if (!state.accounts[0]?.id) throw new Error('没有已连接的美客多账号');
  return state.accounts[0].id;
}

async function discoverCategories() {
  if (!state.review) return;
  try {
    const id = await accountId();
    const spanishTitle = state.review.listings.find((item) => item.title)?.title || state.review.originalTitle;
    const data = await api(`/api/integrations/mercadolibre/accounts/${id}/category-discovery`, { method: 'POST', body: JSON.stringify({ query: spanishTitle, sites: sites.map((site) => site.id), limit: 5 }) });
    const container = $('categorySuggestions'); container.replaceChildren(); container.classList.remove('hidden');
    data.results.forEach((result) => { const box = document.createElement('article'); box.className = 'suggestion-site'; const heading = document.createElement('h4'); heading.textContent = result.site; box.append(heading); result.suggestions.forEach((item) => { const line = document.createElement('span'); line.className = 'suggestion-item'; line.textContent = `${item.categoryId} · ${item.categoryName}`; box.append(line); }); container.append(box); });
  } catch (error) { toast(error.message, true); }
}

async function markPendingPublish() {
  if (!state.review) return;
  try { await api(`/api/products/${state.review.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'pending_publish' }) }); toast('已标记为待发布'); await loadProducts(); await loadReview(state.review.id); } catch (error) { toast(error.message, true); }
}

async function preparePublish() {
  if (!state.products.length) await loadProducts();
  if ($('publishProductSelect').value) await loadJobs();
}

function renderPreflight(data) {
  const local = data.local || data; const summary = local.summary || {};
  const metrics = [['目标站点', (summary.targetSites || []).join(' / ') || '—'], ['规格数量', summary.variantCount ?? '—'], ['图片数量', summary.imageCount ?? '—'], ['刊登数量', summary.listingCount ?? '—']];
  $('preflightSummary').replaceChildren(...metrics.map(([label, value]) => { const card = document.createElement('article'); card.className = 'metric'; const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = value; card.append(span, strong); return card; }));
  const ok = data.ok ?? local.valid; $('preflightBadge').textContent = ok ? '预检通过' : '需要修复'; $('preflightBadge').className = `status-pill ${ok ? 'good' : 'bad'}`;
  const issues = [...(local.errors || []), ...(local.warnings || []).map((item) => ({ ...item, warning: true })), ...(data.remoteErrors || [])];
  const container = $('preflightIssues'); container.replaceChildren(); container.className = 'issues';
  if (!issues.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有发现阻塞项。'; container.append(empty); }
  issues.forEach((item) => { const node = document.createElement('div'); node.className = `issue${item.warning ? ' warning' : ''}`; node.textContent = `${item.code}${item.site ? ` · ${item.site}` : ''}${item.sellerSku ? ` · ${item.sellerSku}` : ''}${item.attributeId ? ` · ${item.attributeId}` : ''}`; container.append(node); });
  state.preview = data.preview || {}; $('payloadPreview').textContent = JSON.stringify(state.preview, null, 2);
}

async function runLocalPreflight() {
  const productId = $('publishProductSelect').value; if (!productId) return toast('请先选择产品', true);
  try { renderPreflight(await api(`/api/publish/${productId}/preflight`)); await loadJobs(); } catch (error) { toast(error.message, true); }
}

async function runRemotePreflight() {
  const productId = $('publishProductSelect').value; if (!productId) return toast('请先选择产品', true);
  try { const id = await accountId(); renderPreflight(await api(`/api/publish/${productId}/remote-preflight`, { method: 'POST', body: JSON.stringify({ accountId: id }) })); await loadJobs(); } catch (error) { toast(error.message, true); }
}

async function loadJobs() {
  const productId = $('publishProductSelect').value; if (!productId) return;
  try {
    const data = await api(`/api/publish/jobs?productId=${encodeURIComponent(productId)}`); const body = $('jobsBody'); body.replaceChildren();
    data.jobs.forEach((job) => { const row = document.createElement('tr'); [new Date(job.created_at).toLocaleString('zh-CN'), job.site, job.status, job.http_status ?? '—', job.error_code ?? '—', job.error_message ?? '—'].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }); body.append(row); });
  } catch (error) { toast(error.message, true); }
}

async function boot() {
  const session = await fetch('/console/api/session', { credentials: 'same-origin' }).then((response) => response.json()).catch(() => ({ configured: false }));
  if (!session.configured) return showLogin('可视化控制台尚未在服务器环境变量中配置。');
  if (!session.authenticated) return showLogin();
  showApp(); await loadProducts();
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('loginError').textContent = '';
  try {
    await api('/console/api/login', { method: 'POST', body: JSON.stringify({ password: $('loginPassword').value }) });
    $('loginPassword').value = ''; showApp(); await loadProducts();
  } catch (error) { $('loginError').textContent = error.message; }
});
$('logoutButton').addEventListener('click', async () => { await api('/console/api/logout', { method: 'POST', body: '{}' }).catch(() => {}); showLogin(); });
$('navigation').addEventListener('click', (event) => { const target = event.target.closest('[data-page]'); if (target) navigate(target.dataset.page); });
document.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => navigate(node.dataset.go)));
$('refreshProducts').addEventListener('click', loadProducts); $('productStatusFilter').addEventListener('change', loadProducts);
$('addVariant').addEventListener('click', () => addImportVariant());
$('fillSixColors').addEventListener('click', () => { $('importVariantsBody').replaceChildren(); [['BLK','Black'],['WHT','White'],['GRY','Gray'],['GRN','Green'],['PNK','Pink'],['CRM','Cream']].forEach(([code,color]) => addImportVariant({ sellerSku:`MESH-4C-${code}`, color, stock:10, purchasePriceCny:12.13, packedWeightG:650 })); });
$('importForm').addEventListener('submit', createProduct); addImportVariant();
$('reviewProductSelect').addEventListener('change', (event) => loadReview(event.target.value)); $('reloadReview').addEventListener('click', () => loadReview($('reviewProductSelect').value));
$('uploadMedia').addEventListener('click', uploadMedia); $('discoverCategories').addEventListener('click', discoverCategories); $('markPendingPublish').addEventListener('click', markPendingPublish);
$('calculateQuotes').addEventListener('click', calculateQuotes);
$('publishProductSelect').addEventListener('change', loadJobs); $('runLocalPreflight').addEventListener('click', runLocalPreflight); $('runRemotePreflight').addEventListener('click', runRemotePreflight); $('refreshJobs').addEventListener('click', loadJobs);
$('copyPreview').addEventListener('click', async () => { await navigator.clipboard.writeText(JSON.stringify(state.preview, null, 2)); toast('JSON 已复制'); });
boot().catch((error) => showLogin(error.message));
