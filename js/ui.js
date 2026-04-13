'use strict';
//  GPS + 方位コンパス
// ═══════════════════════════════════════════
let gpsOn=false, gpsFlw=false;
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
  if(!gpsOn){
    // ONにする前に権限を事前確認
    _checkGpsPermission().then(ok=>{
      if(!ok) return; // 権限なし→ダイアログ表示済み
      gpsOn=true;
      document.getElementById('btn-gps').classList.add('active');
      document.getElementById('btn-flw').style.display='flex';
      startWatch();
      startOrientation();
      updGps();
    });
  } else {
    _forceGpsOff();
  }
}

// GPS強制OFF（ボタン・UI・監視を全てリセット）
function _forceGpsOff(){
  gpsOn=false;
  gpsFlw=false;
  const flwBtn=document.getElementById('btn-flw');
  document.getElementById('btn-gps').classList.remove('active');
  flwBtn.classList.remove('active'); flwBtn.style.display='none';
  stopWatch();
  stopOrientation();
  if(gpsCI){map.removeLayer(gpsCI);gpsCI=null;}
  if(gpsCompassMk){map.removeLayer(gpsCompassMk);gpsCompassMk=null;}
  _applyBearing(0);
  gpsLL=null;
  updGps();
}

// GPS権限の事前チェック
async function _checkGpsPermission(){
  if(!navigator.geolocation){
    showAlert('非対応','このブラウザはGPSに対応していません');
    return false;
  }
  if(!navigator.permissions) return true;
  try{
    const result = await navigator.permissions.query({name:'geolocation'});
    if(result.state==='denied'){
      _showGpsSettingsDialog();
      return false;
    }
  }catch(e){}
  return true;
}

// 位置情報設定への誘導ダイアログ
function _showGpsSettingsDialog(){
  showAlert(
    '位置情報が無効です',
    'スマホの設定アプリ → Chrome（またはブラウザ）→ 位置情報 → 許可\nに変更してから再度タップしてください。'
  );
}

// GPS信号途絶ダイアログ（待機 or 強制OFF）
let _gpsLostDialogShown = false;
function _showGpsLostDialog(){
  if(_gpsLostDialogShown) return; // 重複表示防止
  _gpsLostDialogShown = true;
  showDlg('dlg-gps-lost');
}
function _onGpsLostDialogClose(){
  _gpsLostDialogShown = false;
}

// ── 追従トグル ───────────────────────────────
function toggleFollow(){
  if(!gpsOn) return;
  gpsFlw=!gpsFlw;
  document.getElementById('btn-flw').classList.toggle('active',gpsFlw);
  if(gpsFlw&&gpsLL) map.setView(gpsLL);
}

// ── 回転トグル ───────────────────────────────

// ── GPS位置監視 ──────────────────────────────
function startWatch(){
  if(!navigator.geolocation){showAlert('非対応','GPSに対応していません');_forceGpsOff();return;}
  gpsWid=navigator.geolocation.watchPosition(
    onGps,
    (err)=>{
      if(!gpsOn) return;
      console.warn('[GPS] error', err.code, err.message);
      if(err.code===1){ // PERMISSION_DENIED
        _showGpsSettingsDialog();
        _forceGpsOff();
      } else if(err.code===2){ // POSITION_UNAVAILABLE: GPS信号途絶
        _showGpsLostDialog();
      }
      // TIMEOUT(3)はスルー
    },
    {enableHighAccuracy:true, timeout:15000, maximumAge:0}
  );
}
function stopWatch(){
  if(gpsWid!==null){navigator.geolocation.clearWatch(gpsWid);gpsWid=null;}
}
function onGps(pos){
  if(!gpsOn) return;
  // 信号回復: 途絶ダイアログが出ていれば閉じる
  if(_gpsLostDialogShown){
    closeOv();
    _gpsLostDialogShown = false;
  }
  const{latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
  gpsLL=L.latLng(lat,lng);
  if(!gpsCI) gpsCI=L.circle([lat,lng],{radius:acc,color:'#3080e8',fillColor:'#3080e8',fillOpacity:.1,weight:1,pane:'paneUser'}).addTo(map);
  else{gpsCI.setLatLng([lat,lng]);gpsCI.setRadius(acc);}
  if(gpsFlw) map.setView([lat,lng]);
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
    if(!gpsOn) return; // GPS OFF後の遅延イベントを無視
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
  const gid = 'sg_' + Date.now(); // IDの重複を防ぐ
  const html = `<div style="width:140px;height:140px;position:relative;transform:rotate(${rot}deg);transform-origin:70px 70px;">
    <svg width="140" height="140" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="${gid}" cx="50%" cy="57%" r="50%">
          <stop offset="0%"   stop-color="rgba(80,180,255,0.75)"/>
          <stop offset="50%"  stop-color="rgba(80,180,255,0.40)"/>
          <stop offset="100%" stop-color="rgba(80,180,255,0.00)"/>
        </radialGradient>
      </defs>
      <!-- 扇形サーチライト（上向き・90°） -->
      <path d="M70,70 L24,24 A65,65 0 0,1 116,24 Z"
            fill="url(#${gid})"
            stroke="none"/>
      <!-- 中心ドット -->
      <circle cx="70" cy="70" r="9" fill="#3080e8" stroke="#fff" stroke-width="2.5"/>
      <circle cx="70" cy="70" r="3.5" fill="#fff"/>
    </svg>
  </div>`;
  const ico = L.divIcon({html, className:'', iconSize:[140,140], iconAnchor:[70,70]});
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
    if(gpsFlw) lbl='GPS 追従中';
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
//  データソース:
//    GSJ_MINE_DATA（Au_Ag鉱床） weight:低
//    MINES（砂金採取実績地）    weight:中
//    ユーザー投稿（Firestore）   weight:高 ← Phase2
// ═══════════════════════════════════════════

// ── グリッド集計 + log正規化 ──────────────────────────
// gridDeg: 集計グリッドの1辺（度）
// 密集地でも等高線的なグラデーションが出るよう log(count+1) で正規化
function _gridAggregate(rawPts, gridDeg) {
  const grid = {};
  rawPts.forEach(([lat, lng, w]) => {
    const key = `${Math.round(lat / gridDeg)}_${Math.round(lng / gridDeg)}`;
    if(!grid[key]) grid[key] = { lat: Math.round(lat/gridDeg)*gridDeg,
                                  lng: Math.round(lng/gridDeg)*gridDeg,
                                  sum: 0, count: 0 };
    grid[key].sum   += w;
    grid[key].count += 1;
  });
  const cells = Object.values(grid);
  if(!cells.length) return [];
  const maxLog = Math.log(Math.max(...cells.map(c => c.count)) + 1);
  if(maxLog === 0) return [];
  return cells.map(c => [
    c.lat, c.lng,
    Math.log(c.count + 1) / maxLog  // 0〜1 に正規化
  ]);
}

// ── 生データ生成 ─────────────────────────────────────
function buildHeatPoints() {
  const pts = [];
  for (const d of GSJ_MINE_DATA) {
    if (d.mat !== 'Au_Ag') continue;
    pts.push([d.lat, d.lng, d.trace ? 0.3 : 0.5]);
  }
  for (const m of MINES) pts.push([m.lat, m.lng, 0.8]);
  return pts;
}

// ── DEVパネルから上書きできるパラメーター ────────────
// devUpdateHeat() で反映
const _DEV = {
  radius:     null, // null = 自動計算
  blur:       null,
  opacity:    null,
  zoomLimit:  null,
};

// ── tier設定 ─────────────────────────────────────────
// gridDeg: グリッド集計サイズ
// colorStops: グラデーション停止点
// zoomMax: これを超えたら上位tierへ誘導
const TIER_CFG = {
  free: {
    gridDeg:  0.1,    // 約11km
    zoomMax:  7,
    blur:     55,
    minOpacity: 0.15,
    // 青〜橙〜金（広域・参考情報）
    gradient: {
      0.00: '#001233',
      0.20: '#0a2a6e',
      0.45: '#b85800',
      0.72: '#e0a000',
      1.00: '#fff0a0',
    },
  },
  hd: {
    gridDeg:  0.01,   // 約1.1km
    zoomMax:  9,
    blur:     22,
    minOpacity: 0.12,
    // 深緑〜緑金〜金白（精度高め）
    gradient: {
      0.00: '#001a0a',
      0.22: '#0a4a1a',
      0.48: '#6a9a00',
      0.74: '#d4c800',
      1.00: '#fffff0',
    },
  },
  vip: {
    gridDeg:  0.01,   // 将来0.001°に変更
    zoomMax:  13,
    blur:     14,
    minOpacity: 0.10,
    // 深紅〜橙赤〜白金（最高精度）
    gradient: {
      0.00: '#1a0000',
      0.22: '#6a0a00',
      0.50: '#c83000',
      0.76: '#f0a800',
      1.00: '#fff8e0',
    },
  },
};

let heatTier   = 'free';
let heatLayer  = null;
let heatOn     = false;

// ── ズームに応じたradius（地理距離ベース） ────────────
// z7で約35px相当になるよう基準を設定
function _heatRadius(tier) {
  const z    = map.getZoom();
  const base = tier === 'hd' ? 10 : tier === 'vip' ? 6 : 18;
  return _DEV.radius ?? Math.round(base * Math.pow(1.45, z - 5));
}

// ── ヒートマップ初期化（layer丸ごと作り直し） ────────
function initHeatLayer(tier) {
  tier = tier || 'free';
  heatTier = tier;
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }

  const cfg  = TIER_CFG[tier];
  const raw  = buildHeatPoints();
  const pts  = _gridAggregate(raw, cfg.gridDeg);
  const r    = _heatRadius(tier);
  const blur = _DEV.blur        ?? cfg.blur;
  const opac = _DEV.opacity     ?? cfg.minOpacity;

  heatLayer = L.heatLayer(pts, {
    radius:     r,
    blur:       blur,
    minOpacity: opac,
    maxZoom:    18,   // leaflet-heat側の制限なし（こちらで制御）
    max:        1.0,
    gradient:   cfg.gradient,
    pane:       'paneHeat',
  }).addTo(map);

  // ボタンのアクティブ状態更新
  document.getElementById('btn-hd')?.classList.toggle('active',  tier === 'hd');
  document.getElementById('btn-adj')?.classList.remove('active'); // 調整パネルボタンはtier連動しない
}

// ── ズーム変化時: layer作り直し + zoom制限チェック ────
map.on('zoomend', () => {
  if(!heatOn) return;
  const z    = map.getZoom();
  const maxZ = _DEV.zoomLimit ?? TIER_CFG[heatTier].zoomMax;
  if(z > maxZ){
    if(heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    _showHeatZoomBanner(true, heatTier);
  } else {
    _showHeatZoomBanner(false);
    // layer作り直しで確実にきれいな再描画
    initHeatLayer(heatTier);
  }
});

// ── HD/VIP誘導バナー ──────────────────────────────────
function _showHeatZoomBanner(show, tier){
  let b = document.getElementById('heat-zoom-banner');
  if(show){
    const isHd  = (tier === 'hd');
    const msg   = isHd ? '⭐ この拡大率はVIPプランで閲覧できます'
                       : '🔥 この拡大率は高解像度版で閲覧できます';
    const btnHtml = isHd
      ? '<button onclick="toggleHeatAdj()" style="margin-left:8px;padding:3px 10px;border-radius:5px;background:linear-gradient(135deg,#c06000,#f0d000);border:none;color:#1a0800;font-weight:700;font-size:11px;cursor:pointer;">調整を開く</button>'
      : '<button onclick="toggleHeatHD()"  style="margin-left:8px;padding:3px 10px;border-radius:5px;background:var(--gold);border:none;color:#1a1400;font-weight:700;font-size:11px;cursor:pointer;">HDを見る</button>';
    if(!b){
      b = document.createElement('div');
      b.id = 'heat-zoom-banner';
      b.style.cssText = 'position:fixed;bottom:calc(var(--tab-h)+10px);left:50%;transform:translateX(-50%);z-index:1050;background:rgba(0,0,0,0.88);border:1px solid var(--gold);border-radius:20px;padding:7px 16px;font-size:12px;color:var(--txt);white-space:nowrap;pointer-events:auto;display:flex;align-items:center;gap:4px;';
      document.body.appendChild(b);
    }
    b.innerHTML = msg + btnHtml;
    b.style.display = 'flex';
  } else {
    if(b) b.style.display = 'none';
  }
}

// ── ON/OFF切替 ────────────────────────────────────────
function toggleHeat() {
  heatOn = !heatOn;
  document.getElementById('btn-heat').classList.toggle('active', heatOn);
  const showSub = heatOn ? 'flex' : 'none';
  document.getElementById('btn-hd').style.display  = showSub;
  document.getElementById('btn-adj').style.display = showSub;
  if(heatOn){
    heatTier = 'free';
    initHeatLayer('free');
  } else {
    if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
    document.getElementById('btn-hd')?.classList.remove('active');
    document.getElementById('btn-adj')?.classList.remove('active');
    document.getElementById('heat-ctrl-panel').style.display = 'none';
    _showHeatZoomBanner(false);
  }
}

// ── DEVパラメーター即時反映 ───────────────────────────
function devUpdateHeat() {
  if(heatOn) initHeatLayer(heatTier);
}

// ── Firestore連携用（外部からデータ追加）─────────────
function addHeatPoints(points) {
  if(!heatLayer) return;
  const current = heatLayer._latlngs || [];
  const merged  = current.concat(points.map(p => [p.lat, p.lng, p.weight ?? 1.0]));
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
  _openTab(tab);
}

function _openTab(tab){
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
const DLGS=['dlg-edit','dlg-savecf','dlg-detail','dlg-del','dlg-imp','dlg-alr','dlg-contrib-on','dlg-contrib-off','dlg-premium-gate','dlg-gps-lost'];
function showDlg(id){DLGS.forEach(d=>document.getElementById(d).style.display='none');document.getElementById(id).style.display='block';document.getElementById('overlay').classList.add('open');}
function closeOv(){document.getElementById('overlay').classList.remove('open');DLGS.forEach(d=>document.getElementById(d).style.display='none');eid=null;}
function showAlert(ttl,msg){document.getElementById('alr-ttl').textContent=ttl;document.getElementById('alr-msg').textContent=msg;showDlg('dlg-alr');}

// ═══════════════════════════════════════════
//  バックボタン制御
//  優先順位:
//    ① overlay(ダイアログ)open → 閉じる → push（次のバックに備える）
//    ② 終了確認ダイアログopen  → 閉じる（pushしない: 次バックで自然終了）
//    ③ シートopen              → 地図に戻す → push（④に備える）
//    ④ 地図表示中              → 終了確認ダイアログ → push（②に備える）
//
//  設計原則:
//    「次のバックで何かアクションが必要な状態」の場合だけ push する。
//    終了確認を閉じた後は次のバックでアプリ終了するため push しない。
// ═══════════════════════════════════════════
let _backDepth = 0;
let _suppressPush = false;

(function initHistory(){
  history.replaceState({appBack:true, depth:0}, '');
  _backDepth = 0;
})();

function _pushHistory(){
  _backDepth++;
  history.pushState({appBack:true, depth:_backDepth}, '');
}

window.addEventListener('popstate', function(e){
  const st = e.state;
  if(!st || !st.appBack) return;

  // ① overlay(ダイアログ)が開いているなら閉じる
  const ov = document.getElementById('overlay');
  if(ov.classList.contains('open')){
    closeOv();
    _pushHistory(); // ダイアログを閉じた後も次バックに備える
    return;
  }

  // ② 終了確認ダイアログが開いているなら閉じる
  const exitOv = document.getElementById('exit-overlay');
  if(exitOv.style.display === 'flex'){
    closeExitDlg();
    // pushしない → 次のバックはOS標準動作（アプリ終了）に委ねる
    return;
  }

  // ③ シートが開いているなら地図に戻す
  if(curTab !== 'map'){
    _suppressPush = true;
    _openTab('map');
    _suppressPush = false;
    _pushHistory(); // 地図に戻った後、④に備える
    return;
  }

  // ④ 地図表示中 → 終了確認ダイアログ
  _showExitDlg();
  _pushHistory(); // 終了確認を表示した後、②に備える
});

function _showExitDlg(){
  document.getElementById('exit-overlay').style.display = 'flex';
}
function closeExitDlg(){
  document.getElementById('exit-overlay').style.display = 'none';
}
function doExitApp(){
  closeExitDlg();
  try {
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

// switchTab ラッパー:
//   ・offline → ゲートB（課金チェック）
//   ・map以外へ切替時 → _pushHistory()で③用エントリを積む
(function(){
  const _orig = switchTab;
  switchTab = function(tab){
    if(tab === 'offline'){
      isPremiumUser().then(premium => {
        if(!premium){
          showPremiumGate('offline');
        } else {
          const wasMap = (curTab === 'map');
          _openTab(tab);
          if(!_suppressPush && wasMap) _pushHistory();
        }
      });
      return;
    }
    const wasMap = (curTab === 'map');
    _orig(tab);
    // 地図→シートへの切替時のみpush（シート表示状態を③用に積む）
    if(!_suppressPush && wasMap && tab !== 'map') _pushHistory();
  };
})();

// 起動