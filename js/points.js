'use strict';
//  ユーザーポイント
// ═══════════════════════════════════════════
const MAX_PT=1000; let pts=[],nid=1;

// ── ★評価ヘルパー ────────────────────────────
let _curStars = 0;

function setStarRating(v){
  _curStars = (_curStars === v) ? 0 : v;
  _renderStarUI(_curStars);
}
function _renderStarUI(v){
  document.querySelectorAll('.star-btn').forEach((b,i)=>{
    b.classList.toggle('active', i < v);
  });
  const labels = ['未評価','★ もう少し','★★ 良い','★★★ 最高'];
  const el = document.getElementById('star-label');
  if(el) el.textContent = labels[v] || '未評価';
  _curStars = v;
}
function starsToHtml(v){
  if(!v) return '';
  return `<span style="color:var(--gold-lt)">${'★'.repeat(v)}</span><span style="color:rgba(200,170,80,0.3)">${'☆'.repeat(3-v)}</span>`;
}

// ── ヒートマップ協力トグル ────────────────────────────
const CONTRIB_KEY = 'gm_contrib';
function isContribOn(){ return localStorage.getItem(CONTRIB_KEY)==='on'; }
function applyContribUI(){
  const btn=document.getElementById('contrib-toggle'); if(!btn)return;
  btn.classList.toggle('on', isContribOn());
}
function onContribToggle(){
  showDlg(isContribOn()?'dlg-contrib-off':'dlg-contrib-on');
}
function confirmContribOn(){
  localStorage.setItem(CONTRIB_KEY,'on'); applyContribUI(); closeOv();
  if(pts.length>0){
    let sent=0;
    pts.forEach(p=>{
      if(p.fsId){sent++;if(sent===pts.length)showAlert('協力ありがとうございます',pts.length+'件の位置情報を送信しました。');return;}
      submitCoord(p.lat,p.lng,p.stars||0)
        .then(fsId=>{p.fsId=fsId;sent++;if(sent===pts.length){savePts();showAlert('協力ありがとうございます',pts.length+'件の位置情報を送信しました。');}})
        .catch(e=>{sent++;console.warn('[contrib] 送信失敗',e);});
    });
  } else {
    showAlert('協力ありがとうございます','次回のポイント保存から位置情報を送信します。');
  }
}
function confirmContribOff(){
  localStorage.setItem(CONTRIB_KEY,'off'); applyContribUI(); closeOv();
}

// ── マーカー ─────────────────────────────────
const uIco=()=>L.divIcon({html:'<div class="upin"></div>',className:'',iconSize:[18,22],iconAnchor:[9,22]});
function addMk(p){
  const m=L.marker([p.lat,p.lng],{icon:uIco(),zIndexOffset:100,pane:'paneUser'});
  m.on('click',()=>openDet(p.id)); m.addTo(map); p.mk=m;
}

// ── 地図長押しでポイント追加（1秒） ─────────────────
(function initLongPress(){
  let _lpTimer=null, _lpStartLL=null, _lpRipple=null;

  function _clearLp(){
    clearTimeout(_lpTimer); _lpTimer=null;
    if(_lpRipple){map.getPane('paneUser').removeChild(_lpRipple);_lpRipple=null;}
  }

  function _startLp(latlng){
    if(addMode) return;
    _lpStartLL = latlng;
    // リップルエフェクト表示
    const px = map.latLngToContainerPoint(latlng);
    _lpRipple = document.createElement('div');
    _lpRipple.style.cssText=`position:absolute;left:${px.x-20}px;top:${px.y-20}px;width:40px;height:40px;border-radius:50%;border:2px solid rgba(200,170,80,0.8);animation:lpRipple 1s ease-out forwards;pointer-events:none;`;
    map.getPane('paneUser').appendChild(_lpRipple);
    _lpTimer = setTimeout(()=>{
      _clearLp();
      // 長押し成功 → ピンをその位置に置いてドラッグモードへ
      addMode=true;
      tPin=L.marker([latlng.lat,latlng.lng],{icon:uIco(),draggable:true,pane:'paneUser'}).addTo(map);
      document.getElementById('add-banner').classList.add('show');
    }, 1000);
  }

  map.on('mousedown touchstart', e=>{
    const ll = e.latlng || (e.touches && map.mouseEventToLatLng(e.touches[0]));
    if(ll) _startLp(ll);
  });
  map.on('mouseup mousemove touchend touchcancel', _clearLp);
})();
function updPtCnt(){
  document.getElementById('sb-pt').textContent='ポイント: '+pts.length+'件';
  renderPtList();
}
function savePts(){
  try{localStorage.setItem('gm_pts',JSON.stringify(pts.map(p=>({
    id:p.id,lat:p.lat,lng:p.lng,name:p.name,memo:p.memo,
    stars:p.stars||0,fsId:p.fsId||null
  }))));}catch(e){}
}
function loadPts(){
  try{
    const d=JSON.parse(localStorage.getItem('gm_pts')||'[]');
    d.forEach(p=>{if(p.id>=nid)nid=p.id+1;pts.push(p);addMk(p);});
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
        <div class="pt-row-name">${p.name||'（無名）'}${p.stars?` <span style="font-size:11px;color:var(--gold-lt)">${'★'.repeat(p.stars)}</span>`:''}</div>
        <div class="pt-row-coord">📍 ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        ${p.memo?`<div class="pt-row-memo">${p.memo}</div>`:''}
      </div>
    </div>
  `).join('');
}
function jumpPt(id){
  const p=pts.find(q=>q.id===id);if(!p)return;
  switchTab('map'); map.setView([p.lat,p.lng],15);
  setTimeout(()=>openDet(id),400);
}

// ── 追加モード ───────────────────────────────
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
  _renderStarUI(0);
  showDlg('dlg-edit');
}
function cancelEdit(){closeOv();if(eid===null)cancelAdd();}
function reqSave(){
  const n=document.getElementById('pt-name').value.trim();if(!n){document.getElementById('pt-name').focus();return;}
  const p=eid!==null?pts.find(q=>q.id===eid):null;
  const lat=p?p.lat:tPin.getLatLng().lat, lng=p?p.lng:tPin.getLatLng().lng;
  const starsStr=_curStars?'★'.repeat(_curStars):'未評価';
  document.getElementById('save-msg').textContent=`「${n}」[${starsStr}] を\n緯度 ${lat.toFixed(5)}\n経度 ${lng.toFixed(5)}\nに保存しますか？`;
  showDlg('dlg-savecf');
}
async function confirmSave(){
  const n=document.getElementById('pt-name').value.trim(),m=document.getElementById('pt-memo').value.trim();
  if(eid!==null){
    const p=pts.find(q=>q.id===eid);p.name=n;p.memo=m;p.stars=_curStars;
  } else {
    if(pts.length>=MAX_PT){showAlert('上限','最大1000件です');cancelAdd();closeOv();return;}
    if(pts.length>=FREE_POINT_LIMIT){
      const premium=await isPremiumUser();
      if(!premium){showPremiumGate('point_limit');return;}
    }
    const ll=tPin.getLatLng(),p={id:nid++,lat:ll.lat,lng:ll.lng,name:n,memo:m,stars:_curStars};
    pts.push(p);addMk(p);cancelAdd();
    if(isContribOn()){
      // オフライン判定: navigator.onLine が false の場合は投稿をスキップ
      if(!navigator.onLine){
        showAlert('オフライン', 'ポイントはローカルに保存しましたが、ネットワーク未接続のためヒートマップへの投稿はスキップされました。\n次回オンライン時に再度「ヒートマップに協力」をONにすると送信できます。');
      } else {
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
    if(p.fsId) deleteCoord(p.fsId).catch(e=>console.warn('[points] deleteCoord失敗',e));
    pts.splice(i,1);
  }
  savePts();updPtCnt();closeOv();
}

// ── エクスポート・インポート ──────────────────
function exportPts(){
  const fc={type:'FeatureCollection',features:pts.map(p=>({
    type:'Feature',
    geometry:{type:'Point',coordinates:[p.lng,p.lat]},
    properties:{name:p.name,memo:p.memo,stars:p.stars||0}
  }))};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(fc,null,2)],{type:'application/json'}));
  a.download='goldmap.geojson';a.click();
}
let impD=null;
function importPts(ev){
  const f=ev.target.files[0];ev.target.value='';if(!f)return;
  const r=new FileReader();r.onload=e=>{
    try{
      const j=JSON.parse(e.target.result);
      if(j.type!=='FeatureCollection')throw 0;
      const v=j.features.filter(f=>f.type==='Feature'&&f.geometry?.type==='Point'&&typeof f.geometry.coordinates[0]==='number');
      impD=v;
      document.getElementById('imp-msg').textContent=v.length+'件のポイントが見つかりました。追加または上書きを選択してください。';
      showDlg('dlg-imp');
    }catch{showAlert('エラー','有効なGeoJSONではありません');}
  };r.readAsText(f);
}
function doImport(mode){
  if(!impD)return;
  if(mode==='over'){pts.forEach(p=>map.removeLayer(p.mk));pts=[];nid=1;}
  let add=0,sk=0;
  impD.forEach(f=>{
    const[lng,lat]=f.geometry.coordinates;
    if(pts.some(p=>p.lat===lat&&p.lng===lng)){sk++;return;}
    if(pts.length>=MAX_PT){sk++;return;}
    const p={id:nid++,lat,lng,name:f.properties?.name||'',memo:f.properties?.memo||'',stars:f.properties?.stars||0};
    pts.push(p);addMk(p);add++;
  });
  savePts();updPtCnt();impD=null;closeOv();
  showAlert('完了',add+'件追加、'+sk+'件スキップ');
}
// ═══════════════════════════════════════════
