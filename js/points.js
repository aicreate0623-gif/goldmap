'use strict';
//  ユーザーポイント
// ═══════════════════════════════════════════
const MAX_PT = 1000;
let pts = [], nid = 1;

// ── マーカーアイコン・カラー ──────────────────
const PT_ICONS = [
  '⛏','📍','📌','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
  '💎','🪨','🔩','⚙️','🪙','🥇','🏺','🔶','🔷',
  '🏔','🗻','🌋','🏝','🌊','🌿','🌲','💧','🔥','💥',
  '⭐','💫','❗','✅','🚩','🏁','🎯','🧭','🗺','🏕'
];
const PT_COLORS = [
  { label:'なし',  value:'transparent' },
  { label:'金',    value:'#c8a020' },
  { label:'赤',    value:'#e74c3c' },
  { label:'橙',    value:'#e67e22' },
  { label:'黄',    value:'#f1c40f' },
  { label:'緑',    value:'#2ecc71' },
  { label:'青',    value:'#3498db' },
  { label:'紫',    value:'#9b59b6' },
  { label:'白',    value:'#ecf0f1' },
  { label:'黒',    value:'#2c3e50' },
];
const PT_DEFAULT_ICON  = '⛏';
const PT_DEFAULT_COLOR = '#c8a020';

// ── ★評価ヘルパー ────────────────────────────
let _curStars = 0;
let _curIcon  = PT_DEFAULT_ICON;
let _curColor = PT_DEFAULT_COLOR;

function setStarRating(v) {
  _curStars = (_curStars === v) ? 0 : v;
  _renderStarUI(_curStars);
}
function _renderStarUI(v) {
  document.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('active', i < v));
  const labels = ['未評価','★ もう少し','★★ 良い','★★★ 最高'];
  const el = document.getElementById('star-label');
  if (el) el.textContent = labels[v] || '未評価';
  _curStars = v;
}
function starsToHtml(v) {
  if (!v) return '';
  return `<span style="color:var(--gold-lt)">${'★'.repeat(v)}</span><span style="color:rgba(200,170,80,0.3)">${'☆'.repeat(3-v)}</span>`;
}

// ── アイコン・色ピッカー ──────────────────────
function _renderIconPicker(selected, pickerId, selectedId) {
  const el = document.getElementById(pickerId); if (!el) return;
  el.innerHTML = PT_ICONS.map(ic =>
    `<button class="cl-ico-btn${ic===selected?' sel':''}" type="button" data-icon="${ic}">${ic}</button>`
  ).join('');
  el.querySelectorAll('.cl-ico-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ic = btn.dataset.icon;
      if (pickerId === 'pt-icon-picker') ptSelectIcon(ic);
      else impSelectIcon(ic);
    });
  });
  const sel = document.getElementById(selectedId);
  if (sel) { sel.dataset.icon = selected; sel.textContent = selected; }
  // ポイントタブのヘッダープレビュー初期化
  if (pickerId === 'pt-icon-picker') {
    const prev = document.getElementById('pt-icon-preview');
    if (prev) prev.textContent = selected;
  }
}

function _renderColorPicker(selected, pickerId, selectedId) {
  const el = document.getElementById(pickerId); if (!el) return;
  el.innerHTML = PT_COLORS.map(c =>
    `<button class="cl-col-btn${c.value===selected?' sel':''}" type="button"
      data-color="${c.value}"
      style="background:${c.value==='transparent'?'rgba(255,255,255,0.1)':c.value};${c.value==='transparent'?'border:2px dashed rgba(255,255,255,0.4)':''}"
      title="${c.label}"></button>`
  ).join('');
  el.querySelectorAll('.cl-col-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.color;
      if (pickerId === 'pt-color-picker') ptSelectColor(val);
      else impSelectColor(val);
    });
  });
  const sel = document.getElementById(selectedId);
  if (sel) {
    sel.dataset.color = selected;
    sel.style.background = selected==='transparent' ? 'rgba(255,255,255,0.1)' : selected;
  }
  // ポイントタブのヘッダープレビュー初期化
  if (pickerId === 'pt-color-picker') {
    const dot = document.getElementById('pt-color-preview-dot');
    if (dot) dot.style.background = selected==='transparent' ? 'rgba(255,255,255,0.2)' : selected;
  }
}
function ptSelectIcon(ic) {
  _curIcon = ic;
  document.querySelectorAll('#pt-icon-picker .cl-ico-btn').forEach(b => b.classList.toggle('sel', b.dataset.icon===ic));
  const sel = document.getElementById('pt-icon-selected');
  if (sel) { sel.dataset.icon = ic; sel.textContent = ic; }
  // ヘッダープレビュー同期
  const prev = document.getElementById('pt-icon-preview');
  if (prev) prev.textContent = ic;
  // 仮ピンをリアルタイム更新
  if (tPin) tPin.setIcon(_makeTempIcon(_curIcon, _curColor));
}
function ptSelectColor(val) {
  _curColor = val;
  document.querySelectorAll('#pt-color-picker .cl-col-btn').forEach(b => b.classList.toggle('sel', b.dataset.color===val));
  const sel = document.getElementById('pt-color-selected');
  if (sel) { sel.dataset.color = val; sel.style.background = val==='transparent' ? 'rgba(255,255,255,0.1)' : val; }
  // ヘッダープレビュー同期
  const dot = document.getElementById('pt-color-preview-dot');
  if (dot) dot.style.background = val==='transparent' ? 'rgba(255,255,255,0.2)' : val;
  // 仮ピンをリアルタイム更新
  if (tPin) tPin.setIcon(_makeTempIcon(_curIcon, _curColor));
}

// ── ヒートマップ協力トグル ────────────────────
const CONTRIB_KEY = 'gm_contrib';
function isContribOn() { return localStorage.getItem(CONTRIB_KEY)==='on'; }
function applyContribUI() {
  const btn = document.getElementById('contrib-toggle'); if (!btn) return;
  btn.classList.toggle('on', isContribOn());
}
function onContribToggle() { showDlg(isContribOn()?'dlg-contrib-off':'dlg-contrib-on'); }
function confirmContribOn() {
  localStorage.setItem(CONTRIB_KEY,'on'); applyContribUI(); closeOv();
  if (pts.length > 0) {
    let sent = 0;
    pts.forEach(p => {
      if (p.fsId) { sent++; if (sent===pts.length) showAlert('協力ありがとうございます', pts.length+'件の位置情報を送信しました。'); return; }
      submitCoord(p.lat, p.lng, p.stars||0)
        .then(fsId => { p.fsId=fsId; sent++; if (sent===pts.length) { savePts(); showAlert('協力ありがとうございます', pts.length+'件の位置情報を送信しました。'); } })
        .catch(e => { sent++; console.warn('[contrib] 送信失敗', e); });
    });
  } else {
    showAlert('協力ありがとうございます','次回のポイント保存から位置情報を送信します。');
  }
}
function confirmContribOff() { localStorage.setItem(CONTRIB_KEY,'off'); applyContribUI(); closeOv(); }

// ── マーカー生成 ─────────────────────────────
function _makeIcon(icon, color) {
  const bg = (!color||color==='transparent') ? 'rgba(200,160,32,0.2)' : color;
  const border = (!color||color==='transparent') ? '2px dashed rgba(200,160,32,0.7)' : '2px solid rgba(255,255,255,0.7)';
  return L.divIcon({
    html: `<div class="pt-marker" style="background:${bg};border:${border}"><span class="pt-marker-ico">${icon||'⛏'}</span></div>`,
    className: '', iconSize:[32,32], iconAnchor:[16,32]
  });
}
// 仮ピン用（波紋アニメーション付き）
function _makeTempIcon(icon, color) {
  const bg = (!color||color==='transparent') ? 'rgba(200,160,32,0.2)' : color;
  const border = (!color||color==='transparent') ? '2px dashed rgba(200,160,32,0.7)' : '2px solid rgba(255,255,255,0.7)';
  return L.divIcon({
    html: `<div class="pt-marker pt-marker-temp" style="background:${bg};border:${border}"><span class="pt-marker-ico">${icon||'⛏'}</span></div>`,
    className: '', iconSize:[32,32], iconAnchor:[16,32]
  });
}
function addMk(p) {
  const m = L.marker([p.lat,p.lng], {
    icon: _makeIcon(p.icon||PT_DEFAULT_ICON, p.color||PT_DEFAULT_COLOR),
    zIndexOffset:100, pane:'paneUser'
  });
  m.on('click', () => openDet(p.id));
  m.addTo(map); p.mk = m;
}
function _updateMk(p) {
  if (p.mk) p.mk.setIcon(_makeIcon(p.icon||PT_DEFAULT_ICON, p.color||PT_DEFAULT_COLOR));
}

// ── 地図長押しでポイント追加（1秒） ─────────────
(function initLongPress(){
  let _lpTimer=null, _lpRipple=null;
  function _clearLp(){ clearTimeout(_lpTimer); _lpTimer=null; if(_lpRipple){_lpRipple.remove();_lpRipple=null;} }
  function _startLp(x,y,latlng){
    if(addMode||(typeof drawMode!=='undefined'&&drawMode)) return;
    _lpRipple=document.createElement('div');
    _lpRipple.style.cssText=`position:fixed;left:${x-20}px;top:${y-20}px;width:40px;height:40px;border-radius:50%;border:2px solid rgba(200,170,80,0.8);animation:lpRipple 1s ease-out forwards;pointer-events:none;z-index:1001;`;
    document.body.appendChild(_lpRipple);
    _lpTimer=setTimeout(()=>{
      _clearLp(); addMode=true;
      tPin=L.marker([latlng.lat,latlng.lng],{icon:_makeTempIcon(_curIcon,_curColor),draggable:true,pane:'paneUser'}).addTo(map);
      document.getElementById('add-banner').classList.add('show');
    },1000);
  }
  const container=document.getElementById('map');
  container.addEventListener('touchstart',e=>{
    if(e.touches.length!==1) return;
    const t=e.touches[0];
    const ll=map.containerPointToLatLng(map.mouseEventToContainerPoint({clientX:t.clientX,clientY:t.clientY}));
    _startLp(t.clientX,t.clientY,ll);
  },{passive:true});
  container.addEventListener('touchend',   _clearLp,{passive:true});
  container.addEventListener('touchcancel',_clearLp,{passive:true});
  container.addEventListener('touchmove',  _clearLp,{passive:true});
})();

function updPtCnt(){
  document.getElementById('sb-pt').textContent='ポイント: '+pts.length+'件';
  const ttl=document.getElementById('pt-list-accordion-title');
  if(ttl) ttl.textContent='📋 マイポイント（'+pts.length+'件）';
  renderPtList();
}
function savePts(){
  try{localStorage.setItem('gm_pts',JSON.stringify(pts.map(p=>({
    id:p.id,lat:p.lat,lng:p.lng,name:p.name,memo:p.memo,
    stars:p.stars||0,icon:p.icon||PT_DEFAULT_ICON,
    color:p.color||PT_DEFAULT_COLOR,fsId:p.fsId||null
  }))));}catch(e){}
}
function loadPts(){
  try{
    const d=JSON.parse(localStorage.getItem('gm_pts')||'[]');
    d.forEach(p=>{if(p.id>=nid)nid=p.id+1;pts.push(p);addMk(p);});
    updPtCnt();
  }catch(e){}
  applyContribUI();
  if(typeof isPremiumUser==='function'){
    isPremiumUser().then(premium=>{
      const bar=document.getElementById('contrib-bar-wrap');
      if(bar) bar.style.display=premium?'':'none';
    });
  }
}
function renderPtList(){
  const el=document.getElementById('pt-list');
  if(!pts.length){
    el.innerHTML='<div class="cl-pt-empty">まだポイントがありません<br>「＋ ポイント追加」で地図上に登録できます</div>';
    return;
  }
  el.innerHTML=pts.map(p=>`
    <div class="cl-pt-row" onclick="jumpPt(${p.id})">
      <span class="cl-pt-icon" style="background:${(!p.color||p.color==='transparent')?'rgba(200,160,32,0.2)':p.color}">${p.icon||'⛏'}</span>
      <div class="cl-pt-info">
        <div class="cl-pt-name">${p.name||'（無名）'}${p.stars?`&nbsp;<span style="font-size:10px;color:var(--gold-lt)">${'★'.repeat(p.stars)}</span>`:''}</div>
        <div class="cl-pt-meta">📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.memo?` · ${p.memo.slice(0,20)}${p.memo.length>20?'…':''}`:''}</div>
      </div>
      <div class="cl-pt-row-btns" onclick="event.stopPropagation()">
        <button class="btn sm" onclick="ptListEdit(${p.id})" title="編集">✏️</button>
        <button class="btn sm red" onclick="ptListDel(${p.id})" title="削除">🗑</button>
      </div>
    </div>
  `).join('');
}
function jumpPt(id){
  const p=pts.find(q=>q.id===id);if(!p)return;
  switchTab('map');
  setTimeout(()=>{
    map.invalidateSize({pan:false});
    map.setView([p.lat,p.lng],15);
  },320);
}
function ptListEdit(id){
  did=id;
  editCur();
}
function ptListDel(id){
  did=id;
  reqDel();
}

// ── 追加モード ───────────────────────────────
let addMode=false,tPin=null;
function startAddPt(){
  if(addMode)return;
  if(typeof drawMode!=='undefined'&&drawMode) return;
  addMode=true;
  const c=gpsLL||map.getCenter();
  tPin=L.marker([c.lat,c.lng],{icon:_makeTempIcon(_curIcon,_curColor),draggable:true,pane:'paneUser'}).addTo(map);
  document.getElementById('add-banner').classList.add('show');
}
function cancelAdd(){
  // 編集モード中のキャンセル: 既存マーカーを復元
  if(eid!==null){
    const p=pts.find(q=>q.id===eid);
    if(p && p.mk){
      p.mk.setOpacity(1);
      p.mk.options.interactive=true;
      if(p.mk.getElement()) p.mk.getElement().style.pointerEvents='';
    }
    eid=null; _editBackup=null;
  }
  addMode=false;if(tPin){map.removeLayer(tPin);tPin=null;}
  document.getElementById('add-banner').classList.remove('show');
}
let eid=null;
// ── 追加ダイアログを開く ─────────────────────────────
function openAddDlg(){
  if(eid !== null && _editBackup){
    // 編集モード：_editBackupのデータをセット
    document.getElementById('dlg-edit-ttl').textContent='ポイントを編集';
    document.getElementById('pt-name').value=_editBackup.name;
    document.getElementById('pt-memo').value=_editBackup.memo||'';
    _curIcon=_editBackup.icon; _curColor=_editBackup.color;
    _renderStarUI(_editBackup.stars||0);
    _renderIconPicker(_curIcon,'pt-icon-picker','pt-icon-selected');
    _renderColorPicker(_curColor,'pt-color-picker','pt-color-selected');
    document.getElementById('pt-move-btn').style.display='';
  } else {
    // 新規モード
    eid=null;
    document.getElementById('dlg-edit-ttl').textContent='ポイントを追加';
    document.getElementById('pt-name').value='';
    document.getElementById('pt-memo').value='';
    _renderStarUI(0);
    _renderIconPicker(_curIcon,'pt-icon-picker','pt-icon-selected');
    _renderColorPicker(_curColor,'pt-color-picker','pt-color-selected');
    document.getElementById('pt-move-btn').style.display='none';
  }
  const ll = tPin ? tPin.getLatLng() : map.getCenter();
  _setCoordFields(ll.lat, ll.lng, true);
  showDlg('dlg-edit');
  if(tPin){ tPin.off('drag', _onAddPinDrag); tPin.on('drag', _onAddPinDrag); }
}
function _onAddPinDrag(){
  if(!tPin) return;
  const ll = tPin.getLatLng();
  _setCoordFields(ll.lat, ll.lng, true);
}
function _setCoordFields(lat, lng, readOnly){
  const fLat = document.getElementById('pt-lat');
  const fLng = document.getElementById('pt-lng');
  fLat.value = lat.toFixed(6);
  fLng.value = lng.toFixed(6);
  fLat.readOnly = !!readOnly;
  fLng.readOnly = !!readOnly;
}

function cancelEdit(){
  if(tPin){ map.removeLayer(tPin); tPin=null; }
  if(eid!==null && _editBackup){
    const p=pts.find(q=>q.id===eid);
    if(p && p.mk){
      p.mk.setOpacity(1);
      p.mk.options.interactive=true;
      if(p.mk.getElement()) p.mk.getElement().style.pointerEvents='';
    }
  }
  _editBackup=null;
  addMode=false;
  document.getElementById('add-banner').classList.remove('show');
  closeOv();
  if(eid===null) cancelAdd();
}

function reqSave(){
  const n=document.getElementById('pt-name').value.trim();if(!n){document.getElementById('pt-name').focus();return;}
  // 編集・新規ともtPinの位置を使用
  if(!tPin){showAlert('エラー','ピンが見つかりません');return;}
  const ll=tPin.getLatLng(); const lat=ll.lat, lng=ll.lng;
  const starsStr=_curStars?'★'.repeat(_curStars):'未評価';
  document.getElementById('save-msg').textContent=`「${n}」[${starsStr}] を\n緯度 ${lat.toFixed(5)}\n経度 ${lng.toFixed(5)}\nに保存しますか？`;
  showDlg('dlg-savecf');
}

async function confirmSave(){
  const n=document.getElementById('pt-name').value.trim(),m=document.getElementById('pt-memo').value.trim();
  if(eid!==null){
    const p=pts.find(q=>q.id===eid);
    // tPinの位置を座標として使用
    if(tPin){ const ll=tPin.getLatLng(); p.lat=ll.lat; p.lng=ll.lng; p.mk.setLatLng([ll.lat,ll.lng]); }
    p.name=n;p.memo=m;p.stars=_curStars;p.icon=_curIcon;p.color=_curColor;
    // tPin削除・既存マーカーを通常表示に戻す
    if(tPin){ map.removeLayer(tPin); tPin=null; }
    if(p.mk){
      p.mk.setOpacity(1);
      p.mk.options.interactive=true;
      if(p.mk.getElement()) p.mk.getElement().style.pointerEvents='';
    }
    _editBackup=null;
    addMode=false;
    document.getElementById('add-banner').classList.remove('show');
    _updateMk(p);
  }else{
    if(pts.length>=MAX_PT){showAlert('上限','最大1000件です');cancelAdd();closeOv();return;}
    if(pts.length>=FREE_POINT_LIMIT){
      const premium=await isPremiumUser();
      if(!premium){showPremiumGate('point_limit');return;}
    }
    const ll=tPin.getLatLng();
    const p={id:nid++,lat:ll.lat,lng:ll.lng,name:n,memo:m,stars:_curStars,icon:_curIcon,color:_curColor};
    pts.push(p);addMk(p);cancelAdd();
    if(isContribOn()){
      if(!navigator.onLine){
        showAlert('オフライン','ポイントはローカルに保存しましたが、ネットワーク未接続のためヒートマップへの投稿はスキップされました。\n次回オンライン時に再度「ヒートマップに協力」をONにすると送信できます。');
      }else{
        submitCoord(ll.lat,ll.lng,_curStars)
          .then(fsId=>{p.fsId=fsId;savePts();})
          .catch(e=>console.warn('[points] submitCoord失敗',e));
      }
    }
  }
  savePts();updPtCnt();closeOv();eid=null;
}

// ── 位置変更モード（編集時: 新規ルートに統一） ──────────────

function startEditMove(){
  if(!tPin) return;
  // ダイアログを閉じて地図画面へ（eid・tPin・_editBackupはそのまま保持）
  addMode=true;
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('dlg-edit').style.display = 'none';
  switchTab('map');
  setTimeout(()=>{
    map.invalidateSize({pan:false});
    map.setView(tPin.getLatLng(), Math.max(map.getZoom(), 15));
    tPin.dragging.enable();
    document.getElementById('add-banner').classList.add('show');
    if(typeof _pushHistory === 'function') _pushHistory();
  }, 320);
}

// ── 詳細・編集・削除 ─────────────────────────
let did=null;
function openDet(id){
  did=id;const p=pts.find(q=>q.id===id);
  document.getElementById('det-name').textContent=p.name||'（無名）';
  document.getElementById('det-stars').innerHTML=starsToHtml(p.stars||0);
  document.getElementById('det-memo').textContent=p.memo||'';
  document.getElementById('det-coord').textContent='📍 '+p.lat.toFixed(5)+', '+p.lng.toFixed(5);
  showDlg('dlg-detail');
}
// 編集時のバックアップ（キャンセル用）
let _editBackup = null;

function editCur(){
  const p=pts.find(q=>q.id===did); if(!p) return;
  eid=did;

  // 元データをバックアップ
  _editBackup={lat:p.lat,lng:p.lng,name:p.name,memo:p.memo||'',
    stars:p.stars||0,icon:p.icon||PT_DEFAULT_ICON,color:p.color||PT_DEFAULT_COLOR};

  // 既存マーカーを薄く＋非インタラクティブにしてtPinへのタッチを通す
  if(p.mk){ p.mk.setOpacity(0.3); p.mk.options.interactive=false; p.mk.getElement()&&(p.mk.getElement().style.pointerEvents='none'); }

  // 新規追加と同じtPinを既存位置に配置
  _curIcon=p.icon||PT_DEFAULT_ICON; _curColor=p.color||PT_DEFAULT_COLOR;
  if(tPin){ map.removeLayer(tPin); tPin=null; }
  tPin=L.marker([p.lat,p.lng],{icon:_makeTempIcon(_curIcon,_curColor),draggable:true,pane:'paneUser'}).addTo(map);
  tPin.off('drag', _onAddPinDrag); tPin.on('drag', _onAddPinDrag);

  // ダイアログに既存情報をセット
  document.getElementById('dlg-edit-ttl').textContent='ポイントを編集';
  document.getElementById('pt-name').value=p.name;
  document.getElementById('pt-memo').value=p.memo||'';
  _renderStarUI(p.stars||0);
  _renderIconPicker(_curIcon,'pt-icon-picker','pt-icon-selected');
  _renderColorPicker(_curColor,'pt-color-picker','pt-color-selected');
  _setCoordFields(p.lat,p.lng,true);
  document.getElementById('pt-move-btn').style.display='';
  showDlg('dlg-edit');
}
function reqDel(){
  document.getElementById('del-msg').textContent=`「${pts.find(p=>p.id===did)?.name||'このポイント'}」を削除しますか？`;
  showDlg('dlg-del');
}
async function confirmDel(){
  const i=pts.findIndex(p=>p.id===did);
  if(i!==-1){
    const p=pts[i];map.removeLayer(p.mk);
    if(p.fsId) deleteCoord(p.fsId).catch(e=>console.warn('[points] deleteCoord失敗',e));
    pts.splice(i,1);
  }
  savePts();updPtCnt();closeOv();
  if(heatTier==='premium'){
    const postCount=await getUserPostCount();
    if(postCount<1){_heatAllOff();showPremiumGate('heatmap_pro_revoked');}
  }
}

// ── エクスポート ──────────────────────────────
function exportPts(){
  const fc={type:'FeatureCollection',features:pts.map(p=>({
    type:'Feature',
    geometry:{type:'Point',coordinates:[p.lng,p.lat]},
    properties:{name:p.name,memo:p.memo,stars:p.stars||0,icon:p.icon,color:p.color}
  }))};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}));
  a.download='goldmap.geojson';a.click();
}

// ── 読込ダイアログ（GeoJSON → pts に直接追加） ────────────────────────────
let _impFileData = null;
let _curImpIcon  = '📥';
let _curImpColor = '#c8a020';

function openImpDlg(){
  _impFileData = null;
  document.getElementById('imp2-file-name').textContent = 'ファイル未選択';
  document.getElementById('imp2-count').textContent = '';
  _curImpIcon  = PT_DEFAULT_ICON;
  _curImpColor = PT_DEFAULT_COLOR;
  _renderIconPicker(_curImpIcon,  'imp2-icon-picker',  'imp2-icon-selected');
  _renderColorPicker(_curImpColor,'imp2-color-picker', 'imp2-color-selected');
  showDlg('dlg-imp2');
}
function impSelectIcon(ic){
  _curImpIcon = ic;
  document.querySelectorAll('#imp2-icon-picker .cl-ico-btn').forEach(b=>b.classList.toggle('sel',b.dataset.icon===ic));
  const sel = document.getElementById('imp2-icon-selected');
  if(sel){ sel.dataset.icon = ic; sel.textContent = ic; }
}
function impSelectColor(val){
  _curImpColor = val;
  document.querySelectorAll('#imp2-color-picker .cl-col-btn').forEach(b=>b.classList.toggle('sel',b.dataset.color===val));
  const sel = document.getElementById('imp2-color-selected');
  if(sel){ sel.dataset.color = val; sel.style.background = val==='transparent'?'rgba(255,255,255,0.1)':val; }
}
function imp2SelectFile(){ document.getElementById('impf2').click(); }
function imp2OnFile(ev){
  const f = ev.target.files[0]; ev.target.value = ''; if(!f) return;
  const r = new FileReader();
  r.onload = e => {
    try{
      const j = JSON.parse(e.target.result);
      if(j.type !== 'FeatureCollection') throw 0;
      const v = j.features.filter(f =>
        f.type==='Feature' && f.geometry?.type==='Point' &&
        typeof f.geometry.coordinates[0]==='number'
      );
      _impFileData = v;
      document.getElementById('imp2-file-name').textContent = f.name;
      document.getElementById('imp2-count').textContent = v.length + '件のポイントが見つかりました';
    }catch{ showAlert('エラー','有効なGeoJSONではありません'); }
  };
  r.readAsText(f);
}
async function confirmImp2(){
  if(!_impFileData || _impFileData.length===0){ showAlert('エラー','ファイルを選択してください'); return; }
  if(pts.length >= MAX_PT){ showAlert('上限','最大1000件です'); return; }

  const premium = await isPremiumUser();
  let added = 0;
  for(const f of _impFileData){
    if(pts.length >= MAX_PT) break;
    if(pts.length >= FREE_POINT_LIMIT && !premium){
      showPremiumGate('point_limit'); return;
    }
    const p = {
      id:    nid++,
      lat:   f.geometry.coordinates[1],
      lng:   f.geometry.coordinates[0],
      name:  f.properties?.name || '',
      memo:  f.properties?.memo || f.properties?.note || '',
      stars: 0,
      icon:  _curImpIcon,
      color: _curImpColor,
    };
    pts.push(p); addMk(p); added++;
  }
  savePts(); updPtCnt();
  _impFileData = null; closeOv();
  showAlert('完了', `${added}件のポイントを追加しました`);
}