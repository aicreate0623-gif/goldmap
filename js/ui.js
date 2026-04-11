'use strict';
//  GPS + 方位コンパス
// ═══════════════════════════════════════════
let gpsOn=false, gpsFlw=false, gpsRot=false;
let gpsWid=null, gpsLL=null, gpsCI=null;
let gpsHeading=null, gpsCompassMk=null;
let _orientHandler=null;
let _bearingTimer=null;

// ── ローパスフィルター（10フレーム平均）──────────
const _headingBuf=[];
const _HEADING_BUF_SIZE=10;
function _smoothHeading(raw){
  _headingBuf.push(raw);
  if(_headingBuf.length>_HEADING_BUF_SIZE) _headingBuf.shift();
  // 角度の平均（0/360の折り返しを考慮）
  let sinSum=0, cosSum=0;
  _headingBuf.forEach(h=>{ sinSum+=Math.sin(h*Math.PI/180); cosSum+=Math.cos(h*Math.PI/180); });
  return (Math.atan2(sinSum/_headingBuf.length, cosSum/_headingBuf.length)*180/Math.PI+360)%360;
}

// ── ベアリング設定（_resetView削除・invalidateSizeのみ）──
function _applyBearing(deg){
  if(!map.setBearing) return;
  map.setBearing(deg);
  clearTimeout(_bearingTimer);
  _bearingTimer=setTimeout(()=>{
    map.invalidateSize({pan:false});
  }, 150);
}

// ── GPSトグル ────────────────────────────────
function toggleGps(){
  gpsOn=!gpsOn;
  document.getElementById('btn-gps').classList.toggle('active',gpsOn);
  const flwBtn=document.getElementById('btn-flw');
  const rotBtn=document.getElementById('btn-rot');
  if(gpsOn){
    flwBtn.style.display='flex';
    rotBtn.style.display='flex';
    startWatch();
    startOrientation();
  } else {
    gpsFlw=false; gpsRot=false;
    flwBtn.classList.remove('active'); flwBtn.style.display='none';
    rotBtn.classList.remove('active'); rotBtn.style.display='none';
    stopWatch();
    stopOrientation();
    if(gpsCI){map.removeLayer(gpsCI);gpsCI=null;}
    if(gpsCompassMk){map.removeLayer(gpsCompassMk);gpsCompassMk=null;}
    _applyBearing(0);
  }
  updGps();
}

// ── 追従トグル ───────────────────────────────
function toggleFollow(){
  if(!gpsOn) return;
  gpsFlw=!gpsFlw;
  document.getElementById('btn-flw').classList.toggle('active',gpsFlw);
  if(gpsFlw&&gpsLL) map.setView(gpsLL);
}

// ── 回転トグル ───────────────────────────────
function toggleRotate(){
  if(!gpsOn) return;
  gpsRot=!gpsRot;
  document.getElementById('btn-rot').classList.toggle('active',gpsRot);
  if(gpsRot && gpsHeading!==null){
    _applyBearing(gpsHeading);
  } else {
    _applyBearing(0);
  }
  updGps();
}

// ── GPS位置監視 ──────────────────────────────
function startWatch(){
  if(!navigator.geolocation){showAlert('非対応','GPSに対応していません');gpsOn=false;return;}
  gpsWid=navigator.geolocation.watchPosition(onGps,()=>{},{enableHighAccuracy:true});
}
function stopWatch(){
  if(gpsWid!==null){navigator.geolocation.clearWatch(gpsWid);gpsWid=null;}
}
function onGps(pos){
  const{latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
  gpsLL=L.latLng(lat,lng);
  if(!gpsCI) gpsCI=L.circle([lat,lng],{radius:acc,color:'#3080e8',fillColor:'#3080e8',fillOpacity:.1,weight:1,pane:'paneUser'}).addTo(map);
  else{gpsCI.setLatLng([lat,lng]);gpsCI.setRadius(acc);}
  if(gpsFlw) map.setView([lat,lng]);
  if(gpsRot && gpsHeading!==null) _applyBearing(gpsHeading);
  updateCompassMarker(lat,lng,gpsHeading);
  document.getElementById('sb-coord').textContent=lat.toFixed(5)+', '+lng.toFixed(5)+' ±'+Math.round(acc)+'m';
  updGps();
}

// ── 方位センサー ─────────────────────────────
function startOrientation(){
  if(!window.DeviceOrientationEvent) return;
  if(typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission()
      .then(r=>{ if(r==='granted') _addOrientListener(); })
      .catch(()=>{});
  } else {
    _addOrientListener();
  }
}
function _addOrientListener(){
  _orientHandler=e=>{
    let raw=null;
    if(e.webkitCompassHeading!=null){
      raw=e.webkitCompassHeading;           // iOS: 真北基準・高精度
    } else if(e.alpha!=null){
      // Android: 画面回転補正を加えて真北基準に変換
      let screenAngle=0;
      if(screen.orientation && screen.orientation.angle!=null){
        screenAngle=screen.orientation.angle;
      } else if(window.orientation!=null){
        screenAngle=window.orientation;
      }
      raw=((360-e.alpha)+screenAngle)%360;
    }
    if(raw===null) return;
    const heading=_smoothHeading(raw);      // ローパスフィルター通過
    gpsHeading=heading;
    if(gpsLL) updateCompassMarker(gpsLL.lat,gpsLL.lng,heading);
    if(gpsRot) _applyBearing(heading);
  };
  // Android: deviceorientationabsolute（真北基準）を優先
  const evtName=('ondeviceorientationabsolute' in window)
    ? 'deviceorientationabsolute'
    : 'deviceorientation';
  window.addEventListener(evtName,_orientHandler,true);
  // stopOrientationで使うためにイベント名を保持
  _orientHandler._evtName=evtName;
}
function stopOrientation(){
  if(_orientHandler){
    const evtName=_orientHandler._evtName||'deviceorientation';
    window.removeEventListener(evtName,_orientHandler,true);
    _orientHandler=null;
  }
  gpsHeading=null;
  _headingBuf.length=0; // バッファもリセット
}

// ── サーチライト扇形マーカー（グラデーション）────
function updateCompassMarker(lat,lng,heading){
  const rot = heading != null ? heading : 0;
  const html = `<div style="width:100px;height:100px;position:relative;transform:rotate(${rot}deg);transform-origin:50px 50px;">
    <svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sg" cx="50%" cy="62%" r="50%">
          <stop offset="0%"   stop-color="rgba(80,180,255,0.55)"/>
          <stop offset="60%"  stop-color="rgba(80,180,255,0.20)"/>
          <stop offset="100%" stop-color="rgba(80,180,255,0.00)"/>
        </radialGradient>
      </defs>
      <path d="M50,50 L24,3 A48,48 0 0,1 76,3 Z"
            fill="url(#sg)"
            stroke="rgba(80,180,255,0.6)"
            stroke-width="1"
            stroke-linejoin="round"/>
      <circle cx="50" cy="50" r="8" fill="#3080e8" stroke="#fff" stroke-width="2.5"/>
      <circle cx="50" cy="50" r="3" fill="#fff"/>
    </svg>
  </div>`;
  const ico = L.divIcon({html, className:'', iconSize:[100,100], iconAnchor:[50,50]});
  if(!gpsCompassMk){
    gpsCompassMk = L.marker([lat,lng],{icon:ico,zIndexOffset:200,pane:'paneUser',interactive:false}).addTo(map);
  } else {
    gpsCompassMk.setLatLng([lat,lng]);
    gpsCompassMk.setIcon(ico);
  }
}

// ── ステータス更新 ────────────────────────────
function updGps(){
  document.getElementById('gps-dot').className='sb-dot'+(gpsOn?' on':'');
  let lbl='GPS オフ';
  if(gpsOn){
    if(gpsRot) lbl='GPS 回転中';
    else if(gpsFlw) lbl='GPS 追従中';
    else lbl='GPS オン';
  }
  document.getElementById('sb-gps-lbl').textContent=lbl;
}

// ━━━ 座標表示（マウス/タッチ）
map.on('mousemove',e=>{
  if(!gpsOn) document.getElementById('sb-coord').textContent=e.latlng.lat.toFixed(5)+', '+e.latlng.lng.toFixed(5);
});

// ═══════════════════════════════════════════
//  砂金分布ヒートマップ
//  データソース（将来的な重み付け）
//    weight 0.3 → GSJ_MINE_DATA（Au_Ag鉱床）  鉱床存在確率
//    weight 0.6 → MINES（砂金採取実績地）
//    weight 1.0 → ユーザー投稿（実採取報告）  ← Firestore後で追加
// ═══════════════════════════════════════════
let heatLayer = null;
let heatOn = false;

// ── ヒートマップ用点群を生成
function buildHeatPoints() {
  const pts = [];

  // 1) GSJ鉱床データ（Au_Ag のみ・鉱徴地は低weight）
  for (const d of GSJ_MINE_DATA) {
    if (d.mat !== 'Au_Ag') continue;
    const w = d.trace ? 0.2 : 0.35; // 鉱徴地は薄め
    pts.push([d.lat, d.lng, w]);
  }

  // 2) 砂金採取実績DB（MINES）
  for (const m of MINES) {
    pts.push([m.lat, m.lng, 0.6]);
  }

  // 3) ユーザー投稿（将来：Firestoreから取得したJSONを追加）
  // for (const u of USER_REPORTS) { pts.push([u.lat, u.lng, 1.0]); }

  return pts;
}

// ── ズームレベルに応じてradiusを動的調整
function heatRadius() {
  const z = map.getZoom();
  // z5=8, z7=14, z9=22, z11=35, z13=55
  return Math.round(8 * Math.pow(1.42, z - 5));
}

// ── ヒートマップ初期化・再描画
function initHeatLayer() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  const pts = buildHeatPoints();
  heatLayer = L.heatLayer(pts, {
    radius:   heatRadius(),
    blur:     15,
    maxZoom:  13,
    max:      1.0,
    minOpacity: 0.25,
    gradient: {
      0.00: '#001233',  // 深夜ブルー（ほぼ無し）
      0.25: '#0d3d8a',  // 青（低密度）
      0.50: '#c86400',  // 茶オレンジ（中密度）
      0.75: '#e8a800',  // ゴールド（高密度）
      1.00: '#fff5a0',  // 輝く金（最高密度）
    },
    pane: 'paneHeat',
  }).addTo(map);
}

// ── ズーム変化時にradius更新
map.on('zoomend', () => {
  if (heatOn && heatLayer) {
    heatLayer.setOptions({ radius: heatRadius() });
    heatLayer.redraw();
  }
});

// ── ON/OFF切替
function toggleHeat() {
  heatOn = !heatOn;
  document.getElementById('btn-heat').classList.toggle('active', heatOn);
  if (heatOn) {
    initHeatLayer();
  } else {
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  }
}

// ── 外部からデータを追加する口（Firestore連携時に使用）
// points: [{lat, lng, weight}] の配列
function addHeatPoints(points) {
  if (!heatLayer) return;
  const current = heatLayer._latlngs || [];
  const merged = current.concat(points.map(p => [p.lat, p.lng, p.weight ?? 1.0]));
  heatLayer.setLatLngs(merged);
  heatLayer.redraw();
}

// ═══════════════════════════════════════════
//  タイル数計算
// ═══════════════════════════════════════════
const JAPAN=L.latLngBounds([24,122],[46,154]);
function lon2x(lon,z){return Math.floor((lon+180)/360*Math.pow(2,z));}
function lat2y(lat,z){return Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2,z));}
function cntTiles(b,zmin,zmax){let n=0;for(let z=zmin;z<=zmax;z++){const x0=lon2x(b.getWest(),z),x1=lon2x(b.getEast(),z),y0=lat2y(b.getNorth(),z),y1=lat2y(b.getSouth(),z);n+=(x1-x0+1)*(y1-y0+1);}return n;}
function ckLayers(){return['std','photo','topo'].filter(k=>document.getElementById('ck-'+k).checked);}
function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M枚';if(n>=1e3)return Math.round(n/1e3)+'K枚';return n+'枚';}
function mbEst(n){return(n*20/1024).toFixed(0);}

function updBaseEst(){
  const zmax=parseInt(document.getElementById('base-zmax').value);
  const L2=ckLayers().length||1, n=cntTiles(JAPAN,5,zmax)*L2;
  document.getElementById('base-est').innerHTML=`Z5〜Z${zmax}、<b>${fmt(n)}</b>（約 <b>${mbEst(n)} MB</b>）<br><span style="font-size:10px;color:#907030">※ Z10全国は約3万枚×レイヤー数</span>`;
}
function updDetEst(){
  const btn=document.getElementById('btn-dldet');
  if(!detRect){document.getElementById('det-est').textContent='— 範囲を選択してください —';btn.disabled=true;return;}
  const zmin=parseInt(document.getElementById('det-zmin').value),zmax=parseInt(document.getElementById('det-zmax').value);
  const L2=ckLayers().length||1, n=cntTiles(detRect,zmin,zmax)*L2;
  document.getElementById('det-est').innerHTML=`Z${zmin}〜Z${zmax}、<b>${fmt(n)}</b>（約 <b>${mbEst(n)} MB</b>）`;
  btn.disabled=false;
}
['ck-std','ck-photo','ck-topo'].forEach(id=>{ document.getElementById(id).onchange=()=>{updBaseEst();updDetEst();}; });
document.getElementById('base-zmax').onchange=updBaseEst;
document.getElementById('det-zmin').onchange=updDetEst;
document.getElementById('det-zmax').onchange=updDetEst;

// ═══════════════════════════════════════════
//  矩形選択
// ═══════════════════════════════════════════
let detRect=null,drawMode=false,rs=null,rPrev=null;

function useView(){detRect=map.getBounds();showRect();updDetEst();}

function startRectDraw(){
  if(drawMode)return; drawMode=true;
  document.getElementById('rect-banner').style.display='block';
  map.dragging.disable(); map.scrollWheelZoom.disable();
  map.getContainer().style.cursor='crosshair';
  const down=e=>{rs=e.latlng;if(rPrev){map.removeLayer(rPrev);rPrev=null;}};
  const move=e=>{if(!rs)return;if(rPrev)map.removeLayer(rPrev);
    rPrev=L.rectangle(L.latLngBounds(rs,e.latlng),{color:'#00ffff',weight:2,dashArray:'6 3',fillColor:'#00ffff',fillOpacity:.08}).addTo(map);};
  const up=e=>{if(!rs)return;detRect=L.latLngBounds(rs,e.latlng);finishDraw();showRect();updDetEst();
    // 矩形選択完了後にオフラインシートへ戻る
    setTimeout(()=>switchTab('offline'),300);
  };
  map._re={down,move,up}; map.on('mousedown',down).on('mousemove',move).on('mouseup',up);
}
function finishDraw(){
  drawMode=false;rs=null;
  document.getElementById('rect-banner').style.display='none';
  map.dragging.enable();map.scrollWheelZoom.enable();
  map.getContainer().style.cursor='';
  const e=map._re; if(e)map.off('mousedown',e.down).off('mousemove',e.move).off('mouseup',e.up);
}
function showRect(){
  if(rPrev){map.removeLayer(rPrev);rPrev=null;}
  if(detRect){
    rPrev=L.rectangle(detRect,{color:'#00ffff',weight:2,dashArray:'4 3',fillColor:'#00ffff',fillOpacity:.06}).addTo(map);
    document.getElementById('rect-info').innerHTML=`北: <b>${detRect.getNorth().toFixed(3)}</b>　南: <b>${detRect.getSouth().toFixed(3)}</b><br>西: <b>${detRect.getWest().toFixed(3)}</b>　東: <b>${detRect.getEast().toFixed(3)}</b>`;
  }
}

// ═══════════════════════════════════════════
//  レジューム管理
// ═══════════════════════════════════════════
const RESUME_KEY='gm_dl_resume';

function saveResume(state){
  try{ localStorage.setItem(RESUME_KEY,JSON.stringify(state)); }catch(e){}
}
function loadResume(){
  try{ return JSON.parse(localStorage.getItem(RESUME_KEY)||'null'); }catch(e){return null;}
}
function deleteResume(){
  localStorage.removeItem(RESUME_KEY);
}

function checkResume(){
  const s=loadResume(); if(!s)return;
  const banner=document.getElementById('resume-banner');
  const modeStr=s.mode==='base'?'全日本ベース':'詳細範囲';
  const layerStr=s.layers.join('・');
  const pct=s.total>0?Math.round(s.taskIndex/s.total*100):0;
  document.getElementById('resume-desc').innerHTML=
    `${modeStr} / ${layerStr}<br>Z${s.zmin}〜Z${s.zmax} / 進捗 <b>${fmt(s.taskIndex)} / ${fmt(s.total)}（${pct}%）</b><br>保存: ${s.savedAt||'—'}`;
  banner.classList.add('show');
}

function clearResume(){
  deleteResume();
  document.getElementById('resume-banner').classList.remove('show');
}

async function resumeDl(){
  const s=loadResume(); if(!s)return;
  // 状態を復元してDL再開
  const layers=s.layers; if(!layers.length)return;
  let bounds;
  if(s.mode==='base') bounds=JAPAN;
  else {
    bounds=L.latLngBounds([s.bounds.s,s.bounds.w],[s.bounds.n,s.bounds.e]);
    detRect=bounds; showRect(); updDetEst();
  }
  await runDl(s.mode, bounds, s.zmin, s.zmax, layers, s.taskIndex);
}

// ═══════════════════════════════════════════
//  ダウンロードエンジン
// ═══════════════════════════════════════════
let dlRun=false, dlStop=false;
const CONCUR=6;

async function startDl(mode){
  if(dlRun)return;
  const layers=ckLayers(); if(!layers.length){showAlert('エラー','レイヤーを1つ以上選択してください');return;}
  let bounds,zmin,zmax;
  if(mode==='base'){
    bounds=JAPAN; zmin=5; zmax=parseInt(document.getElementById('base-zmax').value);
  }else{
    if(!detRect){showAlert('エラー','範囲を選択してください');return;}
    bounds=detRect;
    zmin=parseInt(document.getElementById('det-zmin').value);
    zmax=parseInt(document.getElementById('det-zmax').value);
  }
  await runDl(mode, bounds, zmin, zmax, layers, 0);
}

async function runDl(mode, bounds, zmin, zmax, layers, startIdx){
  if(dlRun)return;

  // タスク全生成
  const tasks=[];
  for(const lk of layers) for(let z=zmin;z<=zmax;z++){
    const x0=lon2x(bounds.getWest(),z),x1=lon2x(bounds.getEast(),z);
    const y0=lat2y(bounds.getNorth(),z),y1=lat2y(bounds.getSouth(),z);
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) tasks.push({lk,z,x,y});
  }
  const total=tasks.length;

  dlRun=true; dlStop=false;
  document.getElementById('prog-section').classList.add('show');

  // ボタン切替
  const SB=mode==='base'?document.getElementById('btn-stpbase'):document.getElementById('btn-stpdet');
  const DB2=mode==='base'?document.getElementById('btn-dlbase'):document.getElementById('btn-dldet');
  SB.style.display='block'; DB2.disabled=true;

  // 統計リセット
  document.getElementById('pg-tot').textContent=fmt(total);
  document.getElementById('pg-rem').textContent=fmt(Math.max(0,total-startIdx));
  document.getElementById('pg-done').textContent=fmt(startIdx);
  document.getElementById('pg-bar').style.width=(total>0?Math.round(startIdx/total*100):0)+'%';
  document.getElementById('dl-log').textContent='';

  // resumeの境界情報
  const boundsData=mode==='base'?null:{n:bounds.getNorth(),s:bounds.getSouth(),e:bounds.getEast(),w:bounds.getWest()};

  let done=startIdx, fail=0;
  const log=msg=>{const el=document.getElementById('dl-log');el.textContent=msg+'\n'+el.textContent;el.textContent=el.textContent.split('\n').slice(0,40).join('\n');};

  const tick=()=>{
    const pct=total>0?Math.round(done/total*100):0;
    document.getElementById('pg-done').textContent=fmt(done);
    document.getElementById('pg-rem').textContent=fmt(Math.max(0,total-done));
    document.getElementById('pg-mb').textContent=mbEst(done)+' MB';
    document.getElementById('pg-bar').style.width=pct+'%';
  };

  // startIdx以降のキュー（方式B: dbGetで重複スキップ）
  const q=tasks.slice(startIdx);
  let active=0, qIdx=startIdx;

  await new Promise(resolve=>{
    const next=()=>{
      if(dlStop){resolve();return;}
      while(active<CONCUR&&q.length){
        active++;
        const t=q.shift();
        const curIdx=qIdx++;
        const k=tileKey(t.lk,t.z,t.x,t.y);
        const url2=tileURL(t.lk,t.z,t.x,t.y);
        const promise=db
          ?dbGet(k).then(c=>{
              if(c){done++;tick();return;} // 既存キャッシュはスキップ
              return fetch(url2,{signal:AbortSignal.timeout?AbortSignal.timeout(8000):undefined})
                .then(r=>r.ok?r.arrayBuffer():null)
                .then(buf=>{if(buf)return dbPut(k,buf).then(()=>{done++;tick();});else{fail++;tick();}});
            }).catch(()=>{fail++;tick();})
          :fetch(url2).then(r=>r.ok?r.arrayBuffer():null)
            .then(buf=>{if(buf){done++;tick();}else{fail++;tick();}})
            .catch(()=>{fail++;tick();});

        promise.finally(()=>{
          active--;
          if(done%200===0||done===total) log(`完了: ${fmt(done)} / ${fmt(total)}  失敗: ${fail}`);

          if(dlStop){
            // 停止時にレジューム状態を保存
            const now=new Date().toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
            saveResume({mode,bounds:boundsData,zmin,zmax,layers,taskIndex:done,total,savedAt:now});
            resolve();
          } else if(!q.length&&active===0){
            resolve();
          } else {
            next();
          }
        });
      }
    };
    next();
  });

  dlRun=false; SB.style.display='none'; DB2.disabled=false;
  if(!dlStop){
    // 完了したらレジューム削除
    deleteResume();
    document.getElementById('resume-banner').classList.remove('show');
    log('✅ 完了！ '+fmt(done)+'枚保存（失敗: '+fail+'）');
  } else {
    log('⏸ 停止しました。続きから再開できます。');
    checkResume(); // バナー更新
  }
  refreshCache();
}

function stopDl(){dlStop=true;}

// ═══════════════════════════════════════════
//  キャッシュ情報
// ═══════════════════════════════════════════
async function refreshCache(){
  if(!db){document.getElementById('cache-info').textContent='IndexedDB 未対応';return;}
  const n=await dbCnt();
  const txt=fmt(n)+'（約 '+mbEst(n)+' MB）';
  document.getElementById('cache-info').textContent=txt;
  document.getElementById('sb-cache').textContent='💾 '+txt;
}
async function clearCache(){
  if(!confirm('キャッシュを全て削除しますか？'))return;
  await dbClr(); refreshCache(); showAlert('完了','キャッシュを削除しました');
}

// ═══════════════════════════════════════════
//  タブ切替
// ═══════════════════════════════════════════
let curTab='map';
const SHEETS={pts:'pt-sheet', offline:'dl-sheet', cfg:'cfg-sheet'};

function switchTab(tab){
  // 前のタブのシートを閉じる
  if(curTab!=='map' && SHEETS[curTab]){
    document.getElementById(SHEETS[curTab]).classList.remove('open');
  }
  curTab=tab;
  // タブボタンのアクティブ状態
  ['map','pts','offline','cfg'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
  });
  // シートを開く
  if(tab!=='map' && SHEETS[tab]){
    document.getElementById(SHEETS[tab]).classList.add('open');
    // タブ切替時にLeafletサイズ更新
    setTimeout(()=>map.invalidateSize(),300);
  }
}

// ═══════════════════════════════════════════
//  ダイアログ
// ═══════════════════════════════════════════
const DLGS=['dlg-edit','dlg-savecf','dlg-detail','dlg-del','dlg-imp','dlg-alr','dlg-contrib-on','dlg-contrib-off'];
function showDlg(id){DLGS.forEach(d=>document.getElementById(d).style.display='none');document.getElementById(id).style.display='block';document.getElementById('overlay').classList.add('open');}
function closeOv(){document.getElementById('overlay').classList.remove('open');DLGS.forEach(d=>document.getElementById(d).style.display='none');eid=null;}
function showAlert(ttl,msg){document.getElementById('alr-ttl').textContent=ttl;document.getElementById('alr-msg').textContent=msg;showDlg('dlg-alr');}

// ═══════════════════════════════════════════
//  バックボタン制御
//  設計方針:
//    history.pushState でアプリ独自スタックを管理。
//    将来 PWA / Android WebView の finish() 相当に
//    差し替えられるよう exitApp() を抽象化。
// ═══════════════════════════════════════════
let _backDepth = 0;     // pushState した回数
let _suppressPush = false; // popstate内部の switchTab 呼び出し時に push を抑制

// アプリ起動時に基底エントリを push
(function initHistory(){
  // ページロード時点では state が null なので push しておく
  history.replaceState({appBack:true, depth:0}, '');
})();

// タブ / シート が開くたびに push してスタックを積む
function _pushHistory(){
  _backDepth++;
  history.pushState({appBack:true, depth:_backDepth}, '');
}

// 元の switchTab を拡張：非mapタブに切り替えるとき history を push
const _origSwitchTab = switchTab;
// ※ switchTab は下で再定義するため ここでは記述せず、
//    後述の popstate ハンドラ内で状態を判断する。

window.addEventListener('popstate', function(e){
  const st = e.state;
  if(!st || !st.appBack){
    // 自アプリのスタック外（普通はないが念のため）
    return;
  }

  // ① ダイアログ（overlay）が開いているなら閉じる
  const ov = document.getElementById('overlay');
  if(ov.classList.contains('open')){
    closeOv();
    // popstate を消費したので再度 push して depth を維持
    _pushHistory();
    return;
  }

  // ② 終了確認ダイアログが開いているなら閉じる
  const exitOv = document.getElementById('exit-overlay');
  if(exitOv.style.display === 'flex'){
    closeExitDlg();
    _pushHistory();
    return;
  }

  // ③ タブが開いているなら地図に戻す
  if(curTab !== 'map'){
    _suppressPush = true;
    switchTab('map');
    _suppressPush = false;
    _pushHistory();
    return;
  }

  // ④ 地図表示中 → 終了確認ダイアログ
  _showExitDlg();
  _pushHistory(); // ダイアログが開いている状態をスタックに積む
});

function _showExitDlg(){
  document.getElementById('exit-overlay').style.display = 'flex';
}
function closeExitDlg(){
  document.getElementById('exit-overlay').style.display = 'none';
}
function doExitApp(){
  closeExitDlg();
  // 抽象化された終了処理
  // WebView(Android): window.appBridge?.finish() 等に差し替え可能
  // PWA / ブラウザ: history を最後まで戻してから close
  try {
    // 積んだ history を一括で巻き戻した上で close を試みる
    history.go(-(_backDepth + 1));
    setTimeout(()=>{ window.close(); }, 100);
  } catch(e){
    window.close();
  }
}



document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closeOv();
    if(drawMode)finishDraw();
    if(addMode)cancelAdd();
  }
});

// switchTab: 非mapタブへの切り替え時に history を push
(function(){
  const _orig = switchTab;
  switchTab = function(tab){
    const wasMap = (curTab === 'map');
    _orig(tab);
    if(!_suppressPush && wasMap && tab !== 'map'){
      _pushHistory();
    }
  };
})();

// 起動