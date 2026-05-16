'use strict';
// ═══════════════════════════════════════════
//  CUSTOM LAYER  カスタムインポートデータ
//  完全ローカル・IndexedDB保存・最大10セット
// ═══════════════════════════════════════════

const CL_IDB_KEY     = 'custom_layer_sets'; // IndexedDB キー
const CL_MAX_SETS    = 10;
const CL_SHOWN_KEY   = 'cl_map_shown';      // フロートボタン状態

// ── アイコン選択肢（40種）────────────────────
const CL_ICONS = [
  '📍','📌','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
  '⛏','💎','🪨','🔩','⚙️','🪙','🥇','🏺','🔶','🔷',
  '🏔','🗻','🌋','🏝','🌊','🌿','🌲','💧','🔥','💥',
  '⭐','💫','❗','✅','🚩','🏁','🎯','🧭','🗺','🏕'
];

// ── マーカー色（8色）────────────────────────
const CL_COLORS = [
  { label:'赤',    value:'#e74c3c' },
  { label:'橙',    value:'#e67e22' },
  { label:'黄',    value:'#f1c40f' },
  { label:'緑',    value:'#2ecc71' },
  { label:'青',    value:'#3498db' },
  { label:'紫',    value:'#9b59b6' },
  { label:'白',    value:'#ecf0f1' },
  { label:'黒',    value:'#2c3e50' },
];

// ── 状態 ────────────────────────────────────
let _clSets      = [];   // [{id,name,icon,color,visible,points:[{lat,lng,name,note}]}]
let _clLayers    = {};   // {id: L.layerGroup}
let _clMapShown  = false; // フロートボタントグル状態
let _clEditId    = null;  // 編集中セットID
let _clFilterMap = {};   // {id: filterText}

// ── IndexedDB ───────────────────────────────
async function _clLoad(){
  if(!db) return;
  try{
    const d = await dbGetMine(CL_IDB_KEY);
    _clSets = (d && d.sets) ? d.sets : [];
    // フィルター文字列を復元
    _clFilterMap = {};
    _clSets.forEach(s=>{ if(s.filter) _clFilterMap[s.id] = s.filter; });
  }catch(e){ _clSets = []; }
}
async function _clSave(){
  if(!db) return;
  try{
    // フィルター文字列をセットに埋め込んで保存
    const sets = _clSets.map(s=>({ ...s, filter: _clFilterMap[s.id] || '' }));
    await dbPutMine(CL_IDB_KEY, {sets});
  }catch(e){}
}

// ── 初期化 ──────────────────────────────────
async function initCustomLayer(){
  await _clLoad();
  _renderClSets();
  _clSets.forEach(s=>{ if(s.visible) _buildLayer(s); });
  _syncFloatBtn();
}

// ── フロートボタン ───────────────────────────
function _showClFloatBtn(show){
  const btn = document.getElementById('btn-custom-layer');
  if(btn) btn.style.display = show ? '' : 'none';
}
function _syncFloatBtn(){
  const anyVisible = _clSets.some(s => s.visible);
  const btn = document.getElementById('btn-custom-layer');
  if(btn){
    btn.style.display = _clSets.length ? '' : 'none';
    btn.classList.toggle('active', anyVisible);
  }
  _clMapShown = anyVisible;
  localStorage.setItem(CL_SHOWN_KEY, anyVisible ? 'on' : 'off');
}
function toggleClMapVisible(){
  if(_clMapShown){
    // 地図から非表示にするだけ（visibleは触らない）
    _clMapShown = false;
    _hideAllClLayers();
    _applyClFloatState();
    return;
  }
  // ONにする場合はプレミアムチェック
  isPremiumUser().then(premium=>{
    if(!premium){ showPremiumGate('mymap'); return; }
    _clMapShown = true;
    _showAllClLayers();
    _applyClFloatState();
  });
}
function _applyClFloatState(){
  const btn = document.getElementById('btn-custom-layer');
  if(btn) btn.classList.toggle('active', _clMapShown);
}
function _showAllClLayers(){
  _clSets.forEach(s=>{
    if(!s.visible) return;
    if(!_clLayers[s.id]) _buildLayer(s);
    else _clLayers[s.id].addTo(map);
  });
}
function _hideAllClLayers(){
  Object.values(_clLayers).forEach(lg=>{ if(map) map.removeLayer(lg); });
}

// ── レイヤー構築 ─────────────────────────────
function _matchFilter(p, ft){
  if(!ft) return true;
  const target = ((p.name||'') + ' ' + (p.note||'')).toLowerCase();
  // | でOR分割
  const orGroups = ft.split('|').map(s=>s.trim()).filter(s=>s);
  return orGroups.some(group=>{
    // スペースでAND分割
    const terms = group.split(/\s+/).filter(s=>s);
    return terms.every(term=>{
      if(term.startsWith('-')){
        // 除外
        const word = term.slice(1);
        return word ? !target.includes(word) : true;
      }
      return target.includes(term);
    });
  });
}

function _buildLayer(set, filterText){
  if(_clLayers[set.id]){ map.removeLayer(_clLayers[set.id]); }
  const lg = L.layerGroup();
  const ft = (filterText || _clFilterMap[set.id] || '').trim().toLowerCase();
  set.points.forEach(p=>{
    if(ft && !_matchFilter(p, ft)) return;
    const pIcon  = p.icon  || set.icon;
    const pColor = p.color || set.color;
    const ico = L.divIcon({
      html: `<div class="cl-marker" style="background:${pColor}"><span class="cl-marker-ico">${pIcon}</span></div>`,
      className: '', iconSize:[32,32], iconAnchor:[16,32]
    });
    const mk = L.marker([p.lat,p.lng],{icon:ico,pane:'paneUser'});
    mk.on('click',()=>_clShowPopup(p, set));
    mk.addTo(lg);
  });
  _clLayers[set.id] = lg;
  if(set.visible) lg.addTo(map);
}
function _clShowPopup(p, set){
  const pIcon = p.icon || set.icon;
  const la = parseFloat(p.lat).toFixed(6);
  const ln = parseFloat(p.lng).toFixed(6);
  const gmapBtns = `<div style="margin-top:8px;text-align:right;">
    <a href="https://maps.google.com/?q=${la},${ln}" target="_blank" rel="noopener"
       onclick="return confirm('Googleマップを開きます')"
       style="font-size:11px;color:#1a73e8;text-decoration:none;font-weight:700;">
      🗺 Googleマップで確認
    </a>
  </div>`;
  const content = `
    <div class="mine-popup">
      <div class="mine-popup-name">${pIcon} ${p.name||'（無名）'}</div>
      ${p.note ? `<div class="mine-popup-note">${p.note}</div>` : ''}
      <div class="mine-popup-meta">${set.name}</div>
      ${gmapBtns}
    </div>`;
  L.popup({maxWidth:280, className:'mine-pop'})
    .setLatLng([p.lat,p.lng])
    .setContent(content)
    .openOn(map);
}

// ── セット一覧レンダリング ───────────────────
function _renderClSets(){
  const el = document.getElementById('cl-sets-list');
  if(!el) return;
  if(!_clSets.length){
    el.innerHTML = '<div class="cl-empty">セットがありません。「＋ 新規セット追加」で作成してください。</div>';
    return;
  }
  el.innerHTML = _clSets.map(s=> _clSetHTML(s)).join('');
}

function _clSetHTML(s){
  const ft = (_clFilterMap[s.id] || '').trim().toLowerCase();
  const filteredCount = ft ? s.points.filter(p=>_matchFilter(p, ft)).length : null;
  const countLabel = filteredCount !== null
    ? `${s.points.length}件 <span class="cl-filter-count">→ ${filteredCount}件</span>`
    : `${s.points.length}件`;

  return `
  <div class="cl-set-card" id="cl-set-${s.id}">

    <!-- ① セットヘッダー（タップで設定アコーディオン開閉） -->
    <div class="cl-set-header" onclick="clToggleSetBody('${s.id}')" style="cursor:pointer">
      <span class="cl-set-icon">${s.icon}</span>
      <span class="cl-set-name">${s.name}</span>
      <button class="btn sm cl-action-btn" onclick="event.stopPropagation();openClEdit('${s.id}')">✏️</button>
      <span class="cl-set-count">${countLabel}</span>
      <span class="cl-set-hd-arrow" id="cl-set-arrow-${s.id}">▶</span>
      <button class="cl-vis-mini${s.visible?' on':''}" onclick="event.stopPropagation();clToggleVisible('${s.id}')" title="地図に表示">
        <span class="cl-vis-mini-thumb"></span>
        <span class="cl-vis-mini-lbl">${s.visible?'表示':'表示'}</span>
      </button>
    </div>

    <!-- ② セット設定アコーディオン（デフォルト閉じ） -->
    <div class="cl-set-body" id="cl-set-body-${s.id}" style="display:none">
      <!-- フィルター行 -->
      <div class="cl-filter-row">
        <span class="cl-filter-ico">🔍</span>
        <input class="cl-filter-input" type="text" placeholder="フィルター…"
          value="${_clFilterMap[s.id]||''}"
          oninput="clFilter('${s.id}',this.value)">
        ${(_clFilterMap[s.id]||'') ? `<button class="cl-filter-clear" onclick="clFilterClear('${s.id}')">✕</button>` : ''}
        ${filteredCount !== null ? `<span class="cl-filter-badge">${filteredCount}件</span>` : ''}
      </div>
      <!-- インポート/エクスポート/削除 -->
      <div class="cl-import-row">
        <button class="btn sm blue" onclick="document.getElementById('cl-imp-${s.id}').click()">📥 追加インポート</button>
        <button class="btn sm" onclick="clExport('${s.id}')">📤 エクスポート</button>
        <button class="btn sm red cl-action-btn" onclick="confirmClDelete('${s.id}')">🗑</button>
        <input type="file" id="cl-imp-${s.id}" accept=".geojson,.json,.csv"
          style="display:none" onchange="clImport('${s.id}',event)">
      </div>
    </div>

    <!-- ③ 個別ポイント アコーディオン（設定と独立・0件時非表示） -->
    ${s.points.length > 0 ? `
    <div class="cl-pt-accordion-header" onclick="clTogglePointList('${s.id}')" id="cl-pt-acc-${s.id}">
      <span>📍 ${s.points.length}件のポイント</span>
      <span class="cl-pt-acc-arrow" id="cl-pt-arrow-${s.id}">▶</span>
    </div>
    <div class="cl-pt-list" id="cl-pt-list-${s.id}" style="display:none;">
      ${s.points.map((p, i) => {
        const ft = (_clFilterMap[s.id] || '').trim().toLowerCase();
        const filtered = ft && !_matchFilter(p, ft);
        return `
        <div class="cl-pt-row${filtered ? ' cl-pt-row--filtered-out' : ''}" onclick="clJumpToPoint('${s.id}',${i})">
          <span class="cl-pt-icon" style="background:${p.color||s.color}">${p.icon||s.icon}</span>
          <div class="cl-pt-info">
            <div class="cl-pt-name">${p.name || '（名前なし）'}</div>
            <div class="cl-pt-meta">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.note ? ' · ' + p.note.slice(0,20) + (p.note.length>20?'…':'') : ''}</div>
          </div>
          <div class="cl-pt-row-btns" onclick="event.stopPropagation()">
            <button class="btn sm" onclick="openClPointEdit('${s.id}',${i})">✏️</button>
            <button class="btn sm red" onclick="openClPointDel('${s.id}',${i})">🗑</button>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

  </div>`;
}

// ── セット設定アコーディオン開閉 ──────────────
function clToggleSetBody(id){
  const body  = document.getElementById(`cl-set-body-${id}`);
  const arrow = document.getElementById(`cl-set-arrow-${id}`);
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display  = isOpen ? 'none' : 'block';
  if(arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

// ── 表示/非表示トグル ────────────────────────
function clToggleVisible(id){
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;
  s.visible = !s.visible;
  _clSave();
  // ボタンのon/offクラス更新
  const btn = document.querySelector(`#cl-set-${id} .cl-vis-mini`);
  if(btn) btn.classList.toggle('on', s.visible);
  if(s.visible){
    if(!_clMapShown){
      _clMapShown = true;
      _applyClFloatState();
    }
    _buildLayer(s);
  } else {
    if(_clLayers[id]){ map.removeLayer(_clLayers[id]); delete _clLayers[id]; }
  }
}

// ── フィルター ───────────────────────────────
let _clFilterSaveTimer = null;
function _clFilterSaveDebounced(){
  clearTimeout(_clFilterSaveTimer);
  _clFilterSaveTimer = setTimeout(()=>_clSave(), 800);
}
function clFilter(id, val){
  _clFilterMap[id] = val;
  const s = _clSets.find(s=>s.id===id);
  if(s && s.visible) _buildLayer(s, val);
  _clFilterSaveDebounced();
  // クリアボタン表示更新
  const card = document.getElementById(`cl-set-${id}`);
  if(card){
    const clear = card.querySelector('.cl-filter-clear');
    if(val && !clear){
      const inp = card.querySelector('.cl-filter-input');
      const btn = document.createElement('button');
      btn.className='cl-filter-clear';
      btn.textContent='✕';
      btn.onclick=()=>clFilterClear(id);
      inp.after(btn);
    } else if(!val && clear){
      clear.remove();
    }
    // フィルター件数バッジ更新
    let badge = card.querySelector('.cl-filter-badge');
    if(val && s){
      const n = s.points.filter(p=>_matchFilter(p, val.trim().toLowerCase())).length;
      if(!badge){
        badge = document.createElement('span');
        badge.className = 'cl-filter-badge';
        const clearOrInp = card.querySelector('.cl-filter-clear') || card.querySelector('.cl-filter-input');
        if(clearOrInp) clearOrInp.after(badge);
      }
      badge.textContent = `${n}件`;
    } else if(badge){
      badge.remove();
    }
    // ポイント行のグレーアウトをリアルタイム更新
    const ptList = card.querySelector(`#cl-pt-list-${id}`);
    if(ptList && s){
      const ft = val.trim().toLowerCase();
      ptList.querySelectorAll('.cl-pt-row').forEach((row, i) => {
        const p = s.points[i];
        if(!p) return;
        const out = ft && !_matchFilter(p, ft);
        row.classList.toggle('cl-pt-row--filtered-out', out);
      });
    }
    // ヘッダーのカウント表示も更新
    const countEl = card.querySelector('.cl-set-count');
    if(countEl){
      if(val){
        const n = s.points.filter(p=>_matchFilter(p, val.trim().toLowerCase())).length;
        countEl.innerHTML = `${s.points.length}件 <span class="cl-filter-count">→ ${n}件</span>`;
      } else {
        countEl.textContent = `${s.points.length}件`;
      }
    }
  }
}
function clFilterClear(id){
  _clFilterMap[id]='';
  const card = document.getElementById(`cl-set-${id}`);
  if(card){
    const inp = card.querySelector('.cl-filter-input');
    if(inp) inp.value='';
    const clear = card.querySelector('.cl-filter-clear');
    if(clear) clear.remove();
    const badge = card.querySelector('.cl-filter-badge');
    if(badge) badge.remove();
    // ポイント行のグレーアウト解除
    const ptList = card.querySelector(`#cl-pt-list-${id}`);
    if(ptList) ptList.querySelectorAll('.cl-pt-row--filtered-out').forEach(row => row.classList.remove('cl-pt-row--filtered-out'));
    // ヘッダーのカウント表示をリセット
    const s = _clSets.find(s=>s.id===id);
    const countEl = card.querySelector('.cl-set-count');
    if(countEl && s) countEl.textContent = `${s.points.length}件`;
  }
  const s = _clSets.find(s=>s.id===id);
  if(s && s.visible) _buildLayer(s, '');
  _clSave();
}

// ── 新規セット追加 ───────────────────────────
function openClAdd(){
  _clEditId = null;
  document.getElementById('cl-dlg-title').textContent = '新規セット追加';
  document.getElementById('cl-dlg-name').value = '';
  _clRenderIconPicker(CL_ICONS[0]);
  _clRenderColorPicker(CL_COLORS[0].value);
  showDlg('dlg-cl-edit');
}

// ── セット編集 ───────────────────────────────
function openClEdit(id){
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;
  _clEditId = id;
  document.getElementById('cl-dlg-title').textContent = 'セット編集';
  document.getElementById('cl-dlg-name').value = s.name;
  _clRenderIconPicker(s.icon);
  _clRenderColorPicker(s.color);
  showDlg('dlg-cl-edit');
}

function saveClEdit(){
  const name = document.getElementById('cl-dlg-name').value.trim();
  if(!name){ document.getElementById('cl-dlg-name').focus(); return; }
  const icon  = document.getElementById('cl-dlg-icon-selected').dataset.icon;
  const color = document.getElementById('cl-dlg-color-selected').dataset.color;

  if(_clEditId){
    const s = _clSets.find(s=>s.id===_clEditId);
    if(s){
      s.name=name; s.icon=icon; s.color=color;
      if(s.visible) _buildLayer(s); // 地図即時反映
    }
  } else {
    if(_clSets.length >= CL_MAX_SETS){
      showAlert('上限','セットは最大'+CL_MAX_SETS+'件です');
      return;
    }
    _clSets.push({
      id: 'cl_'+Date.now(),
      name, icon, color,
      visible: false,
      points: []
    });
    _showClFloatBtn(true);
  }
  _clSave();
  _renderClSets();
  closeOv();
}

// ── アイコン・色ピッカー ─────────────────────
function _clRenderIconPicker(selected){
  const el = document.getElementById('cl-icon-picker');
  if(!el) return;
  el.innerHTML = CL_ICONS.map(ic=>
    `<button class="cl-ico-btn${ic===selected?' sel':''}" type="button" data-icon="${ic}">${ic}</button>`
  ).join('');
  el.querySelectorAll('.cl-ico-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> clSelectIcon(btn.dataset.icon));
  });
  document.getElementById('cl-dlg-icon-selected').dataset.icon = selected;
  document.getElementById('cl-dlg-icon-selected').textContent  = selected;
}
function clSelectIcon(ic){
  document.getElementById('cl-dlg-icon-selected').dataset.icon = ic;
  document.getElementById('cl-dlg-icon-selected').textContent  = ic;
  document.querySelectorAll('#cl-icon-picker .cl-ico-btn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.icon===ic);
  });
}

function _clRenderColorPicker(selected){
  const el = document.getElementById('cl-color-picker');
  if(!el) return;
  el.innerHTML = CL_COLORS.map(c=>
    `<button class="cl-col-btn${c.value===selected?' sel':''}"
      type="button"
      style="background:${c.value}"
      data-color="${c.value}"
      title="${c.label}"></button>`
  ).join('');
  el.querySelectorAll('.cl-col-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> clSelectColor(btn.dataset.color));
  });
  document.getElementById('cl-dlg-color-selected').dataset.color = selected;
  document.getElementById('cl-dlg-color-selected').style.background = selected;
}
function clSelectColor(val){
  document.getElementById('cl-dlg-color-selected').dataset.color = val;
  document.getElementById('cl-dlg-color-selected').style.background = val;
  document.querySelectorAll('#cl-color-picker .cl-col-btn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.color===val);
  });
}

// ── 削除（確認ダイアログ） ───────────────────
function confirmClDelete(id){
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;
  document.getElementById('cl-del-name').textContent  = s.name;
  document.getElementById('cl-del-count').textContent = s.points.length;
  document.getElementById('cl-del-confirm-btn').onclick = ()=>_doClDelete(id);
  showDlg('dlg-cl-delete');
}
function _doClDelete(id){
  if(_clLayers[id]){ map.removeLayer(_clLayers[id]); delete _clLayers[id]; }
  _clSets = _clSets.filter(s=>s.id!==id);
  delete _clFilterMap[id];
  _clSave();
  _renderClSets();
  _syncFloatBtn(); // ③ セット削除後のフロートボタン状態を同期
  closeOv();
}

// ── インポート（GeoJSON / CSV） ──────────────
async function clImport(id, evt){
  const file = evt.target.files[0];
  evt.target.value = '';
  if(!file) return;
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;

  try{
    const text = await file.text();
    let added = [];

    if(file.name.toLowerCase().endsWith('.csv')){
      // CSV: 緯度,経度,名前,メモ
      const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
      // ヘッダー行スキップ判定（1行目が数値でなければスキップ）
      const start = isNaN(parseFloat(lines[0]?.split(',')[0])) ? 1 : 0;
      for(let i=start;i<lines.length;i++){
        const cols = lines[i].split(',');
        const lat = parseFloat(cols[0]);
        const lng = parseFloat(cols[1]);
        if(isNaN(lat)||isNaN(lng)) continue;
        added.push({
          lat, lng,
          name: (cols[2]||'').trim(),
          note: (cols[3]||'').trim()
        });
      }
    } else {
      // GeoJSON
      const json = JSON.parse(text);
      if(!json.features) throw new Error('featuresがありません');
      json.features.forEach(f=>{
        if(!f.geometry||f.geometry.type!=='Point') return;
        const [lng,lat] = f.geometry.coordinates;
        const p = f.properties||{};
        added.push({
          lat, lng,
          name: p.name||p.mine_name||p.mineName||'',
          note: p.note||p.description||p.memo||p.legend||''
        });
      });
    }

    if(!added.length) throw new Error('有効なポイントが見つかりません');

    // ⑥ 重複チェック（lat/lng完全一致）
    const existing = s.points;
    const deduped = added.filter(np =>
      !existing.some(ep => ep.lat === np.lat && ep.lng === np.lng)
    );
    const dupCount = added.length - deduped.length;
    if(!deduped.length) throw new Error('すべて重複データのためスキップしました');

    s.points = s.points.concat(deduped);
    await _clSave();
    if(s.visible) _buildLayer(s);
    _renderClSets();
    const dupMsg = dupCount > 0 ? `（重複${dupCount}件スキップ）` : '';
    showAlert('完了', `${deduped.length}件を「${s.name}」に追加しました${dupMsg}`);
  }catch(e){
    showAlert('エラー', 'インポートに失敗しました: '+e.message);
  }
}

// ── エクスポート ─────────────────────────────
function clExport(id){
  const s = _clSets.find(s=>s.id===id);
  if(!s||!s.points.length){ showAlert('エラー','エクスポートするデータがありません'); return; }
  const fc = {
    type: 'FeatureCollection',
    features: s.points.map(p=>({
      type: 'Feature',
      geometry: { type:'Point', coordinates:[p.lng,p.lat] },
      properties: { name:p.name, note:p.note } // icon/colorは除外
    }))
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}));
  a.download = `${s.name.replace(/[^\w\u3000-\u9fff]/g,'_')}.geojson`;
  a.click();
}

// ── 個別ポイント アコーディオン開閉 ────────────────
function clTogglePointList(setId) {
  const list  = document.getElementById(`cl-pt-list-${setId}`);
  const arrow = document.getElementById(`cl-pt-arrow-${setId}`);
  if (!list || !arrow) return;
  const isOpen = list.style.display !== 'none';
  list.style.display  = isOpen ? 'none' : 'block';
  arrow.textContent   = isOpen ? '▶' : '▼';
}

// ── 個別ポイント編集ダイアログ用ピッカー ────────────────
function _renderPtIconPicker(selected){
  const el = document.getElementById('cl-pt-icon-picker');
  if(!el) return;
  el.innerHTML = CL_ICONS.map(ic=>
    `<button class="cl-ico-btn${ic===selected?' sel':''}" type="button" data-icon="${ic}">${ic}</button>`
  ).join('');
  el.querySelectorAll('.cl-ico-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> clSelectPtIcon(btn.dataset.icon));
  });
  const sel = document.getElementById('cl-pt-icon-selected');
  if(sel){ sel.dataset.icon = selected; sel.textContent = selected; }
}
function clSelectPtIcon(ic){
  const sel = document.getElementById('cl-pt-icon-selected');
  if(sel){ sel.dataset.icon = ic; sel.textContent = ic; }
  document.querySelectorAll('#cl-pt-icon-picker .cl-ico-btn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.icon===ic);
  });
  _syncPtPickerPreview();
}

function _renderPtColorPicker(selected){
  const el = document.getElementById('cl-pt-color-picker');
  if(!el) return;
  el.innerHTML = CL_COLORS.map(c=>
    `<button class="cl-col-btn${c.value===selected?' sel':''}"
      type="button"
      style="background:${c.value}"
      data-color="${c.value}"
      title="${c.label}"></button>`
  ).join('');
  el.querySelectorAll('.cl-col-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> clSelectPtColor(btn.dataset.color));
  });
  const sel = document.getElementById('cl-pt-color-selected');
  if(sel){ sel.dataset.color = selected; sel.style.background = selected; }
}
function clSelectPtColor(val){
  const sel = document.getElementById('cl-pt-color-selected');
  if(sel){ sel.dataset.color = val; sel.style.background = val; }
  document.querySelectorAll('#cl-pt-color-picker .cl-col-btn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.color===val);
  });
  _syncPtPickerPreview();
}

// ── ポイント編集ダイアログ：アイコン・色アコーディオン ──
function clTogglePtPickerAccordion(){
  const body  = document.getElementById('cl-pt-picker-body');
  const arrow = document.getElementById('cl-pt-picker-arrow');
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if(arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

// プレビュー同期ヘルパー
function _syncPtPickerPreview(){
  const iconEl  = document.getElementById('cl-pt-icon-selected');
  const colorEl = document.getElementById('cl-pt-color-selected');
  const iconPrev  = document.getElementById('cl-pt-icon-preview');
  const colorPrev = document.getElementById('cl-pt-color-preview');
  if(iconPrev  && iconEl)  iconPrev.textContent = iconEl.dataset.icon || '📍';
  if(colorPrev && colorEl) colorPrev.style.background = colorEl.dataset.color || '#e74c3c';
}

// ── 個別ポイント編集ダイアログを開く ───────────────
let _editingPointSetId  = null;
let _editingPointIndex  = null;

function openClPointEdit(setId, idx) {
  const s = _clSets.find(s => s.id === setId);
  if (!s || !s.points[idx]) return;
  const p = s.points[idx];
  _editingPointSetId = setId;
  _editingPointIndex = idx;
  document.getElementById('cl-pt-edit-title').textContent = `ポイントを編集（${s.name}）`;
  document.getElementById('cl-pt-name').value = p.name || '';
  document.getElementById('cl-pt-note').value = p.note || '';
  document.getElementById('cl-pt-lat').value  = p.lat;
  document.getElementById('cl-pt-lng').value  = p.lng;
  // アイコン・色ピッカーをポイント個別値で初期化（未設定ならセットのデフォルト）
  _renderPtIconPicker(p.icon  || s.icon);
  _renderPtColorPicker(p.color || s.color);
  // アコーディオンをデフォルト閉じにリセット
  const body  = document.getElementById('cl-pt-picker-body');
  const arrow = document.getElementById('cl-pt-picker-arrow');
  if(body)  body.style.display = 'none';
  if(arrow) arrow.textContent  = '▶';
  // プレビュー同期
  _syncPtPickerPreview();
  showDlg('dlg-cl-point-edit');
}

async function saveClPointEdit() {
  const s = _clSets.find(s => s.id === _editingPointSetId);
  if (!s || _editingPointIndex === null) return;
  const lat = parseFloat(document.getElementById('cl-pt-lat').value);
  const lng = parseFloat(document.getElementById('cl-pt-lng').value);
  if (isNaN(lat) || isNaN(lng)) { showAlert('エラー', '緯度・経度は数値で入力してください'); return; }
  s.points[_editingPointIndex] = {
    ...s.points[_editingPointIndex],
    name:  document.getElementById('cl-pt-name').value.trim(),
    note:  document.getElementById('cl-pt-note').value.trim(),
    lat, lng,
    icon:  document.getElementById('cl-pt-icon-selected').dataset.icon,
    color: document.getElementById('cl-pt-color-selected').dataset.color,
  };
  await _clSave();
  if (s.visible) _buildLayer(s);
  // ② 再描画前に開いていたアコーディオン状態を保存
  const ptListOpen   = document.getElementById(`cl-pt-list-${_editingPointSetId}`)?.style.display !== 'none';
  const setBodyOpen  = document.getElementById(`cl-set-body-${_editingPointSetId}`)?.style.display !== 'none';
  _renderClSets();
  // 展開状態を復元
  if(ptListOpen){
    const list  = document.getElementById(`cl-pt-list-${_editingPointSetId}`);
    const arrow = document.getElementById(`cl-pt-arrow-${_editingPointSetId}`);
    if(list)  list.style.display = 'block';
    if(arrow) arrow.textContent  = '▼';
  }
  if(setBodyOpen){
    const body  = document.getElementById(`cl-set-body-${_editingPointSetId}`);
    const arrow = document.getElementById(`cl-set-arrow-${_editingPointSetId}`);
    if(body)  body.style.display = 'block';
    if(arrow) arrow.textContent  = '▼';
  }
  closeOv();
}

// ── 個別ポイント削除確認ダイアログを開く ───────────
let _deletingPointSetId  = null;
let _deletingPointIndex  = null;

function openClPointDel(setId, idx) {
  const s = _clSets.find(s => s.id === setId);
  if (!s || !s.points[idx]) return;
  _deletingPointSetId  = setId;
  _deletingPointIndex  = idx;
  document.getElementById('cl-pt-del-name').textContent = s.points[idx].name || '（名前なし）';
  const btn = document.getElementById('cl-pt-del-confirm-btn');
  btn.onclick = () => _doClPointDelete();
  showDlg('dlg-cl-point-del');
}

async function _doClPointDelete() {
  const s = _clSets.find(s => s.id === _deletingPointSetId);
  if (!s || _deletingPointIndex === null) return;
  s.points.splice(_deletingPointIndex, 1);
  await _clSave();
  if (s.visible) _buildLayer(s);
  // ② 再描画前に開いていたアコーディオン状態を保存
  const ptListOpenD  = document.getElementById(`cl-pt-list-${_deletingPointSetId}`)?.style.display !== 'none';
  const setBodyOpenD = document.getElementById(`cl-set-body-${_deletingPointSetId}`)?.style.display !== 'none';
  _renderClSets();
  // 展開状態を復元（削除後もリスト表示）
  if(ptListOpenD){
    const list  = document.getElementById(`cl-pt-list-${_deletingPointSetId}`);
    const arrow = document.getElementById(`cl-pt-arrow-${_deletingPointSetId}`);
    if(list)  list.style.display = 'block';
    if(arrow) arrow.textContent  = '▼';
  }
  if(setBodyOpenD){
    const body  = document.getElementById(`cl-set-body-${_deletingPointSetId}`);
    const arrow = document.getElementById(`cl-set-arrow-${_deletingPointSetId}`);
    if(body)  body.style.display = 'block';
    if(arrow) arrow.textContent  = '▼';
  }
  closeOv();
}

// ── 個別ポイント 地図ジャンプ ────────────────────
function clJumpToPoint(setId, idx) {
  const s = _clSets.find(s => s.id === setId);
  if (!s || !s.points[idx]) return;
  const p = s.points[idx];
  switchTab('map');
  setTimeout(() => {
    map.invalidateSize({pan: false});
    map.setView([p.lat, p.lng], 15);
    _clShowPopup(p, s);
  }, 320);
}