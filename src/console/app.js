const state = {
  products: [], review: null, accounts: [], preview: {}, quotes: {},
  aiProduct: null, aiWorkspace: null, aiDrafts: null, aiImagePlan: null,
  publishRequestKeys: {}, remotePreflightOk: {}
};
const sites = [
  { id: 'MLM', name: 'Mexico', currency: 'USD', localCurrency: 'MXN' },
  { id: 'MCO', name: 'Colombia', currency: 'USD', localCurrency: 'COP' },
  { id: 'MLC', name: 'Chile', currency: 'USD', localCurrency: 'CLP' }
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
    const error = new Error(body.message || body.error || details || `HTTP ${response.status}`);
    error.code = body.error || 'request_failed'; error.status = response.status; error.details = body.details;
    throw error;
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

function updatePublishSafetyBadge(enabled) {
  const badge = $('publishSafetyBadge');
  if (!badge) return;
  badge.textContent = enabled ? '正式发布已开启' : '正式发布已关闭';
  badge.classList.toggle('bad', !enabled);
  badge.classList.toggle('good', enabled);
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
  const titles = { products: '产品列表', import: '导入产品', ai: 'AI 内容工作台', review: '人工审核与报价', publish: '发布预检' };
  $('pageTitle').textContent = titles[page];
  if (page === 'products') loadProducts();
  if (page === 'ai') prepareAiWorkspace();
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
    const action = document.createElement('td');
    const actionWrap = document.createElement('div'); actionWrap.className = 'table-actions';
    actionWrap.append(
      button('AI处理', 'button accent small', () => openAi(product.id)),
      button('审核', 'button ghost small', () => openReview(product.id))
    );
    action.append(actionWrap); row.append(action);
    body.append(row);
  }
}

function populateProductSelects() {
  for (const id of ['aiProductSelect', 'reviewProductSelect', 'publishProductSelect']) {
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

function parseObject(id, label) {
  const value = $(id).value.trim();
  if (!value) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是JSON对象`);
  return parsed;
}

function pretty(value) { return JSON.stringify(value ?? {}, null, 2); }

function mergeObjects(...values) {
  const result = {};
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, next] of Object.entries(value)) {
      if (next && typeof next === 'object' && !Array.isArray(next)
          && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = mergeObjects(result[key], next);
      } else result[key] = structuredClone(next);
    }
  }
  return result;
}

async function withBusy(control, workingLabel, task) {
  const original = control.textContent;
  control.disabled = true; control.textContent = workingLabel;
  try { return await task(); } finally { control.disabled = false; control.textContent = original; }
}

async function prepareAiWorkspace() {
  if (!state.products.length) await loadProducts();
  if ($('aiProductSelect').value) await loadAiWorkspace($('aiProductSelect').value);
}

function openAi(productId) {
  navigate('ai'); $('aiProductSelect').value = productId; loadAiWorkspace(productId);
}

async function loadAiWorkspace(productId) {
  if (!productId) return;
  try {
    const [product, workspace] = await Promise.all([
      api(`/api/products/${productId}`),
      api(`/api/ai/products/${productId}/workspace`)
    ]);
    state.aiProduct = product; state.aiWorkspace = workspace;
    $('aiEmpty').classList.add('hidden'); $('aiContent').classList.remove('hidden');
    $('aiProductName').textContent = product.originalTitle;
    $('aiProductMeta').textContent = `${product.internalCode} · ${product.variants.length} 个规格 · ${product.targetSites.join(' / ')}`;
    $('aiFactRevision').textContent = `版本 ${workspace.factSheet.revision}`;
    $('manualFacts').value = pretty(workspace.factSheet.manualFacts);
    $('aiSuggestions').value = pretty(workspace.factSheet.aiSuggestions);
    $('confirmedFacts').value = pretty(workspace.factSheet.confirmedFacts);
    $('aiEvidence').textContent = pretty({ confidence: workspace.factSheet.confidence, evidence: workspace.factSheet.evidence });
    const provider = workspace.provider;
    $('aiProviderBadge').textContent = provider.configured
      ? `${provider.name}${provider.imageGenerationConfigured ? ' · 文案+图片' : ' · 仅文案'}` : 'AI未配置 · 可手工使用';
    $('aiProviderBadge').className = `status-pill ${provider.configured ? 'good' : 'warn'}`;
    $('runAiAnalysis').disabled = !provider.configured;
    $('generateAiCopy').disabled = !provider.configured;
    $('generateImagePlan').disabled = !provider.configured;
    $('generateWhiteBackground').disabled = !provider.imageGenerationConfigured;
    renderAiMedia(); renderAiJobs();
    const copy = workspace.generations.find((item) => item.generation_type === 'listing_copy' && item.status === 'completed');
    const plan = workspace.generations.find((item) => item.generation_type === 'image_plan' && item.status === 'completed');
    state.aiDrafts = copy?.output ?? null; state.aiImagePlan = plan?.output ?? null;
    renderAiListingDrafts(state.aiDrafts); renderAiImagePlan(state.aiImagePlan);
  } catch (error) { toast(error.message, true); }
}

function renderAiMedia() {
  const grid = $('aiMediaGrid'); grid.replaceChildren();
  const reference = $('aiReferenceMedia'); const previous = reference.value;
  reference.replaceChildren(option('', '选择真实产品参考图'));
  const images = state.aiProduct.media.filter((item) => item.media_type === 'image');
  if (!images.length) {
    const empty = document.createElement('div'); empty.className = 'panel empty'; empty.textContent = '请先批量上传产品图片。'; grid.append(empty); return;
  }
  images.forEach((media) => {
    const card = document.createElement('article'); card.className = 'media-card';
    const check = input('checkbox'); check.className = 'media-check'; check.dataset.mediaId = media.id;
    check.checked = media.role === 'original' || media.role === 'detail' || media.role === 'dimension';
    const image = document.createElement('img'); image.src = `/api/products/${state.aiProduct.id}/media/${media.id}/content`; image.alt = media.alt_text || ''; image.loading = 'lazy';
    const label = document.createElement('small'); label.textContent = `${media.role} · ${media.original_filename}`;
    card.append(check, image, label);
    const sync = () => card.classList.toggle('selected', check.checked); sync();
    check.addEventListener('change', sync);
    card.addEventListener('click', (event) => { if (event.target !== check) { check.checked = !check.checked; sync(); } });
    grid.append(card);
    reference.append(option(media.id, `${media.role} · ${media.original_filename}`));
  });
  if (images.some((item) => item.id === previous)) reference.value = previous;
  else reference.value = images.find((item) => item.role === 'original')?.id ?? images[0].id;
}

function selectedAiMediaIds() {
  return [...$('aiMediaGrid').querySelectorAll('[data-media-id]:checked')].map((node) => node.dataset.mediaId);
}

async function uploadProductFiles(productId, files, role) {
  if (!files.length) throw new Error('请先选择图片');
  for (const file of files) {
    const data = new FormData(); data.append('role', role); data.append('file', file);
    await api(`/api/products/${productId}/media`, { method: 'POST', body: data });
  }
}

async function uploadAiMedia() {
  if (!state.aiProduct) return toast('请先选择产品', true);
  const files = [...$('aiUploadFiles').files];
  try {
    await withBusy($('uploadAiMedia'), `上传中 0/${files.length}`, async () => {
      await uploadProductFiles(state.aiProduct.id, files, $('aiUploadRole').value);
    });
    $('aiUploadFiles').value = ''; toast(`已上传 ${files.length} 张图片`); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

async function saveAiFacts(kind) {
  if (!state.aiProduct) return;
  try {
    const isManual = kind === 'manual';
    const payload = isManual
      ? { manualFacts: parseObject('manualFacts', '手工事实') }
      : { confirmedFacts: parseObject('confirmedFacts', '确认事实') };
    await api(`/api/ai/products/${state.aiProduct.id}/facts`, { method: 'PUT', body: JSON.stringify(payload) });
    toast(isManual ? '手工事实已保存' : '人工确认事实已保存'); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

async function runAiAnalysis() {
  if (!state.aiProduct) return;
  try {
    await withBusy($('runAiAnalysis'), 'AI分析中…', async () => {
      await api(`/api/ai/products/${state.aiProduct.id}/analyze`, {
        method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID(), selectedMediaIds: selectedAiMediaIds() })
      });
    });
    toast('AI事实建议已生成，请人工确认'); await loadAiWorkspace(state.aiProduct.id); await loadProducts();
  } catch (error) { toast(error.message, true); }
}

function renderAiListingDrafts(drafts) {
  const container = $('aiListingDrafts'); container.replaceChildren();
  if (!drafts?.listings) {
    const empty = document.createElement('div'); empty.className = 'panel empty span-all'; empty.textContent = '尚未生成文案。您也可以直接在“审核与报价”页面手工填写。'; container.append(empty); return;
  }
  for (const site of sites) {
    const draft = drafts.listings[site.id]; if (!draft) continue;
    const card = document.createElement('article'); card.className = 'panel country-card ai-copy-card'; card.dataset.site = site.id;
    const head = document.createElement('div'); head.className = 'country-head';
    const title = document.createElement('h4'); title.textContent = site.name;
    const code = document.createElement('span'); code.className = 'flag-code'; code.textContent = `${site.id} · ${site.currency}`; head.append(title, code); card.append(head);
    const stack = document.createElement('div'); stack.className = 'field-stack';
    const controls = {};
    for (const [name, label, value, rows] of [
      ['title', '西班牙语标题', draft.title, 2],
      ['description', 'English Description', draft.descriptionEnglish, 7],
      ['specifications', 'English Specifications JSON', pretty(draft.specificationsEnglish), 7],
      ['attributes', '类目属性建议 JSON', pretty(draft.attributeSuggestions), 7]
    ]) {
      const field = document.createElement('label'); field.textContent = label;
      const control = document.createElement('textarea'); control.value = value || ''; control.rows = rows; control.dataset.aiField = name; controls[name] = control; field.append(control); stack.append(field);
    }
    const alternatives = document.createElement('small'); alternatives.className = 'muted'; alternatives.textContent = `备选标题：${(draft.titleAlternatives || []).join(' ｜ ') || '无'}`; stack.append(alternatives);
    stack.append(button('人工确认并保存到刊登草稿', 'button primary wide', () => saveAiListing(site, controls, drafts.familyName)));
    card.append(stack); container.append(card);
  }
}

async function saveAiListing(site, controls, familyName) {
  try {
    const specificationsEnglish = JSON.parse(controls.specifications.value || '{}');
    const requiredAttributes = JSON.parse(controls.attributes.value || '{}');
    await api(`/api/products/${state.aiProduct.id}/listings/${site.id}`, {
      method: 'PUT', body: JSON.stringify({
        title: controls.title.value.trim(), descriptionEnglish: controls.description.value.trim(),
        specificationsEnglish, requiredAttributes, familyName, currency: site.currency
      })
    });
    toast(`${site.name} 文案已由人工确认并保存`);
    state.aiProduct = await api(`/api/products/${state.aiProduct.id}`);
  } catch (error) { toast(error.message, true); }
}

async function generateAiCopy() {
  if (!state.aiProduct) return;
  try {
    let connectedAccountId = null;
    try { connectedAccountId = await accountId(); } catch { connectedAccountId = null; }
    const result = await withBusy($('generateAiCopy'), '生成三国文案中…', () => api(`/api/ai/products/${state.aiProduct.id}/listing-drafts`, {
      method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID(), selectedSites: sites.map((site) => site.id), accountId: connectedAccountId })
    }));
    state.aiDrafts = result; renderAiListingDrafts(result); toast('三国文案草稿已生成，保存前请逐项审核'); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

function renderAiImagePlan(plan) {
  const container = $('aiImagePlan'); container.replaceChildren();
  if (!plan?.images) {
    const empty = document.createElement('div'); empty.className = 'panel empty span-all'; empty.textContent = '尚未生成图片方案。可以先上传图片并确认产品事实。'; container.append(empty); return;
  }
  plan.images.forEach((item) => {
    const card = document.createElement('article'); card.className = 'panel plan-card';
    const heading = document.createElement('h4'); heading.textContent = `${item.order}. ${item.title}`;
    const meta = document.createElement('div'); meta.className = 'plan-meta';
    for (const text of [item.role, item.variantScope, item.useRealProductCutout ? '真实产品主体' : '无需主体']) {
      const chip = document.createElement('span'); chip.className = 'step-chip'; chip.textContent = text; meta.append(chip);
    }
    const prompt = document.createElement('textarea'); prompt.rows = 8; prompt.value = item.prompt; prompt.dataset.planPrompt = String(item.order);
    const policy = document.createElement('small'); policy.className = 'muted'; policy.textContent = `文字规则：${item.textPolicy}`;
    const generate = button('用参考图生成草稿', 'button secondary wide', () => generateAiImage(item, prompt, generate));
    if (!state.aiWorkspace.provider.imageGenerationConfigured) generate.disabled = true;
    card.append(heading, meta, prompt, policy, generate); container.append(card);
  });
}

async function generateImagePlan() {
  if (!state.aiProduct) return;
  try {
    const result = await withBusy($('generateImagePlan'), '规划7–10张图片中…', () => api(`/api/ai/products/${state.aiProduct.id}/image-plan`, {
      method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID() })
    }));
    state.aiImagePlan = result; renderAiImagePlan(result); toast('图片方案已生成，可逐张修改提示词'); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

async function generateAiImage(item, promptControl, control) {
  const referenceMediaId = $('aiReferenceMedia').value;
  if (!referenceMediaId) return toast('请先选择真实产品参考图', true);
  try {
    await withBusy(control, '图片生成中…', () => api(`/api/ai/products/${state.aiProduct.id}/generate-image`, {
      method: 'POST', body: JSON.stringify({
        requestKey: crypto.randomUUID(), referenceMediaId, role: item.role, prompt: promptControl.value.trim()
      })
    }));
    toast('图片草稿已生成并标记为待审核'); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

async function generateWhiteBackground() {
  const referenceMediaId = $('aiReferenceMedia').value;
  if (!state.aiProduct || !referenceMediaId) return toast('请先选择真实产品参考图', true);
  try {
    await withBusy($('generateWhiteBackground'), '白底图生成中…', () => api(`/api/ai/products/${state.aiProduct.id}/white-background`, {
      method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID(), referenceMediaId })
    }));
    toast('白底图草稿已生成，请检查结构和颜色'); await loadAiWorkspace(state.aiProduct.id);
  } catch (error) { toast(error.message, true); }
}

function renderAiJobs() {
  const body = $('aiJobsBody'); body.replaceChildren();
  state.aiWorkspace.generations.forEach((job) => {
    const row = document.createElement('tr');
    [new Date(job.created_at).toLocaleString('zh-CN'), job.generation_type, `${job.provider}${job.model ? ` · ${job.model}` : ''}`, job.status, job.error_message || '—']
      .forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    body.append(row);
  });
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
    renderReviewVariants(); renderMedia(); renderVariantImageMap(); renderListings();
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
    const netProceeds = input('number', variant.globalNetProceedsUsd); netProceeds.min = '0.01'; netProceeds.step = '0.01';
    [sku, color, size, stock, netProceeds].forEach((control) => { const cell = document.createElement('td'); cell.append(control); row.append(cell); });
    const participateCell = document.createElement('td'); const participate = input('checkbox'); participate.checked = variant.participateInPublish; participateCell.append(participate); row.append(participateCell);
    const primaryCell = document.createElement('td'); const primary = primaryFor(variant.id); primaryCell.textContent = primary ? primary.original_filename : '未设置'; row.append(primaryCell);
    const action = document.createElement('td'); action.append(button('保存', 'button secondary small', async () => {
      try {
        await api(`/api/products/${state.review.id}/variants/${variant.id}`, { method: 'PATCH', body: JSON.stringify({ sellerSku: sku.value, color: color.value || null, size: size.value || null, stock: Number(stock.value), globalNetProceedsUsd: netProceeds.value ? Number(netProceeds.value) : null, participateInPublish: participate.checked }) });
        toast(`规格 ${sku.value} 已保存`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); row.append(action); body.append(row);
  }
}

function renderMedia() {
  const grid = $('mediaGrid'); grid.replaceChildren();
  if (!state.review.media.length) { const empty = document.createElement('div'); empty.className = 'panel empty'; empty.textContent = '还没有图片。'; grid.append(empty); return; }
  const images = state.review.media.filter((item) => item.media_type === 'image');
  for (const [index, media] of images.entries()) {
    const card = document.createElement('article'); card.className = 'media-card';
    const number = document.createElement('span'); number.className = 'media-number'; number.textContent = index + 1; card.append(number);
    const image = document.createElement('img'); image.src = `/api/products/${state.review.id}/media/${media.id}/content`; image.alt = media.alt_text || ''; image.loading = 'lazy'; card.append(image);
    const name = document.createElement('small'); name.textContent = `${media.role} · ${media.original_filename}`; card.append(name);
    const status = document.createElement('small'); status.className = `media-status ${media.validation_status === 'ready' ? 'good' : ''}`; status.textContent = `审核：${media.validation_status || 'pending'}${media.mercado_picture_id ? ' · 已上传美客多' : ''}`; card.append(status);
    const select = document.createElement('select'); select.append(option('', '关联到颜色规格'));
    state.review.variants.forEach((variant) => select.append(option(variant.id, `${variant.color || variant.size || '规格'} · ${variant.sellerSku}`))); card.append(select);
    card.append(button('审核通过', 'button ghost small wide', async () => {
      try {
        await api(`/api/products/${state.review.id}/media/${media.id}`, { method: 'PATCH', body: JSON.stringify({ validationStatus: 'ready' }) });
        toast('图片已标记为审核通过'); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    }));
    card.append(button('添加到该规格', 'button ghost small wide', async () => {
      if (!select.value) return toast('请先选择规格', true);
      try {
        await api(`/api/products/${state.review.id}/variants/${select.value}/media/${media.id}`, { method: 'POST', body: JSON.stringify({ isPrimary: false, sortOrder: index + 1 }) });
        toast(`图片 #${index + 1} 已加入规格`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    }));
    card.append(button('设为该规格主图', 'button secondary small wide', async () => {
      if (!select.value) return toast('请先选择规格', true);
      try {
        await api(`/api/products/${state.review.id}/variants/${select.value}/media/${media.id}`, { method: 'POST', body: JSON.stringify({ isPrimary: true, sortOrder: 0 }) });
        toast('主图关联已保存'); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); grid.append(card);
  }
}

function effectiveMediaForVariant(variantId) {
  const linked = state.review.variantMedia.filter((item) => item.variant_id === variantId);
  return linked.map((item) => state.review.media.find((media) => media.id === item.media_id))
    .filter(Boolean).slice(0, 10);
}

function renderVariantImageMap() {
  const container = $('variantImageMap'); container.replaceChildren();
  const images = state.review.media.filter((item) => item.media_type === 'image');
  const numberById = new Map(images.map((media, index) => [media.id, index + 1]));
  for (const variant of state.review.variants) {
    const card = document.createElement('article'); card.className = 'panel variant-image-card';
    const heading = document.createElement('div'); heading.className = 'variant-image-heading';
    const title = document.createElement('strong'); title.textContent = `${variant.color || variant.size || '规格'} · ${variant.sellerSku}`;
    const count = document.createElement('span'); const selected = effectiveMediaForVariant(variant.id); count.textContent = `${selected.length}/10 张`;
    heading.append(title, count); card.append(heading);
    const chips = document.createElement('div'); chips.className = 'image-number-list';
    if (!selected.length) { const empty = document.createElement('span'); empty.className = 'muted'; empty.textContent = '未选择图片'; chips.append(empty); }
    for (const media of selected) {
      const chip = document.createElement('span'); chip.className = 'image-number-chip';
      const label = document.createElement('span'); label.textContent = `#${numberById.get(media.id)}`; label.title = media.original_filename;
      const remove = button('×', 'image-remove', async () => {
        try {
          await api(`/api/products/${state.review.id}/variants/${variant.id}/media/${media.id}`, { method: 'DELETE' });
          toast(`已从 ${variant.sellerSku} 移除图片 #${numberById.get(media.id)}`); await loadReview(state.review.id);
        } catch (error) { toast(error.message, true); }
      });
      remove.title = `从该规格移除 ${media.original_filename}`; chip.append(label, remove); chips.append(chip);
    }
    card.append(chips); container.append(card);
  }
}

async function uploadMedia() {
  const files = [...$('mediaFile').files];
  if (!files.length || !state.review) return toast('请先选择图片', true);
  try {
    await withBusy($('uploadMedia'), `上传 ${files.length} 张图片中…`, () => uploadProductFiles(state.review.id, files, $('mediaRole').value));
    $('mediaFile').value = ''; toast(`已上传 ${files.length} 张图片`); await loadReview(state.review.id);
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
      ['title', '西班牙语标题', listing.title || '', 'input'], ['categoryId', '站点类目 ID', listing.categoryId || '', 'input'],
      ['globalCategoryId', 'CBT 全局类目 ID', listing.familyData?.globalCategoryId || '', 'input'],
      ['familyName', 'Family 名称（English，≤60字符）', listing.familyName || '', 'input'], ['descriptionEnglish', 'English Description', listing.descriptionEnglish || '', 'textarea'],
      ['globalAttributes', 'CBT 必填属性 JSON', JSON.stringify(listing.familyData?.globalAttributes || {}, null, 2), 'textarea'],
      ['globalSaleTerms', 'CBT Sale Terms JSON 数组', JSON.stringify(listing.familyData?.globalSaleTerms || [], null, 2), 'textarea'],
      ['requiredAttributes', '必填属性 JSON', JSON.stringify(listing.requiredAttributes || {}, null, 2), 'textarea']
    ]) {
      const label = document.createElement('label'); label.textContent = field[1]; const control = document.createElement(field[3]); control.value = field[2]; if (field[3] === 'textarea') control.rows = field[0] === 'descriptionEnglish' ? 5 : 6; control.dataset.field = field[0]; controls[field[0]] = control; label.append(control); stack.append(label);
    }
    stack.append(button('保存刊登资料', 'button secondary', async () => {
      try {
        const requiredAttributes = controls.requiredAttributes.value.trim() ? JSON.parse(controls.requiredAttributes.value) : {};
        const globalAttributes = controls.globalAttributes.value.trim() ? JSON.parse(controls.globalAttributes.value) : {};
        const globalSaleTerms = controls.globalSaleTerms.value.trim() ? JSON.parse(controls.globalSaleTerms.value) : [];
        if (!Array.isArray(globalSaleTerms)) throw new Error('CBT Sale Terms 必须是 JSON 数组');
        await api(`/api/products/${state.review.id}/listings/${site.id}`, { method: 'PUT', body: JSON.stringify({ title: controls.title.value, categoryId: controls.categoryId.value, familyName: controls.familyName.value, familyData: { ...(listing.familyData || {}), globalCategoryId: controls.globalCategoryId.value.trim() || null, globalAttributes, globalSaleTerms }, descriptionEnglish: controls.descriptionEnglish.value, requiredAttributes, currency: site.currency }) });
        toast(`${site.name} 刊登资料已保存`); await loadReview(state.review.id);
      } catch (error) { toast(error.message, true); }
    })); card.append(stack);

    const priceWrap = document.createElement('div'); priceWrap.className = 'price-table'; const table = document.createElement('table'); const tbody = document.createElement('tbody');
    const header = document.createElement('thead'); const headerRow = document.createElement('tr'); ['规格', '预估正常售价 USD', '预估促销售价 USD'].forEach((text) => { const th = document.createElement('th'); th.textContent = text; headerRow.append(th); }); header.append(headerRow); table.append(header);
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
      card.querySelectorAll('[data-kind="normal"]').forEach((control) => { control.value = (quote.normal.price / quote.basis.siteCurrencyPerUsd).toFixed(2); });
      card.querySelectorAll('[data-kind="promo"]').forEach((control) => { control.value = (quote.promotion.price / quote.basis.siteCurrencyPerUsd).toFixed(2); });
    }
    $('quoteResults').textContent = data.quotes.map((quote) =>
      `${quote.country}: ${quote.normal.price} ${quote.currency}（API ${(quote.normal.price / quote.basis.siteCurrencyPerUsd).toFixed(2)} USD）/ 促销 ${quote.promotion.price} / 净收益 ${quote.promotion.netProfitUsd} USD / 利润率 ${(quote.promotion.netMarginRate * 100).toFixed(1)}%`
    ).join('　｜　');
    toast('三国价格已计算并填入，确认后再保存');
  } catch (error) { toast(error.message, true); }
}

async function accountId() {
  if (!state.accounts.length) state.accounts = (await api('/api/integrations/mercadolibre/accounts')).accounts || [];
  if (!state.accounts[0]?.id) throw new Error('没有已连接的美客多账号');
  return state.accounts[0].id;
}

function itemInspectionSummary(data) {
  const item = data.item || {};
  const globalItem = data.globalItem || {};
  const userProduct = data.userProduct || {};
  const sellerSkuAttribute = (item.attributes || []).find((attribute) => attribute.id === 'SELLER_SKU');
  return {
    itemId: item.id || null,
    cbtItemId: item.cbtItemId || null,
    siteId: item.siteId || null,
    status: item.status || null,
    title: item.title || null,
    categoryId: item.categoryId || null,
    price: item.price || null,
    currencyId: item.currencyId || null,
    availableQuantity: item.availableQuantity ?? null,
    sellerSku: item.sellerCustomField || sellerSkuAttribute?.valueName || null,
    netProceeds: item.netProceeds || null,
    userProductId: item.userProductId || null,
    sitelessUserProductId: globalItem.sitelessUserProductId || userProduct.id || null,
    parentUserProductId: globalItem.parentUserProductId || null,
    globalCategoryId: globalItem.categoryId || null,
    familyId: userProduct.familyId || globalItem.familyId || null,
    familyName: userProduct.familyName || globalItem.familyName || item.familyName || null,
    attributes: item.attributes || [],
    description: data.description?.plainText || null,
    pictures: item.pictures || [],
    lookups: data.lookups || {}
  };
}

async function inspectExistingItems() {
  const requested = ['MCO', 'MLC'].map((site) => ({
    site,
    itemId: $(`existingItem${site}`).value.trim().toUpperCase()
  })).filter((item) => item.itemId);
  if (!requested.length) return toast('请至少填写一个Item ID', true);
  try {
    const id = await accountId();
    $('itemInspectionResults').classList.remove('hidden');
    for (const request of requested) {
      const badge = $(`itemInspectionBadge${request.site}`);
      badge.textContent = '读取中'; badge.className = 'status-pill';
      try {
        const data = await api(`/api/integrations/mercadolibre/accounts/${id}/items/${encodeURIComponent(request.itemId)}`);
        $(`itemInspection${request.site}`).textContent = JSON.stringify(itemInspectionSummary(data), null, 2);
        badge.textContent = '读取成功'; badge.className = 'status-pill good';
      } catch (error) {
        $(`itemInspection${request.site}`).textContent = JSON.stringify({ error: error.message }, null, 2);
        badge.textContent = '读取失败'; badge.className = 'status-pill bad';
      }
    }
  } catch (error) { toast(error.message, true); }
}

async function discoverCategories() {
  if (!state.review) return;
  try {
    const id = await accountId();
    const spanishTitle = state.review.listings.find((item) => item.title)?.title || state.review.originalTitle;
    const data = await api(`/api/integrations/mercadolibre/accounts/${id}/category-discovery`, { method: 'POST', body: JSON.stringify({ query: spanishTitle, sites: ['CBT', ...sites.map((site) => site.id)], limit: 5 }) });
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

function selectedPublishSites() {
  return [...document.querySelectorAll('input[name="publishSite"]:checked')].map((input) => input.value);
}

function publishSelection() {
  const productId = $('publishProductSelect').value;
  if (!productId) throw new Error('请先选择产品');
  const sites = selectedPublishSites();
  if (!sites.length) throw new Error('请至少选择一个发布国家');
  const publishMode = $('familyPublishMode').value;
  const existingItemId = $('existingFamilyItemId').value.trim().toUpperCase();
  if (publishMode === 'update' && !existingItemId) throw new Error('更新既有 Family 时必须填写原商品 ID');
  return { productId, sites, publishMode, existingItemId,
    key: `${productId}:${sites.join(',')}:${publishMode}:${existingItemId}` };
}

function invalidatePublishPreview() {
  state.preview = {}; $('payloadPreview').textContent = '{}';
  $('preflightBadge').textContent = '尚未运行'; $('preflightBadge').className = 'status-pill';
  $('preflightIssues').textContent = '站点选择已变化，请重新运行预检。';
}

function renderPreflight(data) {
  const local = data.local || data; const summary = local.summary || {};
  const proceeds = summary.globalNetProceedsUsd || [];
  const proceedsText = proceeds.length ? `${Math.min(...proceeds.map((item) => item.amount))}–${Math.max(...proceeds.map((item) => item.amount))} USD` : '—';
  const metrics = [['目标站点', (summary.targetSites || []).join(' / ') || '—'], ['规格数量', summary.variantCount ?? '—'], ['图片数量', summary.imageCount ?? '—'], ['UP净收益', proceedsText]];
  $('preflightSummary').replaceChildren(...metrics.map(([label, value]) => { const card = document.createElement('article'); card.className = 'metric'; const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = value; card.append(span, strong); return card; }));
  const ok = data.ok ?? local.valid; $('preflightBadge').textContent = ok ? '预检通过' : '需要修复'; $('preflightBadge').className = `status-pill ${ok ? 'good' : 'bad'}`;
  const issues = [
    ...(local.errors || []),
    ...(local.warnings || []).map((item) => ({ ...item, warning: true })),
    ...(data.remoteErrors || []),
    ...(data.missingRequiredAttributes || []).map((item) => ({
      ...item,
      code: item.categoryId?.startsWith('CBT') ? 'missing_cbt_attribute' : 'missing_local_calibration_attribute',
      warning: !item.categoryId?.startsWith('CBT')
    }))
  ];
  const container = $('preflightIssues'); container.replaceChildren(); container.className = 'issues';
  if (!issues.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有发现阻塞项。'; container.append(empty); }
  issues.forEach((item) => { const node = document.createElement('div'); node.className = `issue${item.warning ? ' warning' : ''}`; node.textContent = `${item.code}${item.site ? ` · ${item.site}` : ''}${item.sellerSku ? ` · ${item.sellerSku}` : ''}${item.attributeId ? ` · ${item.attributeId}` : ''}`; container.append(node); });
  state.preview = data.preview || {}; $('payloadPreview').textContent = JSON.stringify(state.preview, null, 2);
  if (data.readOnly === true) {
    try { state.remotePreflightOk[publishSelection().key] = Boolean(data.ok); } catch {}
  }
}

async function runLocalPreflight() {
  try {
    const { productId, sites, key } = publishSelection(); state.remotePreflightOk[key] = false;
    renderPreflight(await api(`/api/publish/${productId}/preflight?sites=${encodeURIComponent(sites.join(','))}`)); await loadJobs();
  } catch (error) { toast(error.message, true); }
}

async function runRemotePreflight() {
  try {
    const { productId, sites, publishMode, existingItemId } = publishSelection(); const id = await accountId();
    renderPreflight(await api(`/api/publish/${productId}/remote-preflight`, { method: 'POST', body: JSON.stringify({ accountId: id, sites, publishMode, existingItemId }) })); await loadJobs();
  } catch (error) { toast(error.message, true); }
}

async function uploadMeliPictures() {
  const productId = $('publishProductSelect').value; if (!productId) return toast('请先选择产品', true);
  if (!window.confirm('将已审核且已关联规格的图片上传到美客多图片服务？此操作不会创建刊登。')) return;
  try {
    const id = await accountId();
    const result = await api(`/api/publish/${productId}/upload-pictures`, {
      method: 'POST', body: JSON.stringify({ accountId: id, confirmation: 'UPLOAD_PICTURES' })
    });
    $('publishResult').textContent = JSON.stringify(result, null, 2);
    toast(`图片处理完成：新上传 ${result.uploaded?.length ?? 0} 张`);
    await runRemotePreflight();
  } catch (error) { toast(error.message, true); }
}

async function publishLive() {
  let selection;
  try { selection = publishSelection(); } catch (error) { return toast(error.message, true); }
  const { productId, sites, key, publishMode, existingItemId } = selection;
  if (!state.remotePreflightOk[key]) return toast('请先对当前所选国家完成并通过远程只读预检', true);
  if ($('publishConfirmation').value.trim() !== 'PUBLISH') return toast('请先输入 PUBLISH', true);
  const requestItems = state.preview?.request?.body || [];
  if (!requestItems.length) return toast('远程预检预览已失效，请重新运行远程预检', true);
  const targetSites = state.preview?.summary?.sites?.map((site) => site.id).join(' / ') || '—';
  const imageCount = new Set(requestItems.flatMap((item) => item.pictures?.map((picture) => picture.id) || [])).size;
  const proceeds = requestItems.map((item) => item.global_net_proceeds).join(', ');
  const actionText = publishMode === 'update'
    ? `更新既有 Family ${state.preview?.summary?.sitelessFamilyId || existingItemId}`
    : '创建新 Family';
  if (!window.confirm(`即将正式${actionText}\n国家：${targetSites}\nUser Product：${requestItems.length} 个\n图片：${imageCount} 张\nglobal_net_proceeds：${proceeds} USD\n\n确认继续？`)) return;
  try {
    const id = await accountId();
    state.publishRequestKeys ??= {};
    state.publishRequestKeys[key] ??= crypto.randomUUID();
    const result = await api(`/api/publish/${productId}/live`, {
      method: 'POST', body: JSON.stringify({
        accountId: id, confirmation: 'PUBLISH', requestKey: state.publishRequestKeys[key], sites,
        publishMode, existingItemId
      })
    });
    $('publishResult').textContent = JSON.stringify(result, null, 2);
    $('publishConfirmation').value = '';
    toast(result.idempotentReplay ? '已返回原发布结果，没有重复创建' : 'Family 发布请求已完成');
    await loadProducts(); await loadJobs();
  } catch (error) {
    if (state.publishRequestKeys && !['meli_transport_error', 'publish_reconciliation_required'].includes(error.code)) {
      delete state.publishRequestKeys[key];
    }
    toast(error.message, true); await loadJobs();
  }
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
  updatePublishSafetyBadge(Boolean(session.publishEnabled));
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
$('fillSixColors').addEventListener('click', () => { $('importVariantsBody').replaceChildren(); [['BLK','Black'],['WHT','White'],['GRY','Gray'],['GRN','Green'],['PNK','Pink'],['CRM','Cream']].forEach(([code,color]) => addImportVariant({ sellerSku:`DEMO-${code}`, color, stock:10 })); });
$('importForm').addEventListener('submit', createProduct); addImportVariant();
$('aiProductSelect').addEventListener('change', (event) => loadAiWorkspace(event.target.value));
$('reloadAiWorkspace').addEventListener('click', () => loadAiWorkspace($('aiProductSelect').value));
$('uploadAiMedia').addEventListener('click', uploadAiMedia);
$('saveManualFacts').addEventListener('click', () => saveAiFacts('manual'));
$('saveConfirmedFacts').addEventListener('click', () => saveAiFacts('confirmed'));
$('copyAiToConfirmed').addEventListener('click', () => {
  try {
    const merged = mergeObjects(parseObject('confirmedFacts', '确认事实'), parseObject('aiSuggestions', 'AI建议'));
    $('confirmedFacts').value = pretty(merged); toast('已复制到确认区，检查后点击“确认保存”');
  } catch (error) { toast(error.message, true); }
});
$('runAiAnalysis').addEventListener('click', runAiAnalysis);
$('generateAiCopy').addEventListener('click', generateAiCopy);
$('generateImagePlan').addEventListener('click', generateImagePlan);
$('generateWhiteBackground').addEventListener('click', generateWhiteBackground);
$('reviewProductSelect').addEventListener('change', (event) => loadReview(event.target.value)); $('reloadReview').addEventListener('click', () => loadReview($('reviewProductSelect').value));
$('uploadMedia').addEventListener('click', uploadMedia); $('discoverCategories').addEventListener('click', discoverCategories); $('markPendingPublish').addEventListener('click', markPendingPublish);
$('inspectExistingItems').addEventListener('click', inspectExistingItems);
$('calculateQuotes').addEventListener('click', calculateQuotes);
$('publishProductSelect').addEventListener('change', () => { document.querySelectorAll('input[name="publishSite"]').forEach((input) => { input.checked = false; }); invalidatePublishPreview(); loadJobs(); });
for (const id of ['familyPublishMode', 'existingFamilyItemId']) $(id).addEventListener('change', invalidatePublishPreview);
document.querySelectorAll('input[name="publishSite"]').forEach((input) => input.addEventListener('change', invalidatePublishPreview));
$('runLocalPreflight').addEventListener('click', runLocalPreflight); $('runRemotePreflight').addEventListener('click', runRemotePreflight); $('refreshJobs').addEventListener('click', loadJobs);
$('uploadMeliPictures').addEventListener('click', uploadMeliPictures); $('publishLive').addEventListener('click', publishLive);
$('copyPreview').addEventListener('click', async () => { await navigator.clipboard.writeText(JSON.stringify(state.preview, null, 2)); toast('JSON 已复制'); });
boot().catch((error) => showLogin(error.message));
