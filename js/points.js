'use strict';
//  ユーザーポイント
// ═══════════════════════════════════════════
const MAX_PT=1000; let pts=[],nid=1;

// ── ヒートマップ協力トグル ────────────────────────────
const CONTRIB_KEY = 'gm_contrib';

function isContribOn(){
  return localStorage.getItem(CONTRIB_KEY) === 'on';
}

function applyContribUI(){
  const btn = document.getElementById('contrib-toggle');
  if(!btn) return;
  if(isContribOn()){
    btn.classList.add('on');
  } else {
    btn.classList.remove('on');
  }
}

function onContribToggle(){
  if(isContribOn()){
    // ON→OFF: 停止確認ダイアログ
    showDlg('dlg-contrib-off');
  } else {
    // OFF→ON: 同意ダイアログ
    showDlg('dlg-contrib-on');
  }
}

function confirmContribOn(){
  localStorage.setItem(CONTRIB_KEY, 'on');
  applyContribUI();
  closeOv();
  // 既存ポイントを一括送信
  if(pts.length > 0){
    let sent = 0;
    pts.forEach(p => {
      if(p.fsId){ sent++; if(sent===pts.length) showAlert('協力ありがとうございます', pts.length+'件の位置情報を送信しました。'); return; }
      submitCoord(p.lat, p.lng)
        .then(fsId=>{ p.fsId=fsId; sent++; if(sent===pts.length){ savePts(); showAlert('協力ありがとうございます', pts.length+'件の位置情報を送信しました。'); } })
        .catch(e => { sent++; console.warn('[contrib] 送信失敗', e); });
    });
  } else {
    showAlert('協力ありがとうございます', '次回のポイント保存から位置情報を送信します。');
  }
}

function confirmContribOff(){
  localStorage.setItem(CONTRIB_KEY, 'off');
  applyContribUI();
  closeOv();
}
// ────────────────────────────────────────────
const uIco=()=>L.divIcon({html:'<div class="upin"></div>',className:'',iconSize:[18,22],iconAnchor:[9,22]});
function addMk(p){
  const m=L.marker([p.lat,p.lng],{icon:uIco(),zIndexOffset:100,pane:'paneUser'});
  m.on('click',()=>openDet(p.id)); m.addTo(map); p.mk=m;
}
function updPtCnt(){
  document.getElementById('sb-pt').textContent='ポイント: '+pts.length+'件';
  renderPtList();
}
function savePts(){
  try{localStorage.setItem('gm_pts',JSON.stringify(pts.map(p=>({id:p.id,lat:p.lat,lng:p.lng,name:p.name,memo:p.memo}))));}catch(e){}
}
function loadPts(){
  try{
    const d=JSON.parse(localStorage.getItem('gm_pts')||'[]');
    d.forEach(p=>{if(p.id>=nid)nid=p.id+1; pts.push(p); addMk(p);});
    updPtCnt();
  }catch(e){}
  applyContribUI();
}

function renderPtList(){
  const el=document.getElementById('pt-list');
  if(!pts.length){
    el.innerHTML='<div class="pt-empty">まだポイントがありません<br>「＋ ポイント追加」で地図上に登録できます</div>';
    return;
  }
  el.innerHTML=pts.map(p=>`
    <div class="pt-row" onclick="jumpPt(${p.id})">
      <div class="pt-row-ico">⛏</div>
      <div class="pt-row-body">
        <div class="pt-row-name">${p.name||'（無名）'}</div>
        <div class="pt-row-coord">📍 ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        ${p.memo?`<div class="pt-row-memo">${p.memo}</div>`:''}
      </div>
    </div>
  `).join('');
}

function jumpPt(id){
  const p=pts.find(q=>q.id===id); if(!p)return;
  switchTab('map');
  map.setView([p.lat,p.lng],15);
  setTimeout(()=>openDet(id),400);
}

let addMode=false,tPin=null;
function startAddPt(){
  if(addMode)return; addMode=true;
  const c=gpsLL||map.getCenter();
  tPin=L.marker([c.lat,c.lng],{icon:uIco(),draggable:true,pane:'paneUser'}).addTo(map);
  document.getElementById('add-banner').classList.add('show');
}
function cancelAdd(){
  addMode=false;
  if(tPin){map.removeLayer(tPin);tPin=null;}
  document.getElementById('add-banner').classList.remove('show');
}
let eid=null;
function openAddDlg(){
  eid=null;
  document.getElementById('dlg-edit-ttl').textContent='ポイントを追加';
  document.getElementById('pt-name').value='';
  document.getElementById('pt-memo').value='';
  showDlg('dlg-edit');
}
function cancelEdit(){closeOv(); if(eid===null)cancelAdd();}
function reqSave(){
  const n=document.getElementById('pt-name').value.trim(); if(!n){document.getElementById('pt-name').focus();return;}
  const p=eid!==null?pts.find(q=>q.id===eid):null;
  const lat=p?p.lat:tPin.getLatLng().lat, lng=p?p.lng:tPin.getLatLng().lng;
  document.getElementById('save-msg').textContent=`「${n}」を\n緯度 ${lat.toFixed(5)}\n経度 ${lng.toFixed(5)}\nに保存しますか？`;
  showDlg('dlg-savecf');
}
function confirmSave(){
  const n=document.getElementById('pt-name').value.trim(),m=document.getElementById('pt-memo').value.trim();
  if(eid!==null){const p=pts.find(q=>q.id===eid);p.name=n;p.memo=m;}
  else{
    if(pts.length>=MAX_PT){showAlert('上限','最大1000件です');cancelAdd();closeOv();return;}
    const ll=tPin.getLatLng(),p={id:nid++,lat:ll.lat,lng:ll.lng,name:n,memo:m};
    pts.push(p);addMk(p);cancelAdd();
    if(isContribOn()){
      submitCoord(ll.lat, ll.lng)
        .then(fsId=>{ p.fsId=fsId; savePts(); })
        .catch(e=>console.warn('[points] submitCoord失敗', e));
    }
  }
  savePts();updPtCnt();closeOv();eid=null;
}
let did=null;
function openDet(id){
  did=id; const p=pts.find(q=>q.id===id);
  document.getElementById('det-name').textContent=p.name||'（無名）';
  document.getElementById('det-memo').textContent=p.memo||'';
  document.getElementById('det-coord').textContent='📍 '+p.lat.toFixed(5)+', '+p.lng.toFixed(5);
  showDlg('dlg-detail');
}
function editCur(){
  const p=pts.find(q=>q.id===did); eid=did;
  document.getElementById('dlg-edit-ttl').textContent='ポイントを編集';
  document.getElementById('pt-name').value=p.name;
  document.getElementById('pt-memo').value=p.memo;
  showDlg('dlg-edit');
}
function reqDel(){
  document.getElementById('del-msg').textContent=`「${pts.find(p=>p.id===did)?.name||'このポイント'}」を削除しますか？`;
  showDlg('dlg-del');
}
function confirmDel(){
  const i=pts.findIndex(p=>p.id===did);
  if(i!==-1){
    const p=pts[i];
    map.removeLayer(p.mk);
    // 協力ON かつ fsId があればFirestoreからも削除
    if(isContribOn() && p.fsId){
      deleteCoord(p.fsId).catch(e=>console.warn('[points] deleteCoord失敗', e));
    }
    pts.splice(i,1);
  }
  savePts();updPtCnt();closeOv();
}
function exportPts(){
  const fc={type:'FeatureCollection',features:pts.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{name:p.name,memo:p.memo}}))};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}));
  a.download='goldmap.geojson'; a.click();
}
let impD=null;
function importPts(ev){
  const f=ev.target.files[0]; ev.target.value=''; if(!f)return;
  const r=new FileReader(); r.onload=e=>{
    try{
      const j=JSON.parse(e.target.result);
      if(j.type!=='FeatureCollection')throw 0;
      const v=j.features.filter(f=>f.type==='Feature'&&f.geometry?.type==='Point'&&typeof f.geometry.coordinates[0]==='number');
      impD=v;
      document.getElementById('imp-msg').textContent=v.length+'件のポイントが見つかりました。追加または上書きを選択してください。';
      showDlg('dlg-imp');
    }catch{showAlert('エラー','有効なGeoJSONではありません');}
  }; r.readAsText(f);
}
function doImport(mode){
  if(!impD)return;
  if(mode==='over'){pts.forEach(p=>map.removeLayer(p.mk));pts=[];nid=1;}
  let add=0,sk=0;
  impD.forEach(f=>{
    const[lng,lat]=f.geometry.coordinates;
    if(pts.some(p=>p.lat===lat&&p.lng===lng)){sk++;return;}
    if(pts.length>=MAX_PT){sk++;return;}
    const p={id:nid++,lat,lng,name:f.properties?.name||'',memo:f.properties?.memo||''};
    pts.push(p);addMk(p);add++;
  });
  savePts();updPtCnt();impD=null;closeOv();
  showAlert('完了',add+'件追加、'+sk+'件スキップ');
}

// ═══════════════════════════════════════════
