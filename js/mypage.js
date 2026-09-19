'use strict';
// ═══════════════════════════════════════════════════════════════
//  mypage.js  マイページ UI
//    サブタブ: ポイント（既存）/ 探索記録 / 集計
//    データ処理は mypage_store.js (MpgStore)。ここでは画面とイベントのみ。
//    HTMLのonclickから呼ぶ関数は末尾で window に公開（mpg 接頭辞）。
//
//  依存（他ファイル）:
//    points.js  : pts, savePts, _genPtUid
//    ui.js      : showDlg, closeOv, showToast, showAlert
//    firebase.js: isPremiumUser, showPremiumGate('log_limit')
// ═══════════════════════════════════════════════════════════════
(function () {

  const Store = MpgStore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 画面状態 ─────────────────────────────────
  let _sub = 'pts';              // 'pts' | 'logs' | 'stats'
  let _sort = 'date';            // 'date' | 'point'
  let _dateDesc = true;          // 日付: 新しい順
  let _chartMetric = 'weight';   // 'weight' | 'grains' | 'count'
  const _statSort = { method: 'weight', tool: 'count', process: 'count', purpose: 'count' };
  let _candCat = 'method';
  let _renameId = null;
  let draft = null;              // 編集中の記録
  const _open = {};              // 編集中の明細ごとのチップ開閉  { 'i:cat': true }
  let _initP = null;

  // ── 整形 ─────────────────────────────────────
  const fmtG = v => (Math.round(v * 100) / 100).toFixed(2);
  const fmtN = v => Math.round(v).toLocaleString('ja-JP');
  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return m + '分';
    const h = Math.floor(m / 60), r = m % 60;
    return h + '時間' + (r ? r + '分' : '');
  }
  function entLine(e) {
    const p = [];
    if (e.weightG !== null) p.push(fmtG(e.weightG) + 'g');
    if (e.grains !== null) p.push(fmtN(e.grains) + '粒');
    if (e.durationMin !== null) p.push(fmtMin(e.durationMin));
    return p.length ? p.join(' / ') : '（数値なし）';
  }
  function sumLine(s) {
    const p = [];
    if (s.weightG > 0) p.push(fmtG(s.weightG) + 'g');
    if (s.grains > 0) p.push(fmtN(s.grains) + '粒');
    if (s.minutes > 0) p.push(fmtMin(s.minutes));
    return p.length ? '合計 ' + p.join(' / ') : '';
  }
  function candName(id) { const c = Store.getCand(id); return c ? c.name : '（不明な候補）'; }

  // ── ポイント連携 ─────────────────────────────
  function ptsArr() { return (typeof pts !== 'undefined' && Array.isArray(pts)) ? pts : []; }

  // uidが無いポイント（他ファイルが追加した直後など）に安定IDを付与
  function ensurePtUids() {
    let need = false;
    ptsArr().forEach(p => {
      if (p && !p.uid && typeof _genPtUid === 'function') { p.uid = _genPtUid(); need = true; }
    });
    if (need && typeof savePts === 'function') savePts();
  }
  function findPoint(uid) {
    if (!uid) return null;
    return ptsArr().find(p => p && p.uid === uid) || null;
  }
  // 明細 → 表示用ポイント情報
  function resolvePoint(e) {
    const p = findPoint(e.pointUid);
    if (p) return { name: p.name || '（無名）', icon: p.icon || '📍', deleted: false, none: false };
    if (e.pointUid) return { name: e.pointName || '（無名）', icon: '📍', deleted: true, none: false };
    return { name: '（ポイントなし）', icon: '—', deleted: false, none: true };
  }

  // ── サブタブ ─────────────────────────────────
  function switchSub(name) {
    _sub = name;
    ['pts', 'logs', 'stats'].forEach(k => {
      const b = $('mpg-st-' + k), p = $('mpg-pane-' + k);
      if (b) b.classList.toggle('active', k === name);
      if (p) p.classList.toggle('active', k === name);
    });
    if (name === 'logs') renderLogs();
    if (name === 'stats') renderStats();
  }
  function renderAll() {
    renderLogs();
    renderStats();
  }

  // ── 探索記録 一覧 ────────────────────────────
  function tagsHtml(e) {
    let h = '';
    e.methodIds.forEach(id => { h += '<span class="mpg-tag t-m">' + esc(candName(id)) + '</span>'; });
    e.toolIds.forEach(id => { h += '<span class="mpg-tag t-t">' + esc(candName(id)) + '</span>'; });
    e.processIds.forEach(id => { h += '<span class="mpg-tag t-p">' + esc(candName(id)) + '</span>'; });
    if (e.purposeId) h += '<span class="mpg-tag t-o">🎯 ' + esc(candName(e.purposeId)) + '</span>';
    return h ? '<div class="mpg-tags">' + h + '</div>' : '';
  }
  function pointLabelHtml(p) {
    return '<span class="mpg-ent-pt' + (p.deleted ? ' del' : '') + '">' + esc(p.icon) + ' ' + esc(p.name) +
      (p.deleted ? '<span class="mpg-del-badge">削除済みポイント</span>' : '') + '</span>';
  }
  function dateCmp(a, b) {
    const dir = _dateDesc ? -1 : 1;
    const c = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (c) return c * dir;
    return (a.createdAt - b.createdAt) * dir;
  }

  function logCardHtml(l) {
    const s = Store.summary([l]);
    const ents = l.entries.map(e =>
      '<div class="mpg-ent"><div class="mpg-ent-main">' + pointLabelHtml(resolvePoint(e)) +
      '<span class="mpg-ent-val">' + esc(entLine(e)) + '</span></div>' + tagsHtml(e) + '</div>'
    ).join('');
    return '<div class="mpg-log" onclick="mpgOpenLogEdit(\'' + l.uid + '\')">' +
      '<div class="mpg-log-head"><span class="mpg-log-date">' + esc(l.date) + '</span>' +
      '<span class="mpg-log-sum">' + esc(sumLine(s)) + '</span></div>' +
      (l.memo ? '<div class="mpg-log-memo">' + esc(l.memo) + '</div>' : '') + ents + '</div>';
  }

  function renderByDate(logs) {
    return logs.slice().sort(dateCmp).map(logCardHtml).join('');
  }
  function renderByPoint(logs) {
    const groups = new Map();
    logs.forEach(l => l.entries.forEach(e => {
      const k = e.pointUid || '__none__';
      let g = groups.get(k);
      if (!g) { g = { key: k, items: [], weight: 0, grains: 0, last: '' }; groups.set(k, g); }
      g.items.push({ log: l, e: e });
      g.weight += e.weightG || 0;
      g.grains += e.grains || 0;
      if (l.date > g.last) g.last = l.date;
    }));
    const arr = Array.from(groups.values()).sort((a, b) =>
      ((a.key === '__none__') - (b.key === '__none__')) || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    return arr.map(g => {
      const p = resolvePoint(g.items[0].e);
      g.items.sort((x, y) => dateCmp(x.log, y.log));
      const head = '<div class="mpg-grp-head">' + pointLabelHtml(p) +
        '<span class="mpg-log-sum">' + g.items.length + '回 / ' + fmtG(g.weight) + 'g' +
        (g.grains > 0 ? ' / ' + fmtN(g.grains) + '粒' : '') + '</span></div>';
      const rows = g.items.map(it =>
        '<div class="mpg-ent mpg-ent-click" onclick="mpgOpenLogEdit(\'' + it.log.uid + '\')">' +
        '<div class="mpg-ent-main"><span class="mpg-ent-date">' + esc(it.log.date) + '</span>' +
        '<span class="mpg-ent-val">' + esc(entLine(it.e)) + '</span></div>' + tagsHtml(it.e) + '</div>'
      ).join('');
      return '<div class="mpg-log mpg-grp">' + head + rows + '</div>';
    }).join('');
  }

  function renderLogs() {
    const el = $('mpg-log-list');
    if (!el) return;
    const bd = $('mpg-sort-date'), bp = $('mpg-sort-point'), bdir = $('mpg-date-dir');
    if (bd) bd.classList.toggle('on', _sort === 'date');
    if (bp) bp.classList.toggle('on', _sort === 'point');
    if (bdir) bdir.textContent = _dateDesc ? '新しい順 ▼' : '古い順 ▲';
    const logs = Store.getLogs();
    if (!logs.length) {
      el.innerHTML = '<div class="mpg-empty">まだ探索記録がありません<br>' +
        '「＋ 記録追加」で日付・ポイントごとの取得量を記録できます</div>';
    } else {
      el.innerHTML = _sort === 'date' ? renderByDate(logs) : renderByPoint(logs);
    }
    updateLimitLabel();
  }
  async function updateLimitLabel() {
    const el = $('mpg-log-limit');
    if (!el) return;
    let prem = false;
    try { prem = (typeof isPremiumUser === 'function') ? await isPremiumUser() : false; } catch (e) { /* 無料扱い */ }
    const n = Store.getLogs().length;
    el.textContent = prem ? '記録 ' + n + '件' : '記録 ' + n + ' / ' + Store.FREE_LOG_LIMIT + '件（フリー）';
    el.classList.toggle('full', !prem && n >= Store.FREE_LOG_LIMIT);
  }
  function setSort(m) { _sort = m; renderLogs(); }
  function toggleDateDir() { _dateDesc = !_dateDesc; renderLogs(); }

  // ── 記録の追加/編集 ──────────────────────────
  async function checkCanAdd() {
    let prem = false;
    try { prem = (typeof isPremiumUser === 'function') ? await isPremiumUser() : false; } catch (e) { /* 無料扱い */ }
    if (prem || Store.getLogs().length < Store.FREE_LOG_LIMIT) return true;
    if (typeof showPremiumGate === 'function') showPremiumGate('log_limit');
    return false;
  }
  function blankEntry() {
    return { uid: Store.newEntryId(), pointUid: '', pointName: '', lat: null, lng: null,
             weightG: '', grains: '', durationMin: '',
             methodIds: [], toolIds: [], processIds: [], purposeId: '' };
  }
  function entryToDraft(e) {
    return { uid: e.uid, pointUid: e.pointUid || '', pointName: e.pointName, lat: e.lat, lng: e.lng,
             weightG: e.weightG === null ? '' : String(e.weightG),
             grains: e.grains === null ? '' : String(e.grains),
             durationMin: e.durationMin === null ? '' : String(e.durationMin),
             methodIds: e.methodIds.slice(), toolIds: e.toolIds.slice(),
             processIds: e.processIds.slice(), purposeId: e.purposeId };
  }

  async function openLogEdit(logUid) {
    ensurePtUids();
    Object.keys(_open).forEach(k => delete _open[k]);
    if (logUid) {
      const l = Store.getLog(logUid);
      if (!l) return;
      draft = { uid: l.uid, isNew: false, date: l.date, memo: l.memo, createdAt: l.createdAt,
                entries: l.entries.map(entryToDraft) };
      if (!draft.entries.length) draft.entries.push(blankEntry());
    } else {
      if (!(await checkCanAdd())) return;
      draft = { uid: Store.newLogId(), isNew: true, date: Store.todayStr(), memo: '', createdAt: Date.now(),
                entries: [blankEntry()] };
    }
    $('mpg-log-ttl').textContent = draft.isNew ? '📝 探索記録を追加' : '📝 探索記録を編集';
    $('mpg-log-date').value = draft.date;
    $('mpg-log-memo').value = draft.memo;
    $('mpg-log-del-btn').style.display = draft.isNew ? 'none' : '';
    renderEntries();
    const body = $('mpg-log-body');
    if (body) body.scrollTop = 0;
    showDlg('dlg-mpg-log');
  }

  function updateEntrySum() {
    const el = $('mpg-entry-sum');
    if (!el || !draft) return;
    let w = 0;
    draft.entries.forEach(e => { const n = Number(e.weightG); if (e.weightG !== '' && isFinite(n)) w += n; });
    el.textContent = '（' + draft.entries.length + '件' + (w > 0 ? ' / 合計 ' + fmtG(w) + 'g' : '') + '）';
  }

  // 明細カード
  function chipsHtml(e, i, cat, selIds) {
    const list = Store.getCands(cat).filter(c => c.visible || selIds.indexOf(c.id) >= 0);
    const chip = c => '<button type="button" class="mpg-chip' + (selIds.indexOf(c.id) >= 0 ? ' sel' : '') +
      (c.visible ? '' : ' hid') + '" onclick="mpgChip(' + i + ',\'' + cat + '\',\'' + c.id + '\')">' +
      esc(c.name) + '</button>';
    let h = '';
    const rec = Store.recentIds(cat, 6).map(id => Store.getCand(id)).filter(Boolean);
    if (rec.length) h += '<div class="mpg-chip-grp">🕘 直近使用</div>' + rec.map(chip).join('');
    const groups = [];
    list.forEach(c => {
      let g = groups.find(x => x.name === c.group);
      if (!g) { g = { name: c.group, items: [] }; groups.push(g); }
      g.items.push(c);
    });
    groups.forEach(g => {
      if (g.name) h += '<div class="mpg-chip-grp">' + esc(g.name) + '</div>';
      else if (rec.length) h += '<div class="mpg-chip-grp">すべて</div>';
      h += g.items.map(chip).join('');
    });
    if (!list.length) h += '<div class="mpg-dim">表示中の候補がありません（「🗂 候補管理」でONにできます）</div>';
    h += '<div class="mpg-chip-add"><input type="text" id="mpg-add-' + i + '-' + cat + '" maxlength="30" ' +
      'placeholder="新しい候補を追加" onkeydown="if(event.key===\'Enter\'){event.preventDefault();mpgInlineAdd(' +
      i + ',\'' + cat + '\')}"><button type="button" class="btn sm" onclick="mpgInlineAdd(' + i + ',\'' + cat +
      '\')">＋追加</button></div>';
    return h;
  }
  function catBlockHtml(e, i, cat) {
    const meta = Store.CATS.find(c => c.key === cat);
    const selIds = cat === 'purpose' ? (e.purposeId ? [e.purposeId] : []) : e[Store.ID_KEY[cat]];
    const open = !!_open[i + ':' + cat];
    const sel = selIds.length ? esc(selIds.map(candName).join('、')) : '<span class="mpg-dim">未選択</span>';
    return '<div class="mpg-cat"><button type="button" class="mpg-cat-btn" onclick="mpgToggleCat(' + i + ',\'' + cat + '\')">' +
      '<span class="mpg-cat-lbl">' + meta.icon + ' ' + meta.label + '</span><span class="mpg-cat-sel">' + sel +
      '</span><span class="mpg-cat-arw">' + (open ? '▲' : '▼') + '</span></button>' +
      '<div class="mpg-chips' + (open ? ' open' : '') + '">' + (open ? chipsHtml(e, i, cat, selIds) : '') + '</div></div>';
  }
  function entryHtml(e, i) {
    let opts = '<option value="">（ポイントなし／未選択）</option>';
    let found = false;
    ptsArr().forEach(p => {
      if (!p || !p.uid) return;
      const sel = p.uid === e.pointUid;
      if (sel) found = true;
      opts += '<option value="' + esc(p.uid) + '"' + (sel ? ' selected' : '') + '>' +
        esc((p.icon || '') + ' ' + (p.name || '（無名）')) + '</option>';
    });
    if (e.pointUid && !found) {
      opts += '<option value="' + esc(e.pointUid) + '" selected>' + esc(e.pointName || '（無名）') + '（削除済みポイント）</option>';
    }
    return '<div class="mpg-entry">' +
      '<div class="mpg-entry-head"><span class="mpg-entry-no">明細 ' + (i + 1) + '</span>' +
      (draft.entries.length > 1 ? '<button type="button" class="btn sm red" onclick="mpgDelEntry(' + i + ')">🗑 削除</button>' : '') +
      '</div>' +
      '<label>ポイント</label><select class="mpg-select" onchange="mpgEntPoint(' + i + ',this.value)">' + opts + '</select>' +
      '<div class="mpg-row3">' +
      '<div><label>重量 (g)</label><input type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(e.weightG) +
        '" oninput="mpgEntNum(' + i + ',\'weightG\',this.value)"></div>' +
      '<div><label>粒数</label><input type="number" inputmode="numeric" step="1" min="0" value="' + esc(e.grains) +
        '" oninput="mpgEntNum(' + i + ',\'grains\',this.value)"></div>' +
      '<div><label>時間 (分)</label><input type="number" inputmode="numeric" step="1" min="0" value="' + esc(e.durationMin) +
        '" oninput="mpgEntNum(' + i + ',\'durationMin\',this.value)"></div></div>' +
      catBlockHtml(e, i, 'method') + catBlockHtml(e, i, 'tool') + catBlockHtml(e, i, 'process') + catBlockHtml(e, i, 'purpose') +
      '</div>';
  }
  function renderEntries() {
    if (!draft) return;
    const body = $('mpg-log-body');
    const st = body ? body.scrollTop : 0;
    $('mpg-entries').innerHTML = draft.entries.map(entryHtml).join('');
    if (body) body.scrollTop = st;
    updateEntrySum();
  }

  function addEntry(copy) {
    if (!draft) return;
    const ne = blankEntry();
    if (copy) {
      const src = draft.entries.length ? draft.entries[draft.entries.length - 1] : Store.latestEntry();
      if (!src) { showToast('コピーできる明細がありません', 2200); return; }
      ne.methodIds = src.methodIds.slice();
      ne.toolIds = src.toolIds.slice();
      ne.processIds = src.processIds.slice();
    }
    draft.entries.push(ne);
    renderEntries();
    const body = $('mpg-log-body');
    if (body) body.scrollTop = body.scrollHeight;
  }
  function delEntry(i) {
    if (!draft || draft.entries.length <= 1) return;
    draft.entries.splice(i, 1);
    Object.keys(_open).forEach(k => delete _open[k]);
    renderEntries();
  }
  function entPoint(i, v) {
    const e = draft.entries[i];
    if (!e) return;
    const p = findPoint(v);
    e.pointUid = v || '';
    if (p) { e.pointName = p.name || ''; e.lat = p.lat; e.lng = p.lng; }
    else if (!v) { e.pointName = ''; e.lat = null; e.lng = null; }
    // 削除済みポイント(値あり・未発見)を選び直した場合は既存コピーを維持
  }
  function entNum(i, key, v) {
    const e = draft.entries[i];
    if (!e) return;
    e[key] = v;
    updateEntrySum();
  }
  function toggleCat(i, cat) {
    const k = i + ':' + cat;
    _open[k] = !_open[k];
    renderEntries();
  }
  function chip(i, cat, id) {
    const e = draft.entries[i];
    if (!e) return;
    if (cat === 'purpose') e.purposeId = (e.purposeId === id) ? '' : id;
    else {
      const arr = e[Store.ID_KEY[cat]];
      const at = arr.indexOf(id);
      if (at >= 0) arr.splice(at, 1); else arr.push(id);
    }
    renderEntries();
  }
  async function inlineAdd(i, cat) {
    const inp = $('mpg-add-' + i + '-' + cat);
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    let c = null;
    try { c = await Store.addCand(cat, name); }
    catch (e) { showToast('⚠ 候補を保存できませんでした', 2500); return; }
    if (!c) return;
    const e = draft.entries[i];
    if (cat === 'purpose') e.purposeId = c.id;
    else if (e[Store.ID_KEY[cat]].indexOf(c.id) < 0) e[Store.ID_KEY[cat]].push(c.id);
    renderEntries();
  }

  async function saveLog() {
    if (!draft) return;
    draft.date = $('mpg-log-date').value;
    draft.memo = $('mpg-log-memo').value;
    if (!Store.validDate(draft.date)) { showToast('⚠ 日付を入力してください', 2500); return; }
    if (!draft.entries.length) { showToast('⚠ 明細を1件以上入力してください', 2500); return; }
    const entries = [];
    for (let i = 0; i < draft.entries.length; i++) {
      const e = draft.entries[i];
      const conv = (s, label, int) => {
        if (s === '' || s == null) return null;
        const n = Number(s);
        if (!isFinite(n) || n < 0) { showToast('⚠ 明細' + (i + 1) + 'の' + label + 'を確認してください', 2800); return NaN; }
        return int ? Math.round(n) : n;
      };
      const w = conv(e.weightG, '重量', false); if (Number.isNaN(w)) return;
      const g = conv(e.grains, '粒数', true); if (Number.isNaN(g)) return;
      const m = conv(e.durationMin, '時間', true); if (Number.isNaN(m)) return;
      const p = findPoint(e.pointUid);
      entries.push({
        uid: e.uid,
        pointUid: e.pointUid || null,
        pointName: p ? (p.name || '') : e.pointName,
        lat: p ? p.lat : e.lat,
        lng: p ? p.lng : e.lng,
        weightG: w, grains: g, durationMin: m,
        methodIds: e.methodIds, toolIds: e.toolIds, processIds: e.processIds, purposeId: e.purposeId,
      });
    }
    if (draft.isNew && !(await checkCanAdd())) return;
    try {
      await Store.saveLog({ uid: draft.uid, date: draft.date, memo: draft.memo,
                            createdAt: draft.createdAt, entries: entries });
    } catch (err) {
      console.warn('[mypage] 保存失敗', err);
      showToast('⚠ 保存に失敗しました（端末の保存容量を確認してください）', 3200);
      return;
    }
    draft = null;
    closeOv();
    renderAll();
    showToast('✅ 探索記録を保存しました', 2000);
  }

  // 削除
  function reqDelLog() {
    if (!draft || draft.isNew) return;
    $('mpg-logdel-msg').textContent = draft.date + ' の探索記録（明細' + draft.entries.length +
      '件）を削除します。\nこの操作は元に戻せません。';
    showDlg('dlg-mpg-logdel');
  }
  function cancelDelLog() { showDlg('dlg-mpg-log'); }
  async function confirmDelLog() {
    if (!draft) { closeOv(); return; }
    try { await Store.removeLog(draft.uid); }
    catch (err) { showToast('⚠ 削除に失敗しました', 2500); showDlg('dlg-mpg-log'); return; }
    draft = null;
    closeOv();
    renderAll();
    showToast('🗑 探索記録を削除しました', 2000);
  }

  // ── 候補管理 ─────────────────────────────────
  function openCand() {
    _renameId = null;
    renderCand();
    showDlg('dlg-mpg-cand');
  }
  function candTab(cat) { _candCat = cat; _renameId = null; renderCand(); }
  function renderCand() {
    const tabs = $('mpg-cand-tabs'), body = $('mpg-cand-body');
    if (!tabs || !body) return;
    tabs.innerHTML = Store.CATS.map(c =>
      '<button type="button" class="mpg-subtab' + (c.key === _candCat ? ' active' : '') +
      '" onclick="mpgCandTab(\'' + c.key + '\')">' + c.icon + ' ' + c.label + '</button>').join('');
    const st = body.scrollTop;
    const list = Store.getCands(_candCat);
    let h = '<div class="mpg-note">OFFにすると新規入力の候補から非表示になります（過去の記録・統計には残ります）。' +
      '名前を変更すると過去の記録にも反映されます。</div>' +
      '<div class="mpg-chip-add mpg-cand-add"><input type="text" id="mpg-cand-new" maxlength="30" placeholder="新しい候補を追加" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();mpgCandAdd()}">' +
      '<button type="button" class="btn sm accent" onclick="mpgCandAdd()">＋追加</button></div>';
    const groups = [];
    list.forEach(c => {
      let g = groups.find(x => x.name === c.group);
      if (!g) { g = { name: c.group, items: [] }; groups.push(g); }
      g.items.push(c);
    });
    groups.forEach((g, gi) => {
      h += '<div class="mpg-cand-grp"><span>' + esc(g.name || '（グループなし）') + '</span>' +
        '<span><button type="button" class="mpg-mini" onclick="mpgCandGroup(' + gi + ',true)">全ON</button>' +
        '<button type="button" class="mpg-mini" onclick="mpgCandGroup(' + gi + ',false)">全OFF</button></span></div>';
      g.items.forEach(c => {
        const nameHtml = (_renameId === c.id)
          ? '<input type="text" class="mpg-cand-edit" id="mpg-cand-edit" maxlength="30" value="' + esc(c.name) + '" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();mpgCandRenameOk(\'' + c.id + '\')}">' +
            '<button type="button" class="mpg-mini" onclick="mpgCandRenameOk(\'' + c.id + '\')">OK</button>'
          : '<span class="mpg-cand-name' + (c.visible ? '' : ' off') + '">' + esc(c.name) + '</span>' +
            '<button type="button" class="mpg-mini" onclick="mpgCandRename(\'' + c.id + '\')">✏️</button>';
        h += '<div class="mpg-cand-row">' + nameHtml +
          '<button type="button" class="mpg-sw' + (c.visible ? ' on' : '') + '" onclick="mpgCandToggle(\'' + c.id + '\')" ' +
          'aria-label="表示ON/OFF"></button></div>';
      });
    });
    body.innerHTML = h;
    body.scrollTop = st;
    if (_renameId) { const inp = $('mpg-cand-edit'); if (inp) { inp.focus(); inp.select(); } }
  }
  async function candAdd() {
    const inp = $('mpg-cand-new');
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    try { await Store.addCand(_candCat, name); }
    catch (e) { showToast('⚠ 保存に失敗しました', 2500); return; }
    renderCand();
  }
  function candRename(id) { _renameId = id; renderCand(); }
  async function candRenameOk(id) {
    const inp = $('mpg-cand-edit');
    const name = inp ? inp.value.trim() : '';
    if (name) {
      try { await Store.renameCand(id, name); }
      catch (e) { showToast('⚠ 保存に失敗しました', 2500); }
    }
    _renameId = null;
    renderCand();
    renderAll();
  }
  async function candToggle(id) {
    const c = Store.getCand(id);
    if (!c) return;
    try { await Store.setCandVisible(id, !c.visible); }
    catch (e) { showToast('⚠ 保存に失敗しました', 2500); }
    renderCand();
  }
  async function candGroup(gi, on) {
    const groups = [];
    Store.getCands(_candCat).forEach(c => { if (groups.indexOf(c.group) < 0) groups.push(c.group); });
    if (gi < 0 || gi >= groups.length) return;
    try { await Store.setGroupVisible(_candCat, groups[gi], on); }
    catch (e) { showToast('⚠ 保存に失敗しました', 2500); }
    renderCand();
  }

  // ── 集計 ─────────────────────────────────────
  function chartSvg(data, metric) {
    const W = 320, H = 150, padL = 6, padR = 6, padT = 16, padB = 22;
    const n = data.length, max = Math.max.apply(null, data.map(d => d.value).concat([0]));
    const bw = (W - padL - padR) / n, ch = H - padT - padB;
    const fmtV = v => metric === 'weight' ? (v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
                                          : String(Math.round(v));
    let s = '<svg class="mpg-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="月別グラフ">';
    s += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" class="mpg-axis"/>';
    data.forEach((d, i) => {
      const x = padL + i * bw + bw * 0.15, w = bw * 0.7;
      const h = max > 0 ? (d.value / max) * ch : 0;
      const y = H - padB - h;
      if (d.value > 0) {
        s += '<rect class="mpg-bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
          '" height="' + h.toFixed(1) + '" rx="2"/>';
        s += '<text class="mpg-val" x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="middle">' +
          fmtV(d.value) + '</text>';
      } else {
        s += '<rect class="mpg-bar0" x="' + x.toFixed(1) + '" y="' + (H - padB - 1.5) + '" width="' + w.toFixed(1) + '" height="1.5"/>';
      }
      const mo = +d.key.slice(5, 7);
      s += '<text class="mpg-ax" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - padB + 10) + '" text-anchor="middle">' + mo + '月</text>';
      if (i === 0 || mo === 1) {
        s += '<text class="mpg-ax mpg-ax-y" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle">' +
          d.key.slice(0, 4) + '</text>';
      }
    });
    return s + '</svg>';
  }
  function segHtml(items, cur, fn) {
    return '<div class="mpg-seg">' + items.map(it =>
      '<button type="button" class="' + (cur === it[0] ? 'on' : '') + '" onclick="' + fn(it[0]) + '">' + it[1] + '</button>').join('') + '</div>';
  }
  function statRow(nm, vals, pct, dim) {
    return '<div class="mpg-strow" style="--p:' + pct + '%"><span class="nm' + (dim ? ' dim' : '') + '">' + nm + '</span>' +
      vals.map(v => '<span class="v">' + v + '</span>').join('') + '</div>';
  }

  function catStatHtml(logs, meta) {
    const rows = Store.byCand(logs, meta.key);
    let h = '<div class="mpg-sec"><span>' + meta.icon + ' ' + meta.label + '別</span>';
    if (!rows.length) return h + '</div><div class="mpg-dim mpg-pad">データなし</div>';
    const withGph = meta.key === 'method';
    const sk = _statSort[meta.key];
    const val = r => sk === 'gph' ? (r.gPerHour === null ? -1 : r.gPerHour) : sk === 'weight' ? r.weightG : r.count;
    rows.sort((a, b) => (val(b) - val(a)) || (b.weightG - a.weightG) || (b.count - a.count));
    const max = Math.max.apply(null, rows.map(val).concat([0]));
    const items = [['count', '回数'], ['weight', '合計g']];
    if (withGph) items.push(['gph', 'g/h']);
    h += segHtml(items, sk, k => "mpgStatSort('" + meta.key + "','" + k + "')") + '</div>';
    h += statRow('', withGph ? ['回数', '合計g', 'g/h'] : ['回数', '合計g'], 0, false).replace('mpg-strow', 'mpg-strow head');
    rows.forEach(r => {
      const c = Store.getCand(r.id);
      const pct = max > 0 && val(r) > 0 ? Math.round(val(r) / max * 100) : 0;
      const vals = [fmtN(r.count), fmtG(r.weightG)];
      if (withGph) vals.push(r.gPerHour === null ? '—' : r.gPerHour.toFixed(2));
      h += statRow(esc(c ? c.name : '（不明な候補）'), vals, pct, c ? !c.visible : true);
    });
    return h;
  }

  function renderStats() {
    const el = $('mpg-stats');
    if (!el) return;
    const logs = Store.getLogs();
    if (!logs.length) {
      el.innerHTML = '<div class="mpg-empty">集計する探索記録がありません<br>「探索記録」タブで記録を追加すると、ここに集計が表示されます</div>';
      return;
    }
    const s = Store.summary(logs);
    let h = '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-val">' + fmtG(s.weightG) + ' g</div><div class="stat-lbl">累計取得量</div></div>' +
      '<div class="stat-card"><div class="stat-val">' + fmtN(s.grains) + ' 粒</div><div class="stat-lbl">累計粒数</div></div>' +
      '<div class="stat-card"><div class="stat-val">' + fmtN(s.logCount) + ' 回</div><div class="stat-lbl">探索回数（記録）</div></div>' +
      '<div class="stat-card"><div class="stat-val">' + (s.minutes > 0 ? esc(fmtMin(s.minutes)) : '—') + '</div><div class="stat-lbl">累計時間</div></div>' +
      '<div class="stat-card"><div class="stat-val">' + fmtN(s.entryCount) + ' 件</div><div class="stat-lbl">明細数</div></div>' +
      '<div class="stat-card"><div class="stat-val">' + (s.gPerHour === null ? '—' : s.gPerHour.toFixed(2) + ' g/h') + '</div><div class="stat-lbl">平均（1時間あたり）</div></div>' +
      '</div>';

    // 月別グラフ
    const unit = { weight: '重量 (g)', grains: '粒数', count: '探索回数' }[_chartMetric];
    h += '<div class="mpg-sec"><span>📅 月別（直近12か月）</span>' +
      segHtml([['weight', '重量'], ['grains', '粒数'], ['count', '回数']], _chartMetric, k => "mpgChartMetric('" + k + "')") + '</div>' +
      '<div class="mpg-chart-unit">' + unit + '</div>' +
      chartSvg(Store.monthly(logs, _chartMetric, 12), _chartMetric);

    // ポイント別
    const pr = Store.byPoint(logs).sort((a, b) => (b.weightG - a.weightG) || (b.entryCount - a.entryCount));
    const pmax = Math.max.apply(null, pr.map(r => r.weightG).concat([0]));
    h += '<div class="mpg-sec"><span>📍 ポイント別</span></div>';
    h += statRow('', ['回数', '合計g', '粒'], 0, false).replace('mpg-strow', 'mpg-strow head');
    pr.forEach(r => {
      const p = findPoint(r.pointUid);
      let nm;
      if (r.key === '__none__') nm = '（ポイントなし）';
      else if (p) nm = esc(p.icon || '') + ' ' + esc(p.name || '（無名）');
      else nm = esc(r.name || '（無名）') + '<span class="mpg-del-badge">削除済み</span>';
      h += statRow(nm, [fmtN(r.entryCount), fmtG(r.weightG), fmtN(r.grains)],
        pmax > 0 ? Math.round(r.weightG / pmax * 100) : 0, false);
    });

    Store.CATS.forEach(meta => { h += catStatHtml(logs, meta); });
    h += '<div class="mpg-note mpg-pad">※「回数」はその候補を選んだ明細の件数です。複数選択した候補には重量・時間をそれぞれ全量加算するため、' +
      '候補ごとの合計を足しても全体の合計とは一致しません。g/h は所要時間を入力した明細のみで計算します。</div>';
    el.innerHTML = h;
  }
  function statSort(cat, key) { _statSort[cat] = key; renderStats(); }
  function chartMetric(k) { _chartMetric = k; renderStats(); }

  // ── 書出し / 読込 ────────────────────────────
  function exportLogs() {
    if (!Store.getLogs().length) { showToast('書き出す探索記録がありません', 2200); return; }
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const blob = new Blob([JSON.stringify(Store.buildExport(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'goldmap_mypage_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('📤 探索記録を書き出しました', 2200);
  }
  function importPick() {
    const f = $('mpg-imp-file');
    if (f) { f.value = ''; f.click(); }
  }
  function importFile(ev) {
    const file = ev && ev.target && ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showAlert('読込エラー', 'ファイルが大きすぎます（5MBまで）'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      let obj;
      try { obj = JSON.parse(String(reader.result)); }
      catch (e) { showAlert('読込エラー', 'JSONファイルとして読み込めませんでした'); return; }
      let prem = false;
      try { prem = (typeof isPremiumUser === 'function') ? await isPremiumUser() : false; } catch (e) { /* 無料扱い */ }
      let r;
      try { r = await Store.importData(obj, prem); }
      catch (e) { console.warn('[mypage] import失敗', e); showAlert('読込エラー', '保存に失敗しました（端末の保存容量を確認してください）'); return; }
      if (r.gate) { if (typeof showPremiumGate === 'function') showPremiumGate('log_limit'); return; }
      if (!r.ok) { showAlert('読込エラー', r.error || '読み込めませんでした'); return; }
      ensurePtUids();
      await Store.refreshPointCopies(ptsArr());
      renderAll();
      showAlert('読込完了', '追加 ' + r.added + '件 / 更新 ' + r.updated + '件 / 変更なし ' + r.skipped + '件' +
        (r.candAdded || r.candUpdated ? '\n候補: 追加 ' + r.candAdded + '件 / 更新 ' + r.candUpdated + '件' : ''));
    };
    reader.onerror = () => showAlert('読込エラー', 'ファイルを読み込めませんでした');
    reader.readAsText(file);
  }

  // ── 外部フック ───────────────────────────────
  // ui.js の switchTab('pts') から呼ばれる
  async function onTabOpen() {
    try { if (_initP) await _initP; } catch (e) { /* 初期化失敗時も画面は開く */ }
    ensurePtUids();
    await Store.refreshPointCopies(ptsArr());
    if (_sub === 'logs') renderLogs();
    else if (_sub === 'stats') renderStats();
  }
  // points.js の savePts() から呼ばれる（名前変更・移動・削除の直前状態をコピーへ反映）
  function onPtsSaved() {
    if (!Store.isLoaded()) return;
    // コピー更新の有無に関わらず再描画（ポイント削除で「削除済みポイント」表示に変わるため）
    Store.refreshPointCopies(ptsArr()).catch(() => {}).then(() => renderAll());
  }

  function init() {
    _initP = (async () => {
      await Store.load();
      ensurePtUids();
      await Store.refreshPointCopies(ptsArr());
      renderAll();
    })().catch(e => { console.warn('[mypage] 初期化失敗', e); renderAll(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ── HTML(onclick)から呼ぶ関数を公開 ─────────
  Object.assign(window, {
    mpgSwitchSub: switchSub, mpgSetSort: setSort, mpgToggleDateDir: toggleDateDir,
    mpgOpenLogEdit: openLogEdit, mpgAddEntry: addEntry, mpgDelEntry: delEntry,
    mpgEntPoint: entPoint, mpgEntNum: entNum, mpgToggleCat: toggleCat, mpgChip: chip,
    mpgInlineAdd: inlineAdd, mpgSaveLog: saveLog,
    mpgReqDelLog: reqDelLog, mpgCancelDelLog: cancelDelLog, mpgConfirmDelLog: confirmDelLog,
    mpgOpenCand: openCand, mpgCandTab: candTab, mpgCandAdd: candAdd, mpgCandRename: candRename,
    mpgCandRenameOk: candRenameOk, mpgCandToggle: candToggle, mpgCandGroup: candGroup,
    mpgStatSort: statSort, mpgChartMetric: chartMetric,
    mpgExport: exportLogs, mpgImportPick: importPick, mpgImportFile: importFile,
    mpgOnTabOpen: onTabOpen, mpgOnPtsSaved: onPtsSaved,
  });
})();
