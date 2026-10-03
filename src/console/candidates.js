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
    const general = section('采购与产品内容');
    general.append(label('产品名称', control(current.name, v => current.name = v)), label('批次', control(current.batchId, v => current.batchId = v)), label('1688货源链接', control(current.sourceUrl, v => current.sourceUrl = v)), label('英文Family名称', control(current.familyName, v => current.familyName = v)), label('英文共用描述', control(current.descriptionEnglish, v => current.descriptionEnglish = v)));
    for (const [key, fact] of Object.entries(current.facts)) factEditor(general, key, fact);
    const category = section('站点资料与类目核验');
    category.append(node('p', '本地类目与CBT映射分开；官方检查仅确认本地末级类目和传统规格属性。巴西目前可研究、编辑、导出。', 'muted'));
    for (const site of ['MLM', 'MLB', 'MCO', 'MLC']) {
      const active = current.targetSites.includes(site);
      category.append(label(`${site}纳入候选`, control(active, v => {
        if (v) { current.targetSites.push(site); current.sites[site] ??= { title: '', description: '', categoryId: '', cbtCategoryId: '', evidence: [] }; }
        else current.targetSites = current.targetSites.filter(s => s !== site);
        render();
      }, 'checkbox')));
      if (!active) continue;
      const item = current.sites[site], check = current.categoryChecks[site];
      category.append(node('h4', site === 'MLB' ? '巴西 · Português' : site), label('差异化标题', control(item.title, v => item.title = v)), label('当地语言描述', control(item.description, v => item.description = v)), label('本地末级类目ID', control(item.categoryId, v => item.categoryId = v)), label('CBT类目ID', control(item.cbtCategoryId, v => item.cbtCategoryId = v)), label('核心卖点（JSON数组）', jsonEdit(item.sellingPoints ?? [], v => item.sellingPoints = v)), label('竞品依据（JSON数组，保留链接与实际类目）', jsonEdit(item.evidence ?? [], v => item.evidence = v)), label('必填属性（JSON对象）', jsonEdit(item.attributes ?? {}, v => item.attributes = v)));
      category.append(node('p', check ? `${check.message} · ${check.checkedAt}\n${check.path.map(p => p.name).join(' → ')}\n允许规格：${check.variationAttributes.map(a => a.id).join(', ')}` : '尚未读取官方类目', 'muted'));
      if (check) category.append(node('pre', JSON.stringify(check.requiredAttributes, null, 2)));
      category.append(button('保存后读取官方类目', 'button secondary', run(async () => {
        await save(); const accounts = await api('/api/integrations/mercadolibre/accounts');
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
    const actions = section('保存与输出');
    actions.append(button('保存草稿并检查', 'button primary', run(save)), link('导出Excel工作表（已保存内容）', `/api/candidates/${current.id}/export`), link('导出JSON数据包', `/api/candidates/${current.id}/export?format=json`));
    actions.append(node('p', 'Excel为六个Sheet的候选工作表；尚未映射妙手上传模板。转入只创建草稿，包装参数仍需在正式发布属性中确认。', 'muted'));
    const selected = []; current.targetSites.forEach(s => actions.append(label(`${s}转入正式草稿`, control(false, v => { if (v) selected.push(s); else selected.splice(selected.indexOf(s), 1); }, 'checkbox'))));
    actions.append(button('转为正式上架草稿', 'button accent', run(async () => {
      if (!current.productId) await save();
      const result = await api(`/api/candidates/${current.id}/promote`, { method: 'POST', body: JSON.stringify({ revision: current.revision, sites: selected }) });
      toast('正式草稿已创建，请核验属性、图片和UP分组'); await loadProducts(); openReview(result.id);
    })));
    if (current.productId) { actions.append(node('p', '已转正式商品；请在正式商品页修改。')); $('candidateEditor').querySelectorAll('input,textarea,select,button').forEach(el => el.disabled = true); actions.append(button('打开正式草稿', 'button primary', () => openReview(current.productId))); }
  }
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
  window.loadCandidates = run(load);
})();
