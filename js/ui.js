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
  // 50km洪水判定用にグローバル保存
  window._userLat = lat;
  window._userLng = lng;
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
  return cells.map(c => [c.lat, c.lng, Math.log(c.count + 1) / maxLog]);
}

// ── Firebaseから取得したヒートポイントの蓄積バッファ ──
// initHeatLayer()が呼ばれるたびに再合成される
let _firebaseHeatPts = [];  // [{lat, lng, weight}]

// ── 生データ生成 ─────────────────────────────────────
function buildHeatPoints() {
  const pts = [];
  for (const d of GSJ_MINE_DATA) {
    if (d.mat !== 'Au_Ag') continue;
    pts.push([d.lat, d.lng, d.trace ? 0.3 : 0.5]);
  }
  for (const m of MINES) pts.push([m.lat, m.lng, 0.8]);
  // Firebaseデータを合成（weight値をそのまま使用）
  for (const p of _firebaseHeatPts) pts.push([p.lat, p.lng, p.weight ?? 1.0]);
  return pts;
}

// ── tier設定 ─────────────────────────────────────────
const TIER_CFG = {
  free: {
    gridDeg: 0.1,   // 約11km
    zoomMax: 9,
    gradient: {
      0.00: '#001233', 0.20: '#0a2a6e',
      0.45: '#b85800', 0.72: '#e0a000', 1.00: '#fff0a0',
    },
  },
  premium: {
    gridDeg: 0.01,  // 約1.1km
    zoomMax: 13,
    gradient: {
      0.00: '#001a0a', 0.22: '#0a4a1a',
      0.48: '#6a9a00', 0.74: '#d4c800', 1.00: '#fffff0',
    },
  },
};

// ── パネル調整パラメーター（tier別デフォルト・リセット値）────
const HEAT_PARAMS_DEFAULT = {
  free:    { radius: 50, blur: 40, opacity: 25 },
  premium: { radius: 50, blur: 40, opacity: 50 },
};

// 調整域制限
const HEAT_PARAMS_RANGE = {
  free:    { radius:[30,70],  blur:[30,80], opacity:[0,80] },
  premium: { radius:[15,70],  blur:[20,80], opacity:[0,80] },
};

// 現在の調整値（tier別に独立保持）
const _heatParams = {
  free:    { ...HEAT_PARAMS_DEFAULT.free },
  premium: { ...HEAT_PARAMS_DEFAULT.premium },
};

let heatTier  = null;  // null=全OFF, 'free', 'premium'
let heatLayer = null;

// ── ヒートマップ初期化（layer丸ごと作り直し） ────────
function initHeatLayer(tier) {
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
  if(!tier) return;

  heatTier = tier;
  const cfg    = TIER_CFG[tier];
  const params = _heatParams[tier];
  const raw    = buildHeatPoints();
  const pts    = _gridAggregate(raw, cfg.gridDeg);

  heatLayer = L.heatLayer(pts, {
    radius:     params.radius,
    blur:       params.blur,
    minOpacity: params.opacity / 100,
    maxZoom:    18,
    max:        1.0,
    gradient:   cfg.gradient,
    pane:       'paneHeat',
  }).addTo(map);
}

// ── ズーム変化時: zoom制限チェック + layer再描画 ────
map.on('zoomend', () => {
  if(!heatTier) return;
  const z    = map.getZoom();
  const maxZ = TIER_CFG[heatTier].zoomMax;
  if(z > maxZ){
    if(heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    _showHeatZoomBanner(true, heatTier);
  } else {
    _showHeatZoomBanner(false);
    initHeatLayer(heatTier);
  }
});

// ── プレミアム誘導バナー ──────────────────────────────
function _showHeatZoomBanner(show, tier){
  let b = document.getElementById('heat-zoom-banner');
  if(show){
    const msg = tier === 'free'
      ? '🔒 この拡大率はプレミアム版で閲覧できます'
      : '⚠ この拡大率は表示範囲外です';
    const btnHtml = tier === 'free'
      ? '<button onclick="toggleHeatPremium()" style="margin-left:8px;padding:3px 10px;border-radius:5px;background:var(--gold);border:none;color:#1a1400;font-weight:700;font-size:11px;cursor:pointer;">プレミアムへ</button>'
      : '';
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

// ── フリー版 ON/OFF ───────────────────────────────────
function toggleHeatFree() {
  if(heatTier === 'free'){
    _heatAllOff();
    return;
  }
  _closePremiumHeat();
  heatTier = 'free';
  document.getElementById('btn-heat-free').classList.add('active');
  _applyHeatParamsSaved('free');
  _renderHeatPanel('free');
  // パネルは自動で開かない（調整ボタンから手動で開く）
  _showHeatAdjBtn(true);
  initHeatLayer('free');
}

// ── プレミアム版 ON/OFF ──────────────────────────────
async function toggleHeatPremium() {
  if(heatTier === 'premium'){
    _heatAllOff();
    return;
  }
  const ok = await isPremiumUser();
  if(!ok){
    showPremiumGate('heatmap_pro');
    return;
  }
  // ポイント投稿1件以上チェック
  const postCount = await getUserPostCount();
  if(postCount < 1){
    showPremiumGate('heatmap_pro_no_post');
    return;
  }
  _closeFreeHeat();
  heatTier = 'premium';
  document.getElementById('btn-heat-premium').classList.add('active');
  _applyHeatParamsSaved('premium');
  _renderHeatPanel('premium');
  // パネルは自動で開かない（調整ボタンから手動で開く）
  _showHeatAdjBtn(true);
  initHeatLayer('premium');
}

// ── 内部: 全OFF ──────────────────────────────────────
function _heatAllOff() {
  heatTier = null;
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
  document.getElementById('btn-heat-free')?.classList.remove('active');
  document.getElementById('btn-heat-premium')?.classList.remove('active');
  document.getElementById('heat-ctrl-panel').style.display = 'none';
  _showHeatAdjBtn(false);
  _showHeatZoomBanner(false);
}
function _closeFreeHeat() {
  document.getElementById('btn-heat-free')?.classList.remove('active');
}
function _closePremiumHeat() {
  document.getElementById('btn-heat-premium')?.classList.remove('active');
  if(heatLayer && heatTier === 'premium'){ map.removeLayer(heatLayer); heatLayer = null; }
}

// ── 調整ボタン表示制御 ───────────────────────────────
function _showHeatAdjBtn(show) {
  const btn = document.getElementById('btn-heat-adj');
  if(btn) btn.style.display = show ? 'flex' : 'none';
  if(!show) document.getElementById('btn-heat-adj')?.classList.remove('active');
}

// ── パネルトグル（調整ボタン・✕ボタン共用）──────────
function toggleHeatPanel() {
  const panel = document.getElementById('heat-ctrl-panel');
  const btn   = document.getElementById('btn-heat-adj');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn?.classList.toggle('active', !isOpen);
}

// ── パネルUI描画（ONのtierだけ呼ぶ）────────────────
function _renderHeatPanel(tier) {
  const LABELS = { radius: '範囲', blur: 'ぼかし', opacity: '濃さ' };
  const range  = HEAT_PARAMS_RANGE[tier];
  const params = _heatParams[tier];

  // タイトル更新
  const titleEl = document.getElementById('heat-panel-title');
  if(titleEl) titleEl.textContent =
    tier === 'free' ? '🔥 調整（フリー）' : '✨ 調整（プレミアム）';

  // ボディ: 各パラメーター1行
  const body = document.getElementById('heat-panel-body');
  if(body) body.innerHTML = ['radius','blur','opacity'].map(key => {
    const [mn, mx] = range[key];
    const val = params[key];
    return `<div class="heat-param-row">
      <span class="heat-param-label">${LABELS[key]}</span>
      <button class="heat-adj-btn" onclick="_adjHeat('${tier}','${key}',-1)">←</button>
      <span class="heat-param-val" id="hpv-${tier}-${key}">${val}</span>
      <button class="heat-adj-btn" onclick="_adjHeat('${tier}','${key}',+1)">→</button>
      <input type="range" class="heat-param-slider"
        min="${mn}" max="${mx}" value="${val}"
        oninput="_adjHeatSlider('${tier}','${key}',+this.value)"
        id="hps-${tier}-${key}">
    </div>`;
  }).join('');

  // フッター: 💾記憶 📂再現 ↩リセット
  const hasSaved = !!localStorage.getItem(`gm_heat_saved_${tier}`);
  const footer = document.getElementById('heat-panel-footer');
  if(footer) footer.innerHTML = `
    <button class="heat-mem-btn save"  onclick="_saveHeatParams('${tier}')">💾 記憶</button>
    <button class="heat-mem-btn load"  onclick="_loadHeatParams('${tier}')"
      id="hml-${tier}" ${hasSaved ? '' : 'disabled'}>📂 再現</button>
    <button class="heat-mem-btn reset" onclick="_resetHeatParams('${tier}')">↩ リセット</button>`;
}

// ── ←→ 1刻み調整 ────────────────────────────────────
function _adjHeat(tier, key, delta) {
  const [mn, mx] = HEAT_PARAMS_RANGE[tier][key];
  const next = Math.min(mx, Math.max(mn, _heatParams[tier][key] + delta));
  _heatParams[tier][key] = next;
  const el = document.getElementById(`hpv-${tier}-${key}`);
  if(el) el.textContent = next;
  const sl = document.getElementById(`hps-${tier}-${key}`);
  if(sl) sl.value = next;
  if(heatTier === tier) initHeatLayer(tier);
}

// ── シークバー入力 ───────────────────────────────────
function _adjHeatSlider(tier, key, val) {
  const [mn, mx] = HEAT_PARAMS_RANGE[tier][key];
  const next = Math.min(mx, Math.max(mn, parseInt(val)));
  _heatParams[tier][key] = next;
  const el = document.getElementById(`hpv-${tier}-${key}`);
  if(el) el.textContent = next;
  if(heatTier === tier) initHeatLayer(tier);
}

// ── 💾 記憶（localStorage保存）──────────────────────
function _saveHeatParams(tier) {
  try {
    localStorage.setItem(`gm_heat_saved_${tier}`, JSON.stringify(_heatParams[tier]));
    // 再現ボタンを有効化
    const loadBtn = document.getElementById(`hml-${tier}`);
    if(loadBtn) loadBtn.disabled = false;
    // 保存フィードバック（ボタンを一瞬ゴールドに）
    const saveBtn = document.querySelector('.heat-mem-btn.save');
    if(saveBtn){ saveBtn.style.color='var(--gold)'; setTimeout(()=>saveBtn.style.color='',600); }
  } catch(e) { console.warn('[heat] save failed', e); }
}

// ── パネルON時: 保存値があれば_heatParamsに反映（再描画なし）────
function _applyHeatParamsSaved(tier) {
  try {
    const saved = JSON.parse(localStorage.getItem(`gm_heat_saved_${tier}`));
    if(!saved) return;
    _heatParams[tier] = { ..._heatParams[tier], ...saved };
  } catch(e) { console.warn('[heat] applyHeatParamsSaved failed', e); }
}

// ── 📂 再現（localStorage読込）──────────────────────
function _loadHeatParams(tier) {
  try {
    const saved = JSON.parse(localStorage.getItem(`gm_heat_saved_${tier}`));
    if(!saved) return;
    _heatParams[tier] = { ..._heatParams[tier], ...saved };
    _renderHeatPanel(tier);
    if(heatTier === tier) initHeatLayer(tier);
  } catch(e) { console.warn('[heat] load failed', e); }
}

// ── ↩ リセット（デフォルト値に戻す）────────────────
function _resetHeatParams(tier) {
  _heatParams[tier] = { ...HEAT_PARAMS_DEFAULT[tier] };
  _renderHeatPanel(tier);
  if(heatTier === tier) initHeatLayer(tier);
}

// ── Firestore連携用（外部からデータ追加）─────────────
// バッファに蓄積し、heatLayerが存在すれば即時再描画する。
// initHeatLayer()はbuildHeatPoints()経由でバッファを合成するため、
// ボタンON/OFFやパラメーター調整後もデータが消えない。
function addHeatPoints(points) {
  _firebaseHeatPts = _firebaseHeatPts.concat(points);
  if(heatTier) initHeatLayer(heatTier);
}

// ═══════════════════════════════════════════
//  タイル数計算
// ═══════════════════════════════════════════
const JAPAN=L.latLngBounds([24,122],[46,154]);
function lon2x(lon,z){return Math.floor((lon+180)/360*Math.pow(2,z));}
function lat2y(lat,z){return Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2,z));}
function cntTiles(b,zmin,zmax){let n=0;for(let z=zmin;z<=zmax;z++){const x0=lon2x(b.getWest(),z),x1=lon2x(b.getEast(),z),y0=lat2y(b.getNorth(),z),y1=lat2y(b.getSouth(),z);n+=(x1-x0+1)*(y1-y0+1);}return n;}
function ckLayers(){
  // DLダイアログが開いている場合はダイアログ内チェックボックスを参照
  const dlgOpen = document.getElementById('dl-dialog')?.style.display !== 'none';
  const prefix  = dlgOpen ? 'dlg-ck-' : 'ck-';
  return ['std','photo','topo'].filter(k=>document.getElementById(prefix+k)?.checked);
}
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
//  設計:
//    useView系  … 現在表示範囲をそのまま取得するパス
//    drawRect系 … 地図上ドラッグで矩形を引くパス
//    両系は完全独立。互いに干渉しない。
//    「範囲解除」は今アクティブな系だけリセットしてバナーを保持。
//    「キャンセル」で両系クリア＋バナー閉じ＋オフラインタブへ戻る。
// ═══════════════════════════════════════════

// ── 確定済み範囲（DLに使う） ─────────────────────────
let detRect = null;

// ── useView系 ────────────────────────────────────────
// _viewMode    : useView待機中フラグ（true=「範囲決定」でgetBoundsする）
// _viewPreview : 地図上に表示中の薄い矩形レイヤー
// ※ getBounds()はconfirmRect()時に初めて呼ぶ。
//    ボタンを押した瞬間は範囲を固定しない。
let _viewMode    = false;
let _viewPreview = null;

function _clearViewPreview(){
  if(_viewPreview){ map.removeLayer(_viewPreview); _viewPreview=null; }
}

// オフラインタブ内「現在表示範囲」ボタン
function useView(){
  closeOv();
  // drawRect系が動いていれば先に停止（干渉防止）
  if(drawMode) _stopDraw();
  _clearDrawPreview();
  _drawPending = null;

  _viewMode = true;
  document.getElementById('rect-banner-msg').textContent =
    '地図を好きな位置に動かして「範囲決定」を押してください';
  document.getElementById('rect-banner').style.display='block';
  switchTab('map');
}

// ── drawRect系 ───────────────────────────────────────
// drawMode     : ドラッグ受付中フラグ
// _drawStart   : ドラッグ開始latlng
// _drawPending : ドラッグ完了後の確定前bounds
// _drawPreview : 地図上に表示中の薄い矩形レイヤー（ドラッグ中＋完了後）
let drawMode     = false;
let _drawStart   = null;
let _drawPending = null;
let _drawPreview = null;

function _clearDrawPreview(){
  if(_drawPreview){ map.removeLayer(_drawPreview); _drawPreview=null; }
}
function _showDrawPreview(bounds){
  _clearDrawPreview();
  if(bounds){
    _drawPreview = L.rectangle(bounds,{
      color:'#00ffff',weight:2,dashArray:'4 3',
      fillColor:'#00ffff',fillOpacity:.06
    }).addTo(map);
  }
}

// オフラインタブ内「ドラッグ選択」ボタン
function startRectDraw(){
  if(drawMode) return;
  closeOv();
  if(typeof cancelAdd==='function' && typeof addMode!=='undefined' && addMode) cancelAdd();
  // useView系をクリア（干渉防止）
  _viewMode = false;
  _clearViewPreview();

  _enterDrawMode();
  document.getElementById('rect-banner-msg').textContent =
    '地図上をドラッグして範囲を指定してください';
  document.getElementById('rect-banner').style.display='block';
  switchTab('map');
}

// ドラッグモード開始（イベント登録）
function _enterDrawMode(){
  drawMode   = true;
  _drawStart = null;
  document.getElementById('float-ctrl').classList.add('draw-mode-active');
  document.getElementById('float-ctrl-right').classList.add('draw-mode-active');
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  map.getContainer().style.cursor='crosshair';

  // ── マウスイベント ──
  const onDown = e => {
    _drawStart = e.latlng;
    _clearDrawPreview();
  };
  const onMove = e => {
    if(!_drawStart) return;
    _clearDrawPreview();
    _drawPreview = L.rectangle(L.latLngBounds(_drawStart,e.latlng),{
      color:'#00ffff',weight:2,dashArray:'6 3',
      fillColor:'#00ffff',fillOpacity:.08
    }).addTo(map);
  };
  const onUp = e => {
    if(!_drawStart) return;
    const bounds = L.latLngBounds(_drawStart, e.latlng);
    _drawStart = null;
    _stopDraw();                     // イベント解除・カーソル戻す
    _drawPending = bounds;
    _showDrawPreview(_drawPending);  // 確定前プレビューに切替
    document.getElementById('rect-banner-msg').textContent =
      '範囲が選択されました。よろしければ「範囲決定」を押してください';
    document.getElementById('rect-banner').style.display='block';
  };

  // ── タッチイベント（スマホ対応）──
  const _toLL = e => {
    const t = e.touches[0];
    const r = map.getContainer().getBoundingClientRect();
    return map.containerPointToLatLng(L.point(t.clientX-r.left, t.clientY-r.top));
  };
  const onTDown = e => {
    e.preventDefault();
    _drawStart = _toLL(e);
    _clearDrawPreview();
  };
  const onTMove = e => {
    e.preventDefault();
    if(!_drawStart) return;
    _clearDrawPreview();
    _drawPreview = L.rectangle(L.latLngBounds(_drawStart,_toLL(e)),{
      color:'#00ffff',weight:2,dashArray:'6 3',
      fillColor:'#00ffff',fillOpacity:.08
    }).addTo(map);
  };
  const onTUp = e => {
    e.preventDefault();
    if(!_drawStart) return;
    // touchend時はe.touchesが空のためe.changedTouchesを使う
    const t = e.changedTouches[0];
    const r = map.getContainer().getBoundingClientRect();
    const ll = map.containerPointToLatLng(L.point(t.clientX-r.left, t.clientY-r.top));
    const bounds = L.latLngBounds(_drawStart, ll);
    _drawStart = null;
    _stopDraw();
    _drawPending = bounds;
    _showDrawPreview(_drawPending);
    document.getElementById('rect-banner-msg').textContent =
      '範囲が選択されました。よろしければ「範囲決定」を押してください';
    document.getElementById('rect-banner').style.display='block';
  };

  // ハンドラを_reにまとめて保持（_stopDrawで使う）
  map._re = {onDown,onMove,onUp,onTDown,onTMove,onTUp};
  map.on('mousedown',onDown).on('mousemove',onMove).on('mouseup',onUp);
  const mc = map.getContainer();
  mc.addEventListener('touchstart', onTDown, {passive:false});
  mc.addEventListener('touchmove',  onTMove, {passive:false});
  mc.addEventListener('touchend',   onTUp,   {passive:false});
}

// ドラッグモード停止（イベント解除・カーソル戻す・フラグリセット）
// ※ _drawPending / _drawPreview は触らない
function _stopDraw(){
  drawMode   = false;
  _drawStart = null;
  map.dragging.enable();
  map.scrollWheelZoom.enable();
  map.getContainer().style.cursor='';
  document.getElementById('float-ctrl').classList.remove('draw-mode-active');
  document.getElementById('float-ctrl-right').classList.remove('draw-mode-active');
  const e = map._re;
  if(e){
    map.off('mousedown',e.onDown).off('mousemove',e.onMove).off('mouseup',e.onUp);
    const mc = map.getContainer();
    mc.removeEventListener('touchstart', e.onTDown);
    mc.removeEventListener('touchmove',  e.onTMove);
    mc.removeEventListener('touchend',   e.onTUp);
    map._re = null;
  }
}

// ── 共通: 範囲決定 ───────────────────────────────────
// _viewMode=true  → その時点のmap.getBounds()を取得して確定
// _drawPending    → ドラッグ完了済みboundsを確定
function confirmRect(){
  let pending = null;
  if(_viewMode){
    pending   = map.getBounds(); // 決定時点の表示範囲を取得
    _viewMode = false;
    _clearViewPreview();
  } else if(_drawPending){
    pending = _drawPending;
  }
  if(!pending) return;
  // ドラッグ中に決定ボタンを押した場合も安全に止める
  if(drawMode) _stopDraw();
  detRect      = pending;
  _drawPending = null;
  // バナーを閉じてタブへ
  document.getElementById('rect-banner').style.display='none';
  document.getElementById('rect-info').innerHTML=
    `北: <b>${detRect.getNorth().toFixed(3)}</b>　南: <b>${detRect.getSouth().toFixed(3)}</b><br>`+
    `西: <b>${detRect.getWest().toFixed(3)}</b>　東: <b>${detRect.getEast().toFixed(3)}</b>`;
  document.getElementById('btn-clearrect').style.display='inline-flex';
  updDetEst();
  _openTab('offline');
  _pushHistory();
}

// ── 共通: 範囲解除 ───────────────────────────────────
// 今アクティブな系だけリセット。バナーは保持。
// drawRect系 → 再ドラッグ待ちに戻す
// useView系  → フラグだけ落とす（地図はそのまま動かせる）
function cancelRect(){
  if(_drawPending || drawMode){
    // drawRect系をリセット → 再ドラッグ待ちに戻す
    if(drawMode) _stopDraw();
    _drawPending = null;
    _clearDrawPreview();
    _enterDrawMode();
    document.getElementById('rect-banner-msg').textContent =
      'もう一度ドラッグして範囲を指定してください';
  } else if(_viewMode){
    // useView系をリセット → 地図を動かして再度「範囲決定」を促す
    _viewMode = false;
    _clearViewPreview();
    document.getElementById('rect-banner-msg').textContent =
      '地図を動かして「範囲決定」を押してください（表示範囲がそのまま確定します）';
  }
  // バナーはそのまま保持
}

// ── 共通: キャンセル ─────────────────────────────────
// 両系を完全クリア・バナー閉じ・オフラインタブへ戻る
function cancelRectAll(){
  if(drawMode) _stopDraw();
  _drawPending = null;
  _viewMode    = false;
  _clearDrawPreview();
  _clearViewPreview();
  document.getElementById('rect-banner').style.display='none';
  _openTab('offline');
  _pushHistory();
}

// ── タブ内「選択済み範囲を表示」────────────────────────
// 確定済みのdetRectをviewPreviewで地図に表示する
function showRect(){
  _clearViewPreview();
  _clearDrawPreview();
  if(detRect){
    _viewPreview = L.rectangle(detRect,{
      color:'#00ffff',weight:2,dashArray:'4 3',
      fillColor:'#00ffff',fillOpacity:.06
    }).addTo(map);
  }
}

// ── タブ内「範囲をクリア」────────────────────────────
// 確定済みdetRectを削除してUIをリセットする
function clearRect(){
  if(drawMode) _stopDraw();
  detRect      = null;
  _drawPending = null;
  _viewMode    = false;
  _clearDrawPreview();
  _clearViewPreview();
  document.getElementById('rect-banner').style.display='none';
  document.getElementById('rect-info').textContent='範囲: 未選択';
  document.getElementById('btn-clearrect').style.display='none';
  document.getElementById('btn-dldet').disabled=true;
  document.getElementById('det-est').textContent='— 範囲を選択してください —';
}

// finishDraw: 外部（Escapeキー等）から呼ばれる互換ラッパー
function finishDraw(){ if(drawMode) _stopDraw(); }

// ═══════════════════════════════════════════
//  地図上DLダイアログ（ウィザード式・3STEP）
//  STEP1: 範囲選択（useView / drawRect）
//  STEP2: レイヤー・ズーム設定
//  STEP3: DL進捗
// ═══════════════════════════════════════════

let _dldStep   = 1;       // 現在のSTEP（1〜3）
let _dldMode   = 'view';  // 'view' | 'draw'
let _dldType   = 'detail';// 'detail' | 'base'
let _dldBounds = null;    // STEP1で確定したbounds

// ── ダイアログ開く ──────────────────────────────────────
function openDlDialog(){
  // プレミアムチェック（既存ゲートを流用）
  isPremiumUser().then(premium=>{
    if(!premium){ showPremiumGate('offline'); return; }
    _dldStep   = 1;
    _dldBounds = null;
    _dldMode   = 'view';
    _dldType   = 'detail';
    _dldRenderStep(1);
    document.getElementById('dl-dialog').style.display = 'block';
    // 地図タブに切り替え（地図が見える状態で操作）
    _openTab('map');
    _pushHistory();
  });
}

// ── ダイアログ閉じる ────────────────────────────────────
function _dldClose(){
  document.getElementById('dl-dialog').style.display = 'none';
  // drawMode中なら停止
  if(drawMode) _stopDraw();
  _clearDrawPreview();
  _clearViewPreview();
  _dldBounds = null;
}

// ── キャンセル ──────────────────────────────────────────
function _dldCancel(){
  _dldClose();
  _openTab('offline');
  _pushHistory();
}

// ── ステップ描画 ────────────────────────────────────────
function _dldRenderStep(step){
  _dldStep = step;
  // パネル切替
  ['dld-s1','dld-s2','dld-s3'].forEach((id,i)=>{
    document.getElementById(id).style.display = (i+1===step) ? 'block' : 'none';
  });
  // インジケーター更新
  [1,2,3].forEach(n=>{
    const el = document.getElementById('dld-si-'+n);
    el.classList.toggle('active', n===step);
    el.classList.toggle('done',   n<step);
  });
  // STEP1初期化
  if(step===1){
    _dldApplyMode(_dldMode);
  }
  // STEP2初期化
  if(step===2){
    _dldSetType(_dldType);
    _dldUpdEst();
  }
}

// ── STEP1: モード切替（viewタブ / drawタブ） ────────────
function _dldSelectMode(mode){
  _dldMode = mode;
  document.getElementById('dld-tab-view').classList.toggle('active', mode==='view');
  document.getElementById('dld-tab-draw').classList.toggle('active', mode==='draw');
  _dldApplyMode(mode);
}

function _dldApplyMode(mode){
  document.getElementById('dld-mode-view').style.display = mode==='view' ? 'block' : 'none';
  document.getElementById('dld-mode-draw').style.display = mode==='draw' ? 'block' : 'none';
  if(mode==='draw'){
    // ドラッグ選択モード開始（既存ロジック流用）
    if(!drawMode){
      _clearViewPreview();
      _enterDrawMode();
      // ドラッグ完了を検知してダイアログのOKボタンを有効化
      _dldWatchDrawComplete();
    }
    document.getElementById('dld-draw-hint').textContent='地図上をドラッグして範囲を指定してください';
    document.getElementById('dld-draw-ok').disabled = true;
  } else {
    // drawモード中なら停止
    if(drawMode){ _stopDraw(); _clearDrawPreview(); }
    _dldBounds = null;
  }
}

// ドラッグ完了を監視（_drawPendingがセットされたらOKボタンを有効化）
function _dldWatchDrawComplete(){
  const timer = setInterval(()=>{
    if(!document.getElementById('dl-dialog') ||
       document.getElementById('dl-dialog').style.display==='none'){
      clearInterval(timer); return;
    }
    if(_drawPending){
      clearInterval(timer);
      document.getElementById('dld-draw-hint').textContent='範囲が選択されました。「選択範囲を確定」を押してください';
      document.getElementById('dld-draw-ok').disabled = false;
    }
  }, 200);
}

// ── STEP1: 確定（view系） ───────────────────────────────
function _dldConfirmView(){
  _dldBounds = map.getBounds();
  _showViewPreview(_dldBounds);
  _dldRenderStep(2);
}

// ── STEP1: 確定（draw系） ───────────────────────────────
function _dldConfirmDraw(){
  if(!_drawPending) return;
  _dldBounds = _drawPending;
  _drawPending = null;
  _showDrawPreview(_dldBounds);
  _dldRenderStep(2);
}

// ── STEP1に戻る ──────────────────────────────────────────
function _dldBack(toStep){
  _clearDrawPreview();
  _clearViewPreview();
  if(drawMode) _stopDraw();
  _drawPending = null;
  _dldBounds   = null;
  _dldRenderStep(toStep);
}

// ── STEP2: DL種別切替 ──────────────────────────────────
function _dldSetType(type){
  _dldType = type;
  document.getElementById('dld-tab-det').classList.toggle('active',  type==='detail');
  document.getElementById('dld-tab-base').classList.toggle('active', type==='base');
  document.getElementById('dld-zoom-det').style.display  = type==='detail' ? 'block' : 'none';
  document.getElementById('dld-zoom-base').style.display = type==='base'   ? 'block' : 'none';
  _dldUpdEst();
}

// ── STEP2: タイル数推定 ────────────────────────────────
function _dldUpdEst(){
  const layers = ['std','photo','topo'].filter(k=>
    document.getElementById('dlg-ck-'+k)?.checked
  );
  const L2 = layers.length || 1;
  let n = 0, txt = '';
  if(_dldType==='detail'){
    if(_dldBounds){
      const zmin = parseInt(document.getElementById('dlg-det-zmin').value);
      const zmax = parseInt(document.getElementById('dlg-det-zmax').value);
      n = cntTiles(_dldBounds, zmin, zmax) * L2;
      txt = `Z${zmin}〜Z${zmax}、<b>${fmt(n)}</b>（約 <b>${mbEst(n)} MB</b>）`;
    } else {
      txt = '— 範囲が選択されていません —';
    }
  } else {
    const zmax = parseInt(document.getElementById('dlg-base-zmax').value);
    n = cntTiles(JAPAN, 5, zmax) * L2;
    txt = `Z5〜Z${zmax}、<b>${fmt(n)}</b>（約 <b>${mbEst(n)} MB</b>）`;
  }
  document.getElementById('dld-est').innerHTML = txt;
}

// ── STEP2: DL開始 ──────────────────────────────────────
function _dldStartDl(){
  // ダイアログ内のIDを既存startDl()が読むIDに同期
  const syncCk = k =>{
    const src = document.getElementById('dlg-ck-'+k);
    const dst = document.getElementById('ck-'+k);
    if(src && dst) dst.checked = src.checked;
  };
  ['std','photo','topo'].forEach(syncCk);

  if(_dldType==='detail'){
    // detRectに確定
    detRect = _dldBounds;
    const zmin = parseInt(document.getElementById('dlg-det-zmin').value);
    const zmax = parseInt(document.getElementById('dlg-det-zmax').value);
    // ズーム値をダミーselectに反映
    const setOpt = (id, val) => {
      const el = document.getElementById(id);
      if(el){ [...el.options].forEach(o=>{ o.selected = (o.value===String(val)); }); }
    };
    setOpt('det-zmin', zmin);
    setOpt('det-zmax', zmax);
  } else {
    const zmax = parseInt(document.getElementById('dlg-base-zmax').value);
    const setOpt = (id, val) => {
      const el = document.getElementById(id);
      if(el){ [...el.options].forEach(o=>{ o.selected = (o.value===String(val)); }); }
    };
    setOpt('base-zmax', zmax);
  }

  _dldRenderStep(3);
  // ログ出力先をダイアログ内に切替
  _dldLog('DL開始...');
  startDl(_dldType);
}

// ── STEP3: ログ出力（startDl内のlog()がdl-logに書くため別途ミラー） ──
function _dldLog(msg){
  const el = document.getElementById('dld-log');
  if(el){ el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
}

// DL進捗をダイアログ内バーに同期（startDl内のtick()から呼ばれる想定）
// tick()はui.js内にあるため、進捗バーIDをダイアログ内のIDに加えて更新する
function _dldSyncProgress(done, total, mb){
  const pct = total>0 ? Math.round(done/total*100) : 0;
  const doneEl = document.getElementById('dld-pb-done');
  const totEl  = document.getElementById('dld-pb-tot');
  const barEl  = document.getElementById('dld-pb-bar');
  const mbEl   = document.getElementById('dld-pb-mb');
  if(doneEl) doneEl.textContent = fmt(done);
  if(totEl)  totEl.textContent  = fmt(total);
  if(barEl)  barEl.style.width  = pct+'%';
  if(mbEl)   mbEl.textContent   = mb+' MB';
}

// ── DL完了・停止時にダイアログに「閉じる」ボタンを出す ──
function _dldShowDone(stopped){
  const btns = document.getElementById('dld-dl-btns');
  if(!btns) return;
  btns.innerHTML = stopped
    ? `<button class="btn sm" onclick="_dldCancel()">閉じる</button>`
    : `<button class="btn accent" onclick="_dldCancel()">✅ 完了・閉じる</button>`;
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
  // 進捗バー表示（オフラインタブ・設定タブ）
  const _pbEl = document.getElementById('dl-progress-bar');
  const _cfgEl = document.getElementById('cfg-dl-progress-bar');
  if(_pbEl) _pbEl.style.display='block';
  if(_cfgEl) _cfgEl.style.display='block';

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
    // ミラーバー同期（オフラインタブ内）
    const _pbd=document.getElementById('dl-pb-done'); if(_pbd) _pbd.textContent=fmt(done);
    const _pbt=document.getElementById('dl-pb-tot');  if(_pbt) _pbt.textContent=fmt(total);
    const _pbm=document.getElementById('dl-pb-mb');   if(_pbm) _pbm.textContent=mbEst(done)+' MB';
    const _pbb=document.getElementById('dl-pb-bar');  if(_pbb) _pbb.style.width=pct+'%';
    // DLダイアログ内バー同期
    if(typeof _dldSyncProgress==='function') _dldSyncProgress(done,total,mbEst(done));
    // DLダイアログ内ログミラー
    const _dlog=document.getElementById('dld-log');
    if(_dlog&&done%200===0){
      _dlog.textContent=`完了: ${fmt(done)} / ${fmt(total)}  失敗: ${fail}\n`+_dlog.textContent;
      _dlog.textContent=_dlog.textContent.split('\n').slice(0,20).join('\n');
    }
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
  // 進捗バー非表示
  const _pbElEnd = document.getElementById('dl-progress-bar');
  const _cfgElEnd = document.getElementById('cfg-dl-progress-bar');
  if(_pbElEnd) _pbElEnd.style.display='none';
  if(_cfgElEnd) _cfgElEnd.style.display='none';
  if(!dlStop){
    // 完了したらレジューム削除
    deleteResume();
    document.getElementById('resume-banner').classList.remove('show');
    log('✅ 完了！ '+fmt(done)+'枚保存（失敗: '+fail+'）');
    if(typeof _dldShowDone==='function') _dldShowDone(false);
  } else {
    log('⏸ 停止しました。続きから再開できます。');
    checkResume(); // バナー更新
    if(typeof _dldShowDone==='function') _dldShowDone(true);
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
const SHEETS={pts:'pt-sheet', offline:'dl-sheet', cfg:'cfg-sheet', community:'comm-sheet'};

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
  ['map','pts','offline','cfg','community'].forEach(t=>{
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
//  設計:
//    タブを開く時にpushして「戻れる状態」を作る
//    バック① ダイアログ閉じる
//    バック② シート閉じる（タブを開いた時のpushに対応）
//    バック③ 終了確認ダイアログ
// ═══════════════════════════════════════════
let _exitDlgOpen = false;

(function initHistory(){
  // [0]ベース [1]アプリ の2エントリを積む
  // バックで[1]→[0]になった時にpopstateを受け取り処理後に[1]を再生成
  history.replaceState({appBack:true}, '');
  history.pushState({appBack:true}, '');
})();

function _pushHistory(){
  history.pushState({appBack:true}, '');
}

window.addEventListener('popstate', function(e){
  // ① overlayダイアログが開いているなら閉じる
  const ov = document.getElementById('overlay');
  if(ov && ov.classList.contains('open')){
    closeOv();
    _pushHistory();
    return;
  }

  // ② 終了確認ダイアログが開いているなら閉じる
  if(_exitDlgOpen){
    _closeExitDlgOnly();
    _pushHistory();
    return;
  }

  // ③ シートが開いているなら閉じる
  if(curTab !== 'map'){
    _openTab('map');
    // pushしない→次のバックは④終了ダイアログへ
    return;
  }

  // ④ 地図表示中 → 終了確認ダイアログ
  _showExitDlg();
});

function _showExitDlg(){
  _exitDlgOpen = true;
  document.getElementById('exit-overlay').style.display = 'flex';
  _pushHistory(); // バックで閉じられるようにpush
}
function _closeExitDlgOnly(){
  _exitDlgOpen = false;
  document.getElementById('exit-overlay').style.display = 'none';
}
function closeExitDlg(){
  _closeExitDlgOnly();
  _pushHistory(); // キャンセル後も次のバックに備えてpush
}
function doExitApp(){
  _closeExitDlgOnly();
  try { window.close(); } catch(e){}
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
//   ・community → 初期化
//   ・map以外へ → _pushHistory()でバック用エントリを積む
(function(){
  const _orig = switchTab;
  switchTab = function(tab){
    if(tab === 'offline'){
      // offlineタブはプレミアムチェックなしで直接開く
      // DL操作はタブ内「DL開始」ボタン→openDlDialog()でゲートチェック
      const wasMap2 = (curTab === 'map');
      _openTab(tab);
      if(wasMap2) _pushHistory();
      return;
    }
    const wasMap = (curTab === 'map');
    _orig(tab);
    if(tab === 'community'){
      if(typeof initCommunity === 'function') initCommunity();
      if(typeof _buildTagSelector === 'function') _buildTagSelector();
    }
    // 地図→シートへの切替時のみpush
    if(wasMap && tab !== 'map') _pushHistory();
  };
})();

// ═══════════════════════════════════════════
//  設定タブ アコーディオン
// ═══════════════════════════════════════════
function toggleCfgAccordion(header) {
  const body  = header.nextElementSibling;
  const arrow = header.querySelector('.cfg-accordion-arrow');
  const isOpen = body.classList.contains('open');
  if (isOpen) {
    body.classList.remove('open');
    if (arrow) arrow.textContent = '▶';
  } else {
    body.classList.add('open');
    if (arrow) arrow.textContent = '▼';
  }
}

// ─── コミュニティ掲示板アコーディオン ───
function toggleCommAccordion(header) {
  const body  = header.nextElementSibling;
  const arrow = header.querySelector('.comm-accordion-arrow');
  const isOpen = body.classList.contains('open');
  if (isOpen) {
    body.classList.remove('open');
    if (arrow) arrow.textContent = '▶';
  } else {
    body.classList.add('open');
    if (arrow) arrow.textContent = '▼';
  }
}

// 起動