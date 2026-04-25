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
    `<button class="cl-ico-btn${ic===selected?' sel':''}" onclick="${pickerId==='pt-icon-picker'?'ptSelectIcon':'impSelectIcon'}('${ic}')" data-icon="${ic}">${ic}</button>`
  ).join('');
  const sel = document.getElementById(selectedId);
  if (sel) { sel.dataset.icon = selected; sel.textContent = selected; }
}
function _renderColorPicker(selected, pickerId, selectedId) {
  const el = document.getElementById(pickerId); if (!el) return;
  el.innerHTML = PT_COLORS.map(c =>
    `<button class="cl-col-btn${c.value===selected?' sel':''}"
      onclick="${pickerId==='pt-color-picker'?'ptSelectColor':'impSelectColor'}('${c.value}')"
      data-color="${c.value}"
      style="background:${c.value==='transparent'?'rgba(255,255,255,0.1)':c.value};${c.value==='transparent'?'border:2px dashed rgba(255,255,255,0.4)':''}"
      title="${c.label}"></button>`
  ).join('');
  const sel = document.getElementById(selectedId);
  if (sel) {
    sel.dataset.color = selected;
    sel.style.background = selected==='transparent' ? 'rgba(255,255,255,0.1)' : selected;
  }
}
function ptSelectIcon(ic) {
  _curIcon = ic;
  document.querySelectorAll('#pt-icon-picker .cl-ico-btn').forEach(b => b.classList.toggle('sel', b.dataset.icon===ic));
  const sel = document.getElementById('pt-icon-selected');
  if (sel) { sel.dataset.icon = ic; sel.textContent = ic; }
}
function ptSelectColor(val) {
  _curColor = val;
  document.querySelectorAll('#pt-color-picker .cl-col-btn').forEach(b => b.classList.toggle('sel', b.dataset.color===val));
  const sel = document.getElementById('pt-color-selected');
  if (sel) { sel.dataset.color = val; sel.style.background = val==='transparent' ? 'rgba(255,255,255,0.1)' : val; }
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
function _makeIcon(icon, color, dragging) {
  const bg = (!color||color==='transparent') ? 'rgba(200,160,32,0.2)' : color;
  const border = (!color||color==='transparent') ? '2px dashed rgba(200,160,32,0.7)' : '2px solid rgba(255,255,255,0.7)';
  const cls = dragging ? 'pt-marker pt-marker--dragging' : 'pt-marker';
  return L.divIcon({
    html: `<div class="${cls}" style="background:${bg};border:${border}">${icon||'⛏'}</div>`,
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
      tPin=L.marker([latlng.lat,latlng.lng],{icon:_makeIcon(PT_DEFAULT_ICON,PT_DEFAULT_COLOR,true),draggable:true,pane:'paneUser'}).addTo(map);
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
  _loadImportPts();
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
    el.innerHTML='<div class="pt-empty">まだポイントがありません<br>「＋ ポイント追加」で地図上に登録できます</div>';
    return;
  }
  el.innerHTML=pts.map(p=>`
    <div class="pt-row" onclick="jumpPt(${p.id})">
      <div class="pt-row-ico" style="background:${(!p.color||p.color==='transparent')?'rgba(200,160,32,0.2)':p.color}">${p.icon||'⛏'}</div>
      <div class="pt-row-body">
        <div class="pt-row-name">${p.name||'（無名）'}${p.stars?` <span style="font-size:11px;color:var(--gold-lt)">${'★'.repeat(p.stars)}</span>`:''}</div>
        <div class="pt-row-coord">📍 ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        ${p.memo?`<div class="pt-row-memo">${p.memo}</div>`:''}
      </div>
    </div>
  `).join('');
}
function jumpPt(id){
  const p=pts.find(q=>q.id===id);if(!p)return;
  switchTab('map');map.setView([p.lat,p.lng],15);
  setTimeout(()=>openDet(id),400);
}

// ── 追加モード ───────────────────────────────
let addMode=false,tPin=null;
function startAddPt(){
  if(addMode)return;
  if(typeof drawMode!=='undefined'&&drawMode) return;
  addMode=true;
  const c=gpsLL||map.getCenter();
  tPin=L.marker([c.lat,c.lng],{icon:_makeIcon(PT_DEFAULT_ICON,PT_DEFAULT_COLOR,true),draggable:true,pane:'paneUser'}).addTo(map);
  document.getElementById('add-banner').classList.add('show');
}
function cancelAdd(){
  addMode=false;if(tPin){map.removeLayer(tPin);tPin=null;}
  document.getElementById('add-banner').classList.remove('show');
}
let eid=null;
function openAddDlg(){
  eid=null;
  document.getElementById('dlg-edit-ttl').textContent='ポイントを追加';
  document.getElementById('pt-name').value='';
  document.getElementById('pt-memo').value='';
  _renderStarUI(0);
  _curIcon=PT_DEFAULT_ICON; _curColor=PT_DEFAULT_COLOR;
  _renderIconPicker(_curIcon,'pt-icon-picker','pt-icon-selected');
  _renderColorPicker(_curColor,'pt-color-picker','pt-color-selected');
  showDlg('dlg-edit');
}
function cancelEdit(){closeOv();if(eid===null)cancelAdd();}
function reqSave(){
  const n=document.getElementById('pt-name').value.trim();if(!n){document.getElementById('pt-name').focus();return;}
  const p=eid!==null?pts.find(q=>q.id===eid):null;
  const lat=p?p.lat:tPin.getLatLng().lat,lng=p?p.lng:tPin.getLatLng().lng;
  const starsStr=_curStars?'★'.repeat(_curStars):'未評価';
  document.getElementById('save-msg').textContent=`「${n}」[${starsStr}] を\n緯度 ${lat.toFixed(5)}\n経度 ${lng.toFixed(5)}\nに保存しますか？`;
  showDlg('dlg-savecf');
}
async function confirmSave(){
  const n=document.getElementById('pt-name').value.trim(),m=document.getElementById('pt-memo').value.trim();
  if(eid!==null){
    const p=pts.find(q=>q.id===eid);
    p.name=n;p.memo=m;p.stars=_curStars;p.icon=_curIcon;p.color=_curColor;
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
function editCur(){
  const p=pts.find(q=>q.id===did);eid=did;
  document.getElementById('dlg-edit-ttl').textContent='ポイントを編集';
  document.getElementById('pt-name').value=p.name;
  document.getElementById('pt-memo').value=p.memo||'';
  _renderStarUI(p.stars||0);
  _curIcon=p.icon||PT_DEFAULT_ICON;_curColor=p.color||PT_DEFAULT_COLOR;
  _renderIconPicker(_curIcon,'pt-icon-picker','pt-icon-selected');
  _renderColorPicker(_curColor,'pt-color-picker','pt-color-selected');
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

// ════════════════════════════════════════════════
// 読込ポイント別管理（gm_pts_import）
// ════════════════════════════════════════════════
const IMP_STORAGE_KEY='gm_pts_import';
let _impSets=[];
let _impNid=1;

function _saveImportPts(){
  try{
    localStorage.setItem(IMP_STORAGE_KEY,JSON.stringify(
      _impSets.map(s=>({
        id:s.id,name:s.name,icon:s.icon,color:s.color,
        points:s.points.map(p=>({lat:p.lat,lng:p.lng,name:p.name,note:p.note}))
      }))
    ));
  }catch(e){}
}
function _loadImportPts(){
  try{
    const d=JSON.parse(localStorage.getItem(IMP_STORAGE_KEY)||'[]');
    d.forEach(s=>{
      if(s.id>=_impNid) _impNid=s.id+1;
      s.points=s.points||[];
      s.points.forEach(p=>_addImpMk(p,s));
      _impSets.push(s);
    });
  }catch(e){}
  _renderImpList();
}
function _addImpMk(p,set){
  const bg=(!set.color||set.color==='transparent')?'rgba(100,180,255,0.25)':set.color;
  const border=(!set.color||set.color==='transparent')?'2px dashed rgba(100,180,255,0.6)':'2px solid rgba(255,255,255,0.5)';
  const ico=L.divIcon({
    html:`<div class="pt-marker pt-marker-imp" style="background:${bg};border:${border}">${set.icon||'📥'}</div>`,
    className:'',iconSize:[28,28],iconAnchor:[14,28]
  });
  const mk=L.marker([p.lat,p.lng],{icon:ico,zIndexOffset:50,pane:'paneUser'});
  mk.bindPopup(`<div style="font-size:13px;font-weight:bold">${set.icon||'📥'} ${p.name||'（無名）'}</div>${p.note?`<div style="font-size:11px;color:#aaa;margin-top:4px">${p.note}</div>`:''}`);
  mk.addTo(map);p.mk=mk;
}

// ── 読込ダイアログ ────────────────────────────
let _impFileData=null;
let _curImpIcon='📥';
let _curImpColor='#3498db';

function openImpDlg(){
  document.getElementById('imp2-set-name').value='';
  _impFileData=null;
  document.getElementById('imp2-file-name').textContent='ファイル未選択';
  document.getElementById('imp2-count').textContent='';
  _curImpIcon='📥';_curImpColor='#3498db';
  _renderIconPicker(_curImpIcon,'imp2-icon-picker','imp2-icon-selected');
  _renderColorPicker(_curImpColor,'imp2-color-picker','imp2-color-selected');
  showDlg('dlg-imp2');
}
function impSelectIcon(ic){
  _curImpIcon=ic;
  document.querySelectorAll('#imp2-icon-picker .cl-ico-btn').forEach(b=>b.classList.toggle('sel',b.dataset.icon===ic));
  const sel=document.getElementById('imp2-icon-selected');
  if(sel){sel.dataset.icon=ic;sel.textContent=ic;}
}
function impSelectColor(val){
  _curImpColor=val;
  document.querySelectorAll('#imp2-color-picker .cl-col-btn').forEach(b=>b.classList.toggle('sel',b.dataset.color===val));
  const sel=document.getElementById('imp2-color-selected');
  if(sel){sel.dataset.color=val;sel.style.background=val==='transparent'?'rgba(255,255,255,0.1)':val;}
}
function imp2SelectFile(){ document.getElementById('impf2').click(); }
function imp2OnFile(ev){
  const f=ev.target.files[0];ev.target.value='';if(!f)return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const j=JSON.parse(e.target.result);
      if(j.type!=='FeatureCollection') throw 0;
      const v=j.features.filter(f=>f.type==='Feature'&&f.geometry?.type==='Point'&&typeof f.geometry.coordinates[0]==='number');
      _impFileData=v;
      document.getElementById('imp2-file-name').textContent=f.name;
      document.getElementById('imp2-count').textContent=v.length+'件のポイントが見つかりました';
    }catch{showAlert('エラー','有効なGeoJSONではありません');}
  };
  r.readAsText(f);
}
function confirmImp2(){
  if(!_impFileData||_impFileData.length===0){showAlert('エラー','ファイルを選択してください');return;}
  const name=document.getElementById('imp2-set-name').value.trim()||'読込データ';
  const set={
    id:_impNid++,name,icon:_curImpIcon,color:_curImpColor,
    points:_impFileData.map(f=>({
      lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],
      name:f.properties?.name||'',note:f.properties?.memo||f.properties?.note||''
    }))
  };
  set.points.forEach(p=>_addImpMk(p,set));
  _impSets.push(set);_saveImportPts();_renderImpList();
  _impFileData=null;closeOv();
  showAlert('完了',`「${name}」として${set.points.length}件を読み込みました`);
}
function _renderImpList(){
  const el=document.getElementById('imp-set-list');if(!el)return;
  const ttl=document.getElementById('imp-list-accordion-title');
  const total=_impSets.reduce((s,x)=>s+x.points.length,0);
  if(ttl) ttl.textContent=`📥 読込ポイント（${total}件）`;
  // フロートボタンをデータ有無に応じて表示/非表示
  const btn=document.getElementById('btn-custom-layer');
  if(btn) btn.style.display=_impSets.length?'':'none';
  if(!_impSets.length){
    el.innerHTML='<div class="pt-empty">読込ポイントはありません<br>「📥 読込」でGeoJSONを追加できます</div>';
    return;
  }
  el.innerHTML=_impSets.map(s=>`
    <div class="imp-set-row">
      <div class="imp-set-header">
        <div class="imp-set-icon" style="background:${(!s.color||s.color==='transparent')?'rgba(100,180,255,0.2)':s.color}">${s.icon||'📥'}</div>
        <div class="imp-set-info">
          <div class="imp-set-name">${s.name}</div>
          <div class="imp-set-count">${s.points.length}件</div>
        </div>
        <button class="imp-set-del" onclick="reqDelImpSet(${s.id})">🗑</button>
      </div>
    </div>
  `).join('');
}

// ── マイMAP一括表示/非表示 ──────────────────
let _clMapVisible=true;
function toggleClMapVisible(){
  _clMapVisible=!_clMapVisible;
  _impSets.forEach(s=>s.points.forEach(p=>{
    if(!p.mk) return;
    if(_clMapVisible) p.mk.addTo(map);
    else map.removeLayer(p.mk);
  }));
  const btn=document.getElementById('btn-custom-layer');
  if(btn) btn.classList.toggle('active',_clMapVisible);
}
function reqDelImpSet(setId){
  const s=_impSets.find(x=>x.id===setId);if(!s)return;
  if(!confirm(`「${s.name}」（${s.points.length}件）を削除しますか？`))return;
  s.points.forEach(p=>{if(p.mk)map.removeLayer(p.mk);});
  _impSets=_impSets.filter(x=>x.id!==setId);
  _saveImportPts();_renderImpList();
}
