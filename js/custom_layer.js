'use strict';
// ═══════════════════════════════════════════
//  CUSTOM LAYER  カスタムインポートデータ
//  完全ローカル・IndexedDB保存・最大10セット
// ═══════════════════════════════════════════

const CL_IDB_KEY     = 'custom_layer_sets'; // IndexedDB キー
const CL_MAX_SETS    = 10;
const CL_VISIBLE_KEY = 'cl_section_on';     // セクションON/OFF
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
let _clOn        = false; // セクションON/OFF
let _clMapShown  = false; // フロートボタントグル状態
let _clEditId    = null;  // 編集中セットID
let _clFilterMap = {};   // {id: filterText}

// ── IndexedDB ───────────────────────────────
async function _clLoad(){
  if(!db) return;
  try{
    const d = await dbGetMine(CL_IDB_KEY);
    _clSets = (d && d.sets) ? d.sets : [];
  }catch(e){ _clSets = []; }
}
async function _clSave(){
  if(!db) return;
  try{ await dbPutMine(CL_IDB_KEY, {sets: _clSets}); }catch(e){}
}

// ── 初期化 ──────────────────────────────────
async function initCustomLayer(){
  _clOn = localStorage.getItem(CL_VISIBLE_KEY) === 'on';
  _clMapShown = localStorage.getItem(CL_SHOWN_KEY) === 'on';
  await _clLoad();
  _applyClSectionUI();
  _renderClSets();
  if(_clOn){
    _showClFloatBtn(true);
    _clSets.forEach(s=>{ if(s.visible) _buildLayer(s); });
    if(_clMapShown) _showAllClLayers();
  }
}

// ── セクションON/OFF ─────────────────────────
function toggleClSection(){
  _clOn = !_clOn;
  localStorage.setItem(CL_VISIBLE_KEY, _clOn ? 'on' : 'off');
  _applyClSectionUI();
  _showClFloatBtn(_clOn);
  if(!_clOn){
    // 全レイヤー非表示
    Object.values(_clLayers).forEach(lg=>{ if(map) map.removeLayer(lg); });
    _clMapShown = false;
    localStorage.setItem(CL_SHOWN_KEY, 'off');
    _applyClFloatState();
  } else {
    _clSets.forEach(s=>{ if(s.visible) _buildLayer(s); });
  }
}
function _applyClSectionUI(){
  const tog = document.getElementById('cl-section-toggle');
  if(tog) tog.classList.toggle('on', _clOn);
  const body = document.getElementById('cl-sets-body');
  if(body) body.style.display = _clOn ? '' : 'none';
}

// ── フロートボタン ───────────────────────────
function _showClFloatBtn(show){
  const btn = document.getElementById('btn-custom-layer');
  if(btn) btn.style.display = show ? '' : 'none';
}
function toggleClMapVisible(){
  _clMapShown = !_clMapShown;
  localStorage.setItem(CL_SHOWN_KEY, _clMapShown ? 'on' : 'off');
  _applyClFloatState();
  if(_clMapShown){
    _showAllClLayers();
  } else {
    _hideAllClLayers();
  }
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
function _buildLayer(set, filterText){
  if(_clLayers[set.id]){ map.removeLayer(_clLayers[set.id]); }
  const lg = L.layerGroup();
  const ft = (filterText || _clFilterMap[set.id] || '').trim().toLowerCase();
  set.points.forEach(p=>{
    if(ft){
      const hit = (p.name||'').toLowerCase().includes(ft) ||
                  (p.note||'').toLowerCase().includes(ft);
      if(!hit) return;
    }
    const ico = L.divIcon({
      html: `<div class="cl-marker" style="background:${set.color}">${set.icon}</div>`,
      className: '', iconSize:[32,32], iconAnchor:[16,32]
    });
    const mk = L.marker([p.lat,p.lng],{icon:ico,pane:'paneUser'});
    mk.on('click',()=>_clShowPopup(p, set));
    mk.addTo(lg);
  });
  _clLayers[set.id] = lg;
  if(_clOn && set.visible && _clMapShown) lg.addTo(map);
}
function _clShowPopup(p, set){
  // 既存鉱床と同デザインのポップアップ
  const content = `
    <div class="mine-popup">
      <div class="mine-popup-name">${set.icon} ${p.name||'（無名）'}</div>
      ${p.note ? `<div class="mine-popup-note">${p.note}</div>` : ''}
      <div class="mine-popup-meta">${set.name}</div>
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
  const ft = _clFilterMap[s.id] || '';
  return `
  <div class="cl-set-card" id="cl-set-${s.id}">
    <div class="cl-set-header">
      <span class="cl-set-icon">${s.icon}</span>
      <span class="cl-set-name">${s.name}</span>
      <span class="cl-set-count">${s.points.length}件</span>
      <div class="cl-set-actions">
        <button class="btn sm" onclick="openClEdit('${s.id}')">✏️</button>
        <button class="btn sm red" onclick="confirmClDelete('${s.id}')">🗑</button>
      </div>
    </div>
    <div class="cl-set-body">
      <label class="cl-visible-row">
        <input type="checkbox" ${s.visible?'checked':''} onchange="clToggleVisible('${s.id}',this.checked)">
        <span>地図に表示</span>
      </label>
      <div class="cl-filter-row">
        <span class="cl-filter-ico">🔍</span>
        <input class="cl-filter-input" type="text" placeholder="セット内を検索…"
          value="${ft}"
          oninput="clFilter('${s.id}',this.value)">
        ${ft ? `<button class="cl-filter-clear" onclick="clFilterClear('${s.id}')">✕</button>` : ''}
      </div>
      <div class="cl-import-row">
        <button class="btn sm blue" onclick="document.getElementById('cl-imp-${s.id}').click()">📥 追加インポート</button>
        <button class="btn sm" onclick="clExport('${s.id}')">📤 セットエクスポート</button>
        <input type="file" id="cl-imp-${s.id}" accept=".geojson,.json,.csv"
          style="display:none" onchange="clImport('${s.id}',event)">
      </div>
      <div class="cl-color-dot" style="background:${s.color}" title="${CL_COLORS.find(c=>c.value===s.color)?.label||''}"></div>
    </div>
  </div>`;
}

// ── 表示/非表示トグル ────────────────────────
function clToggleVisible(id, checked){
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;
  s.visible = checked;
  _clSave();
  if(checked){
    _buildLayer(s);
  } else {
    if(_clLayers[id]){ map.removeLayer(_clLayers[id]); delete _clLayers[id]; }
  }
}

// ── フィルター ───────────────────────────────
function clFilter(id, val){
  _clFilterMap[id] = val;
  const s = _clSets.find(s=>s.id===id);
  if(s && s.visible) _buildLayer(s, val);
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
  }
  const s = _clSets.find(s=>s.id===id);
  if(s && s.visible) _buildLayer(s, '');
}

// ── 新規セット追加 ───────────────────────────
function openClAdd(){
  _clEditId = null;
  document.getElementById('cl-dlg-title').textContent = '新規セット追加';
  document.getElementById('cl-dlg-name').value = '';
  _renderIconPicker(CL_ICONS[0]);
  _renderColorPicker(CL_COLORS[0].value);
  showDlg('dlg-cl-edit');
}

// ── セット編集 ───────────────────────────────
function openClEdit(id){
  const s = _clSets.find(s=>s.id===id);
  if(!s) return;
  _clEditId = id;
  document.getElementById('cl-dlg-title').textContent = 'セット編集';
  document.getElementById('cl-dlg-name').value = s.name;
  _renderIconPicker(s.icon);
  _renderColorPicker(s.color);
  showDlg('dlg-cl-edit');
}

function saveClEdit(){
  const name = document.getElementById('cl-dlg-name').value.trim();
  if(!name){ document.getElementById('cl-dlg-name').focus(); return; }
  const icon  = document.getElementById('cl-dlg-icon-selected').dataset.icon;
  const color = document.getElementById('cl-dlg-color-selected').dataset.color;

  if(_clEditId){
    const s = _clSets.find(s=>s.id===_clEditId);
    if(s){ s.name=name; s.icon=icon; s.color=color; }
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
  }
  _clSave();
  _renderClSets();
  closeOv();
}

// ── アイコン・色ピッカー ─────────────────────
function _renderIconPicker(selected){
  const el = document.getElementById('cl-icon-picker');
  if(!el) return;
  el.innerHTML = CL_ICONS.map(ic=>
    `<button class="cl-ico-btn${ic===selected?' sel':''}" onclick="clSelectIcon('${ic}')" data-icon="${ic}">${ic}</button>`
  ).join('');
  document.getElementById('cl-dlg-icon-selected').dataset.icon = selected;
  document.getElementById('cl-dlg-icon-selected').textContent  = selected;
}
function clSelectIcon(ic){
  document.getElementById('cl-dlg-icon-selected').dataset.icon = ic;
  document.getElementById('cl-dlg-icon-selected').textContent  = ic;
  document.querySelectorAll('.cl-ico-btn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.icon===ic);
  });
}

function _renderColorPicker(selected){
  const el = document.getElementById('cl-color-picker');
  if(!el) return;
  el.innerHTML = CL_COLORS.map(c=>
    `<button class="cl-col-btn${c.value===selected?' sel':''}"
      style="background:${c.value}"
      onclick="clSelectColor('${c.value}')"
      data-color="${c.value}"
      title="${c.label}"></button>`
  ).join('');
  document.getElementById('cl-dlg-color-selected').dataset.color = selected;
  document.getElementById('cl-dlg-color-selected').style.background = selected;
}
function clSelectColor(val){
  document.getElementById('cl-dlg-color-selected').dataset.color = val;
  document.getElementById('cl-dlg-color-selected').style.background = val;
  document.querySelectorAll('.cl-col-btn').forEach(b=>{
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
    s.points = s.points.concat(added);
    await _clSave();
    if(s.visible) _buildLayer(s);
    _renderClSets();
    showAlert('完了', `${added.length}件を「${s.name}」に追加しました`);
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
      properties: { name:p.name, note:p.note }
    }))
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}));
  a.download = `${s.name.replace(/[^\w\u3000-\u9fff]/g,'_')}.geojson`;
  a.click();
}
