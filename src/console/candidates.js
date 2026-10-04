(() => {
  const $ = id => document.getElementById(id);
  let current = null, imported = null;
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const run = fn => async () => { try { await fn(); } catch (e) { toast(e.message, true); if (e.details?.errors) $('candidateIssues').textContent = e.details.errors.map(i => `${i.field}: ${i.message}`).join('\n'); } };
  const control = (value, change, type = 'text') => { const el = node('input'); el.type = type; if (type === 'checkbox') el.checked = value === true; else el.value = value ?? ''; el.addEventListener('change', () => change(type === 'checkbox' ? el.checked : type === 'number' ? el.value === '' ? null : Number(el.value) : el.value)); return el; };
  const label = (text, el) => { const l = node('label', text); l.append(el); return l; };
  const jsonEdit = (value, change, rows = 4) => { const el = node('textarea'); el.rows = rows; el.value = JSON.stringify(value, null, 2); el.addEventListener('change', () => { try { change(JSON.parse(el.value)); el.setCustomValidity(''); } catch { el.setCustomValidity('JSON格式错误'); el.reportValidity(); } }); return el; };
  const section = title => { const el = node('article', undefined, 'panel'); el.append(node('h3', title)); $('candidateEditor').append(el); return el; };
  const link = (text, url) => { const el = node('a', text, 'button secondary'); el.href = url; return el; };
  async function load() {
    const rows = await api('/api/candidates'); $('candidateList').replaceChildren();
    for (const r of rows) {
      const card = node('article', undefined, 'panel');
      card.append(node('h3', r.name), node('p', `${r.batchId || '无批次'} · ${r.targetSites.join(' / ')} · ${r.skus.filter(s => s.keep !== false).length}个SKU · ${r.issues.length}项待处理`, 'muted'));
      card.append(button(r.productId ? '查看已转换候选' : '编辑候选', 'button primary', run(async () => { current = await api(`/api/candidates/${r.id}`); render(); })));
      $('candidateList').append(card);
    }
    if (!rows.length) $('candidateList').append(node('p', '暂无候选。下载示例结构或导入分析数据包。', 'muted'));
  }
  function render() {
    $('candidateEditor').replaceChildren(); $('candidateDetail').classList.remove('hidden');
    $('candidateName').textContent = current.name; $('candidateIssues').textContent = current.issues.map(i => `${i.field}: ${i.message}`).join('\n') || '候选检查通过；正式草稿仍须CBT/Child PK核验和远程预检。';
    const general = section('第一步 · 英文选品草稿与货源确认');
    current.english ??= { title: current.familyName || '', description: current.descriptionEnglish || '', sellingPoints: [] };
    current.researchSources ??= [];
    general.append(label('产品名称', control(current.name, v => current.name = v)), label('批次', control(current.batchId, v => current.batchId = v)), label('1688货源链接', control(current.sourceUrl, v => current.sourceUrl = v)), label('英文Family标题（≤60字符）', control(current.english.title, v => current.english.title = v)), label('英文共用描述', textEdit(current.english.description, v => current.english.description = v)), label('英文卖点（一行一条）', textEdit(current.english.sellingPoints.join('\n'), v => current.english.sellingPoints = v.split('\n').map(x => x.trim()).filter(Boolean))), label('市场来源（JSON数组：platform/url/notes）', jsonEdit(current.researchSources, v => current.researchSources = v, 8)));
    for (const source of current.researchSources) {
      const result = source.lastFetch;
      general.append(node('p', `${source.platform} · ${source.url}\n${result ? `${result.status}：${result.reason || result.fields?.join(', ')}` : '尚未采集'}${source.extracted?.title ? `\n标题：${source.extracted.title}` : ''}${source.extracted?.categoryPath?.length ? `\n官方类目：${source.extracted.categoryPath.map(part => part.name).join(' → ')} (${source.extracted.categoryId})` : ''}`, 'muted'));
      if (source.extracted?.categoryId && current.targetSites.includes(source.platform)) general.append(button('采用此竞品的本地类目', 'button secondary', run(async () => {
        const item = current.sites[source.platform]; item.categoryId = source.extracted.categoryId;
        item.evidence ??= []; item.evidence.push({ url: source.url, itemTitle: source.extracted.title, categoryId: source.extracted.categoryId, categoryPath: source.extracted.categoryPath, fetchedAt: source.extracted.fetchedAt });
        await save(); toast('已录入竞品类目，请继续读取官方类目与规格属性');
      })));
      general.append(button('采集这条链接并预览', 'button secondary', run(async () => {
        await save();
        const matched = current.researchSources.find(item => item.url === source.url);
        let accountId;
        if (['MLM', 'MLB'].includes(matched.platform)) {
          const response = await api('/api/integrations/mercadolibre/accounts');
          const accounts = (response.accounts ?? response).filter(a => a.status === 'connected');
          accountId = accounts[0]?.id;
        }
        const extraction = await api(`/api/candidates/${current.id}/research/extract`, { method: 'POST', body: JSON.stringify({ revision: current.revision, url: matched.url, accountId }) });
        matched.lastFetch = { status: extraction.status, reason: extraction.reason, fields: extraction.fields, fetchedAt: extraction.fetchedAt };
        matched.extracted = extraction.status === 'extracted' ? { title: extraction.title, description: extraction.description, bullets: extraction.bullets, attributes: extraction.attributes, image: extraction.image, categoryId: extraction.categoryId, categoryPath: extraction.categoryPath, sourceMethod: extraction.sourceMethod, fetchedAt: extraction.fetchedAt } : null;
        await save(); toast(extraction.status === 'extracted' ? '已保存采集内容，请审核来源与规格' : `未获取有效商品内容：${extraction.reason}`, extraction.status !== 'extracted');
      })));
    }
    general.append(button('根据已录入来源生成英文建议', 'button secondary', run(async () => {
      await save(); const answer = await api(`/api/candidates/${current.id}/english/suggest`, { method: 'POST', body: JSON.stringify({ revision: current.revision }) });
      current.english = answer.proposal; render(); toast('英文建议已填入，请核对后保存');
    })));
    for (const [key, fact] of Object.entries(current.facts)) factEditor(general, key, fact);
    const category = section('MX / BR 类目树与规格核验');
    category.append(node('p', '先根据美客多同类商品确定实际末级类目；竞品和预测结果需分别记录，官方查询只确认类目树和规格属性。', 'muted'));
    for (const site of ['MLM', 'MLB']) {
      const active = current.targetSites.includes(site);
      category.append(label(`${site}纳入候选`, control(active, v => {
        if (v) { current.targetSites.push(site); current.sites[site] ??= { title: '', description: '', categoryId: '', cbtCategoryId: '', evidence: [] }; }
        else current.targetSites = current.targetSites.filter(s => s !== site);
        render();
      }, 'checkbox')));
      if (!active) continue;
      const item = current.sites[site], check = current.categoryChecks[site];
      category.append(node('h4', site === 'MLB' ? '巴西 MLB' : '墨西哥 MLM'), label('本地末级类目ID', control(item.categoryId, v => item.categoryId = v)), label('CBT类目ID', control(item.cbtCategoryId, v => item.cbtCategoryId = v)), label('竞品依据（JSON数组，保留链接与实际类目）', jsonEdit(item.evidence ?? [], v => item.evidence = v)), label('必填属性（JSON对象）', jsonEdit(item.attributes ?? {}, v => item.attributes = v)));
      category.append(node('p', check ? `${check.message} · ${check.checkedAt}\n${check.path.map(p => p.name).join(' → ')}\n允许规格：${check.variationAttributes.map(a => a.id).join(', ')}` : '尚未读取官方类目', 'muted'));
      if (check) category.append(node('pre', JSON.stringify(check.requiredAttributes, null, 2)));
      category.append(button('保存后读取官方类目', 'button secondary', run(async () => {
        await save(); const response = await api('/api/integrations/mercadolibre/accounts');
        const accounts = response.accounts ?? response;
        const connected = accounts.filter(a => a.status === 'connected');
        if (!connected.length) throw Error('未找到已授权账号');
        let accountId = connected[0].id;
        if (connected.length > 1) { accountId = prompt(`选择用于核验的账号ID：\n${connected.map(a => `${a.id} ${a.nickname}`).join('\n')}`); if (!connected.some(a => a.id === accountId)) throw Error('请选择列表内的账号'); }
        current = await api(`/api/candidates/${current.id}/categories/${site}/check`, { method: 'POST', body: JSON.stringify({ revision: current.revision, accountId }) }); render();
      })));
    }
    const variants = section('真实SKU矩阵');
    const table = node('table'); const head = node('tr'); ['保留', 'SKU已确认', 'Seller SKU', '颜色', '尺寸', '图案', '库存', '净收益USD', '主图', '操作'].forEach(t => head.append(node('th', t))); const thead = node('thead'); thead.append(head); table.append(thead);
    const tbody = node('tbody');
    for (const sku of current.skus) {
      const tr = node('tr');
      const cell = el => { const td = node('td'); td.append(el); tr.append(td); };
      cell(control(sku.keep !== false, v => sku.keep = v, 'checkbox')); cell(control(sku.existsConfirmed, v => sku.existsConfirmed = v, 'checkbox'));
      for (const key of ['sellerSku', 'color', 'size', 'pattern', 'stock', 'netProceedsUsd']) cell(control(sku[key], v => sku[key] = v, ['stock', 'netProceedsUsd'].includes(key) ? 'number' : 'text'));
      const select = node('select'); select.append(option('', '选择主图')); current.images.forEach(i => select.append(option(i.id, `${i.id} · ${i.status}`))); select.value = sku.imageId || ''; select.addEventListener('change', () => { sku.imageId = select.value; }); cell(select);
      cell(button('移除', 'button secondary', () => { current.skus = current.skus.filter(s => s !== sku); render(); })); tbody.append(tr);
      const perSku = node('details'); perSku.append(node('summary', `${sku.sellerSku || sku.id}：独立参数（未填写项共用产品参数）`));
      sku.facts ??= {};
      for (const [key, fact] of Object.entries(sku.facts)) factEditor(perSku, key, fact);
      perSku.append(button('添加独立包装/尺寸参数', 'button secondary', () => {
        for (const key of Object.keys(current.facts)) sku.facts[key] ??= structuredClone(current.facts[key]); render();
      })); variants.append(perSku);
    }
    table.append(tbody); const wrap = node('div', undefined, 'table-panel'); wrap.append(table); variants.prepend(wrap);
    variants.append(button('添加真实SKU行', 'button secondary', () => { current.skus.push({ id: `sku-${crypto.randomUUID()}`, sellerSku: '', keep: true, existsConfirmed: false, stock: 10, facts: {} }); render(); }));
    const images = section('图片与5图方案');
    for (const image of current.images) {
      const card = node('div', undefined, 'candidate-image'); const img = node('img'); img.src = image.url; img.alt = image.id; img.referrerPolicy = 'no-referrer'; card.append(img, node('strong', image.id), label('HTTPS图片链接', control(image.url, v => image.url = v)));
      const status = node('select'); [['reference', '竞品参考'], ['pending', '待确认使用'], ['usable', '可刊登']].forEach(([v, t]) => status.append(option(v, t))); status.value = image.status; status.addEventListener('change', () => image.status = status.value);
      card.append(label('使用状态', status), label('共用辅图', control(image.role === 'shared', v => image.role = v ? 'shared' : 'primary', 'checkbox')), label('图片方案/提示词', control(image.prompt, v => image.prompt = v)), button('删除并解除SKU关联', 'button secondary', () => { current.images = current.images.filter(i => i !== image); current.skus.forEach(s => { if (s.imageId === image.id) s.imageId = ''; }); render(); })); images.append(card);
    }
    images.append(button('添加图片链接', 'button secondary', () => { const url = prompt('输入HTTPS图片链接'); if (url) { current.images.push({ id: `image-${crypto.randomUUID()}`, url, status: 'pending', role: 'primary' }); render(); } }));
    const actions = section('下一步 · 翻译与输出');
    actions.append(button('保存草稿并检查', 'button primary', run(save)), link('导出Excel工作表（已保存内容）', `/api/candidates/${current.id}/export`), link('导出JSON数据包', `/api/candidates/${current.id}/export?format=json`));
    actions.append(node('p', '确认英文草稿及货源参数后进入翻译页。Excel直接保存天船ERP工作表；直接发布仍需完成正式预检。', 'muted'));
    actions.append(button('进入巴西／墨西哥翻译页', 'button primary', run(async () => { if (!current.productId) await save(); await openCandidateLocalization(current.id); })));
    if (current.productId) { actions.append(node('p', '已转正式商品；请在正式商品页修改。')); $('candidateEditor').querySelectorAll('input,textarea,select,button').forEach(el => el.disabled = true); actions.append(button('打开正式草稿', 'button primary', () => openReview(current.productId))); }
  }
  const textEdit = (value, change) => { const el = node('textarea'); el.rows = 5; el.value = value ?? ''; el.addEventListener('change', () => change(el.value)); return el; };
  function factEditor(parent, key, fact) {
    const box = node('div', undefined, 'candidate-fact'); fact.actual ??= { value: '', source: '', confirmed: false };
    box.append(node('strong', key), node('p', `参考：${JSON.stringify(fact.reference?.value ?? '')} ${fact.reference?.unit ?? ''} · 来源：${fact.reference?.source ?? '待研究'} ${fact.reference?.url ?? ''}`, 'muted'));
    const dimensions = key.endsWith('Dimensions');
    const resetConfirmation = () => { fact.actual.confirmed = false; const check = box.querySelector('input[type=checkbox]'); if (check) check.checked = false; };
    const change = v => { fact.actual.value = v; resetConfirmation(); };
    const editor = dimensions ? jsonEdit(fact.actual.value || { length: null, width: null, height: null, unit: 'cm' }, change) : control(fact.actual.value, change, ['purchasePriceCny', 'packedWeightG'].includes(key) ? 'number' : 'text');
    box.append(label('实际值', editor), label('实际来源', control(fact.actual.source, v => { fact.actual.source = v; resetConfirmation(); })), label('已确认实际数据', control(fact.actual.confirmed, v => fact.actual.confirmed = v, 'checkbox'))); parent.append(box);
  }
  async function save() {
    if ($('candidateEditor').querySelector(':invalid')) throw Error('请先修正表单格式');
    const { revision, categoryChecks, productId, updatedAt, issues, ...data } = current;
    current = await api(`/api/candidates/${current.id}`, { method: 'PUT', body: JSON.stringify({ revision, data }) }); render(); toast('候选草稿已保存'); await load();
  }
  $('candidateReload').addEventListener('click', run(load));
  $('candidatePreview').addEventListener('click', run(async () => {
    const file = $('candidateFile').files[0]; if (!file) throw Error('请选择JSON数据包'); imported = JSON.parse(await file.text());
    const result = await api('/api/candidates/import/preview', { method: 'POST', body: JSON.stringify(imported) });
    $('candidateImportPreview').textContent = JSON.stringify(result, null, 2); $('candidateImport').disabled = false;
  }));
  $('candidateFile').addEventListener('change', () => { imported = null; $('candidateImport').disabled = true; });
  $('candidateImport').addEventListener('click', run(async () => {
    if (!imported) throw Error('请先预览'); const result = await api('/api/candidates/import', { method: 'POST', body: JSON.stringify(imported) });
    toast(`新增${result.created.length}个，保留已有${result.preserved.length}个`); $('candidateImport').disabled = true; imported = null; await load();
  }));
  window.openCandidateLocalization = async id => {
    try {
      navigate('localization');
      current = await api(`/api/candidates/${id}`);
      renderLocalization();
    } catch (error) { toast(error.message, true); }
  };
  function renderLocalization() {
    const container = $('localizationEditor'); container.replaceChildren();
    $('localizationName').textContent = current.name;
    const source = JSON.stringify([current.english?.title ?? '', current.english?.description ?? '', current.english?.sellingPoints ?? []]);
    const heading = node('article', undefined, 'panel'); heading.append(node('h3', '英文原稿'), node('strong', current.english?.title ?? ''), node('p', current.english?.description ?? ''), node('pre', (current.english?.sellingPoints ?? []).join('\n'))); container.append(heading);
    for (const site of ['MLM', 'MLB'].filter(site => current.targetSites.includes(site))) {
      const item = current.sites[site], box = node('article', undefined, 'panel');
      box.append(node('h3', site === 'MLB' ? '巴西葡萄牙语 · MLB' : '墨西哥西班牙语 · MLM'));
      box.append(node('p', item.localizedFrom === source ? '译文与当前英文稿一致' : '译文待审核或英文稿已更新', item.localizedFrom === source ? 'status-pill good' : 'status-pill bad'));
      box.append(label('当地语言标题', control(item.title, v => { item.title = v; item.localizedFrom = ''; })), label('当地语言描述', textEdit(item.description, v => { item.description = v; item.localizedFrom = ''; })), label('当地语言卖点（一行一条）', textEdit((item.sellingPoints ?? []).join('\n'), v => { item.sellingPoints = v.split('\n').map(x => x.trim()).filter(Boolean); item.localizedFrom = ''; })));
      box.append(button('生成翻译建议', 'button secondary', run(async () => {
        const answer = await api(`/api/candidates/${current.id}/localize/${site}/suggest`, { method: 'POST', body: JSON.stringify({ revision: current.revision }) });
        Object.assign(item, answer.proposal, { localizedFrom: '' }); renderLocalization(); toast('译文建议已填入，请审核后确认');
      })));
      box.append(button('确认此站点译文', 'button primary', run(async () => {
        if (!item.title?.trim() || !item.description?.trim()) throw Error('标题和描述必填');
        item.localizedFrom = source; await saveLocalization(); toast(`${site}译文已确认`);
      })));
      container.append(box);
    }
    const actions = node('article', undefined, 'panel');
    actions.append(node('h3', '输出或发布'), link('下载天船ERP Excel', `/api/candidates/${current.id}/export`));
    if (current.productId) actions.append(button('打开已创建的正式草稿', 'button secondary', () => openReview(current.productId)));
    else {
      const selected = [];
      for (const site of ['MLM', 'MLB'].filter(s => current.targetSites.includes(s))) actions.append(label(`选择${site}作为发布站点`, control(false, v => { if (v && !selected.includes(site)) selected.push(site); if (!v) selected.splice(selected.indexOf(site), 1); }, 'checkbox')));
      actions.append(button('转正式草稿并继续预检', 'button accent', run(async () => {
        const result = await api(`/api/candidates/${current.id}/promote`, { method: 'POST', body: JSON.stringify({ revision: current.revision, sites: selected }) });
        await loadProducts(); openReview(result.id);
      })));
    }
    actions.append(node('p', 'Family接口实际提交英文商品资料；当地语言译文留在天船ERP和Excel中用于核对。直接发布仍在正式草稿页按原有步骤审核图片、远程预检并明确确认。', 'muted'));
    container.append(actions);
  }
  async function saveLocalization() {
    const { revision, categoryChecks, productId, updatedAt, issues, ...data } = current;
    current = await api(`/api/candidates/${current.id}`, { method: 'PUT', body: JSON.stringify({ revision, data }) }); renderLocalization();
  }
  window.loadCandidates = run(load);
})();
