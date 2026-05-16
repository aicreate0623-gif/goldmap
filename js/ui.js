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
function buildHeatPoints(tier) {
  const pts = [];
  for (const d of GSJ_MINE_DATA) {
    if (d.mat !== 'Au_Ag') continue;
    pts.push([d.lat, d.lng, d.trace ? 0.3 : 0.5]);
  }
  for (const m of MINES) pts.push([m.lat, m.lng, 0.8]);
  // PRO tierのみFirebaseデータを合成（フリー版には混入させない）
  if (tier === 'premium') {
    for (const p of _firebaseHeatPts) pts.push([p.lat, p.lng, p.weight ?? 1.0]);
  }
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
  const raw    = buildHeatPoints(tier);
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
    _showHeatZoomBanner(true, heatTier, z);
  } else {
    _showHeatZoomBanner(false);
    initHeatLayer(heatTier);
  }
});

// ── プレミアム誘導バナー ──────────────────────────────
function _showHeatZoomBanner(show, tier, z){
  let b = document.getElementById('heat-zoom-banner');
  if(show){
    let msg, btnHtml;
    if(tier === 'free'){
      const premiumMax = TIER_CFG.premium.zoomMax; // 13
      if(z <= premiumMax){
        // Z10〜13: PRO版なら見れる
        msg = '🔒 Z' + z + ' はPRO版で閲覧できます';
        btnHtml = '';
      } else {
        // Z14以上: PRO版でも範囲外
        msg = '⚠ この拡大率はどのプランでも表示範囲外です';
        btnHtml = '';
      }
    } else {
      // premium tier
      msg = '⚠ この拡大率は表示範囲外です';
      btnHtml = '';
    }
    if(!b){
      b = document.createElement('div');
      b.id = 'heat-zoom-banner';
      b.style.cssText = 'position:fixed;top:calc(var(--sb-h, 30px) + 8px + 89px + 16px);left:50%;transform:translateX(-50%);z-index:1050;background:rgba(0,0,0,0.88);border:1px solid var(--gold);border-radius:20px;padding:7px 16px;font-size:12px;color:var(--txt);white-space:nowrap;pointer-events:auto;display:flex;align-items:center;gap:4px;';
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

// ── 分布PRO フロートボタン → 全ての入り口 ──────────────
async function toggleHeatPremium() {
  // 既にPRO起動中なら→OFFにする
  if (heatTier === 'premium') {
    _heatAllOff();
    return;
  }
  await openHeatProGate();
}

async function openHeatProGate() {
  const premium  = await isPremiumUser();
  const contribOn = isContribOn();
  const hasPts   = (typeof pts !== 'undefined') && pts.length >= 1;

  const icon  = document.getElementById('heatpro-gate-icon');
  const title = document.getElementById('heatpro-gate-title');
  const body  = document.getElementById('heatpro-gate-body');
  const btns  = document.getElementById('heatpro-gate-btns');

  const CLOSE_BTN = '<button class="dbtn" onclick="closeOv()">閉じる</button>';
  const TO_SETTINGS_BTN =
    '<button class="dbtn ok" onclick="closeOv();switchTab(\'settings\');setTimeout(()=>{const a=document.getElementById(\'contrib-accordion\');if(a){const h=a.querySelector(\'.cfg-accordion-header\');if(h&&!a.classList.contains(\'open\'))h.click();}},150)">設定で投稿ONにする →</button>';

  // ── ① 非プレミアム（投稿ON/OFF・ポイント問わず）──────
  if (!premium) {
    icon.textContent  = '🔒';
    title.textContent = '分布PROはプレミアム限定です';
    body.innerHTML =
      '<p>匿名投稿を元に集計しAIによってつくられた高精度ヒートマップです。</p>' +
      '<p>分布PROはプレミアム会員専用コンテンツになります。</p>';
    btns.innerHTML =
      CLOSE_BTN +
      '<button class="dbtn ok premium-cta" onclick="closeOv();startPurchaseFlow()">プレミアムへアップグレード</button>';
    showDlg('dlg-heatpro-gate');
    return;
  }

  // ── ② プレミアム・投稿OFF ────────────────────────────
  if (!contribOn) {
    icon.textContent  = '📍';
    title.textContent = '投稿をONにして下さい';
    body.innerHTML =
      '<p>ご利用いただくには投稿を1件以上して頂く必要があります。</p>' +
      '<p>ぜひ、投稿をONにしてヒートマップ作製にご協力頂き、高精度のヒートマップPROをご利用ください。</p>';
    btns.innerHTML = CLOSE_BTN + TO_SETTINGS_BTN;
    showDlg('dlg-heatpro-gate');
    return;
  }

  // ── ③ プレミアム・投稿ON・ポイント0件 ───────────────
  if (!hasPts) {
    icon.textContent  = '📍';
    title.textContent = 'ポイントを登録してください';
    body.innerHTML =
      '<p>ポイントを1件以上登録することで分布PROをご使用いただけます。</p>';
    btns.innerHTML = CLOSE_BTN;
    showDlg('dlg-heatpro-gate');
    return;
  }

  // ── ④ プレミアム・投稿ON・ポイント1件以上 → PRO起動 ──
  closeOv();
  _closeFreeHeat();
  heatTier = 'premium';
  document.getElementById('btn-heat-premium').classList.add('active');
  _applyHeatParamsSaved('premium');
  _renderHeatPanel('premium');
  _showHeatAdjBtn(true);
  initHeatLayer('premium');
  // heatmap.json未取得の場合のみfetch（重複取得防止）
  if (_firebaseHeatPts.length === 0) {
    fetchHeatPoints().catch(e => console.warn('[heatpro] fetchHeatPoints失敗', e));
  }
}

// ── 内部: 全OFF ──────────────────────────────────────
function _heatAllOff() {
  heatTier = null;
  _firebaseHeatPts = [];  // PROデータをクリア（フリー版への混入防止）
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
  _firebaseHeatPts = [];  // PROデータをクリア
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
//  キャッシュ情報
// ═══════════════════════════════════════════
// refreshCache は cache.js の完全版（renderSessionList含む）を使用
// ここでは上書きしない
async function clearCache(){
  if(!confirm('キャッシュを全て削除しますか？'))return;
  await dbClr(); refreshCache(); showAlert('完了','キャッシュを削除しました');
}

// ═══════════════════════════════════════════
//  タブ切替
// ═══════════════════════════════════════════
let curTab='map';
const SHEETS={pts:'pt-sheet', offline:'dl-sheet', cfg:'cfg-sheet', community:'comm-sheet', mymap:'mymap-sheet'};

function switchTab(tab){
  _openTab(tab);
}

function _openTab(tab){
  // mapタブを離れる際にエリア確認の矩形プレビューを削除
  if(tab !== 'map' && typeof _sessRectLayer !== 'undefined' && _sessRectLayer){
    map.removeLayer(_sessRectLayer); _sessRectLayer = null;
  }
  // 前のタブのシートを閉じる
  if(curTab!=='map' && SHEETS[curTab]){
    document.getElementById(SHEETS[curTab]).classList.remove('open');
  }
  // 全アコーディオンを閉じる
  document.querySelectorAll('.cfg-accordion-body.open').forEach(body => {
    body.classList.remove('open');
    const arrow = body.previousElementSibling?.querySelector('.cfg-accordion-arrow');
    if(arrow) arrow.textContent = '▶';
  });
  curTab=tab;
  // タブボタンのアクティブ状態
  ['map','pts','offline','cfg','community'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
  });
  // シートを開く / mapタブは地図サイズを再計算
  if(tab==='map'){
    setTimeout(()=>map.invalidateSize({pan:false}),320);
  } else if(SHEETS[tab]){
    document.getElementById(SHEETS[tab]).classList.add('open');
    setTimeout(()=>map.invalidateSize(),300);
  }
}

// ═══════════════════════════════════════════
//  ダイアログ
// ═══════════════════════════════════════════
const DLGS=['dlg-edit','dlg-savecf','dlg-detail','dlg-del','dlg-imp2','dlg-alr','dlg-contrib-off','dlg-premium-gate','dlg-heatpro-gate','dlg-gps-lost','dlg-cl-edit','dlg-cl-delete','dlg-cl-point-edit','dlg-cl-point-del','dlg-gold','dlg-cfg-heatmap','dlg-cfg-mine','dlg-cfg-wiki','dlg-cfg-kinno','dlg-cfg-geology','dlg-cfg-mineral','dlg-cfg-disclaimer'];
function showDlg(id){
  DLGS.forEach(d=>document.getElementById(d).style.display='none');
  document.getElementById(id).style.display='block';
  document.getElementById('overlay').classList.add('open');
  // ヒートマップ投稿ダイアログを開く際はtoggle UIを最新状態に更新
  if (id === 'dlg-cfg-heatmap') _updateContribUI();
}
function closeOv(){document.getElementById('overlay').classList.remove('open');DLGS.forEach(d=>document.getElementById(d).style.display='none');eid=null;}
function showAlert(ttl,msg){document.getElementById('alr-ttl').textContent=ttl;document.getElementById('alr-msg').textContent=msg;showDlg('dlg-alr');}

// ═══════════════════════════════════════════
//  ヒートマップ投稿 contrib トグル
// ═══════════════════════════════════════════
const CONTRIB_KEY = 'gm_contrib_on';

/** 投稿協力フラグを取得 */
function isContribOn() {
  return localStorage.getItem(CONTRIB_KEY) === '1';
}

/** 投稿協力フラグを設定 */
function _setContribOn(val) {
  localStorage.setItem(CONTRIB_KEY, val ? '1' : '0');
}

/** トグルボタンUIを現在の状態に合わせて更新（ダイアログを閉じない） */
function _updateContribUI() {
  const on = isContribOn();
  // ダイアログ内トグル
  const btn = document.getElementById('contrib-toggle-cfg');
  if (btn) btn.classList.toggle('on', on);
  // ステータスラベル
  const lbl = document.getElementById('contrib-status-lbl');
  if (lbl) lbl.textContent = '現在: ' + (on ? 'ON' : 'OFF');
}

/** ダイアログ内トグルボタン押下ハンドラ */
function onContribToggle() {
  const next = !isContribOn();
  _setContribOn(next);
  _updateContribUI();
}

// DOMContentLoaded後にcontrib UIを初期状態に合わせる
document.addEventListener('DOMContentLoaded', () => {
  _updateContribUI();
});

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
  // ① move-bannerが表示中ならキャンセル処理
  const mvBanner = document.getElementById('move-banner');
  if(mvBanner && mvBanner.classList.contains('show')){
    if(typeof cancelMovePin === 'function') cancelMovePin();
    _pushHistory();
    return;
  }

  // ② overlayダイアログが開いているなら閉じる
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
      isPremiumUser().then(premium=>{
        if(!premium){ showPremiumGate('offline'); return; }
        const wasMap2 = (curTab === 'map');
        _openTab(tab);
        if(wasMap2) _pushHistory();
      });
      return;
    }
    if(tab === 'mymap'){
      isPremiumUser().then(premium=>{
        if(!premium){ showPremiumGate('mymap'); return; }
        const wasMapM = (curTab === 'map');
        _orig(tab);
        if(wasMapM) _pushHistory();
      });
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
// ═══════════════════════════════════════════
//  汎用トースト（points.js等から使用）
// ═══════════════════════════════════════════
let _showToastTimer = null;
function showToast(msg, duration) {
  duration = duration || 2500;
  let el = document.getElementById('ui-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ui-toast';
    el.style.cssText =
      'position:fixed;top:calc(var(--sb-h, 30px) + 8px + 89px + 16px);left:50%;transform:translateX(-50%);' +
      'background:rgba(30,20,10,0.92);border:1px solid var(--gold);color:var(--txt);' +
      'padding:8px 18px;border-radius:20px;font-size:12px;z-index:2000;pointer-events:none;' +
      'white-space:nowrap;backdrop-filter:blur(8px);opacity:0;transition:opacity 0.2s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_showToastTimer);
  _showToastTimer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}
// ── キャッシュ診断 ────────────────────────────────────
async function diagCache(){
  const out = document.getElementById('diag-out');
  if(!out) return;
  out.textContent = '🔍 診断中…';

  const lines = [];

  // 1) db初期化チェック
  if(typeof db === 'undefined' || !db){
    out.textContent = '❌ IndexedDB未初期化（db=null）\nキャッシュは保存されていません。';
    return;
  }
  lines.push('✅ IndexedDB: 初期化済み');

  // 2) タイル総数
  try{
    const cnt = await dbCnt();
    lines.push(`📦 保存タイル総数: ${cnt} 枚`);
    if(cnt === 0){
      lines.push('⚠️ タイルが1枚も保存されていません！');
      lines.push('→ ダウンロードが正常に完了していない可能性があります。');
      out.textContent = lines.join('\n');
      return;
    }
  } catch(e){
    lines.push('❌ タイル数取得失敗: ' + e.message);
    out.textContent = lines.join('\n');
    return;
  }

  // 3) 現在地周辺のタイルキーをサンプルチェック
  const z = map.getZoom();
  const center = map.getCenter();
  const n = Math.pow(2, z);
  const tx = Math.floor((center.lng + 180) / 360 * n);
  const ty = Math.floor(
    (1 - Math.log(Math.tan(center.lat * Math.PI/180) + 1/Math.cos(center.lat * Math.PI/180)) / Math.PI)
    / 2 * n
  );

  lines.push(`📍 現在地タイル: Z${z} / X${tx} / Y${ty}`);
  lines.push(`📡 navigator.onLine: ${navigator.onLine}`);

  // 4) レイヤー別キャッシュ確認 + 最大ズーム表示
  const layers = ['photo','std','topo','hill','relief'];
  for(const lk of layers){
    const maxZ = (typeof getMaxCachedZoom==='function') ? getMaxCachedZoom(lk) : '?';
    try{
      const key = lk+'/'+z+'/'+tx+'/'+ty;
      const val = await dbGet(key);
      if(val){
        lines.push(`✅ ${lk}: キャッシュあり（${(val.byteLength/1024).toFixed(1)}KB）最大Z=${maxZ}`);
      } else {
        lines.push(`❌ ${lk}: キャッシュなし（key=${key}）最大Z=${maxZ}`);
      }
    } catch(e){
      lines.push(`❌ ${lk}: 取得エラー（${e.message}）`);
    }
  }

  // 5) セッション一覧
  try{
    const sessions = await dbGetAllSess();
    lines.push(`\n💾 DLセッション数: ${sessions.length} 件`);
    sessions.forEach(s=>{
      const mb = ((s.totalSize||0)/1024/1024).toFixed(1);
      const keys = (s.tileKeys||[]).length;
      lines.push(`  [${s.mode||'?'}] ${s.label||'名称未設定'} - ${mb}MB / ${keys}キー / zmax=${s.zmax||'?'}`);
    });
  } catch(e){
    lines.push('❌ セッション取得失敗: ' + e.message);
  }

  out.textContent = lines.join('\n');
}
// ═══════════════════════════════════════════
//  フロートボタン 折りたたみ制御
// ═══════════════════════════════════════════

// ── ドット定義（ボタンID → グループカラークラス）──
const FC_LEFT_BTNS = [
  { id:'btn-std',          cls:'on-gold'   },
  { id:'btn-hill',         cls:'on-gold'   },
  { id:'btn-relief',       cls:'on-gold'   },
  { id:'btn-geo',          cls:'on-gold'   },
  { id:'btn-photo',        cls:'on-gold'   },
  { id:'btn-topo',         cls:'on-gold'   },
  { id:'btn-heat-free',    cls:'on-orange' },
  { id:'btn-heat-premium', cls:'on-orange' },
];
const FC_RIGHT_BTNS = [
  { id:'btn-mypts',        cls:'on-purple' },
  { id:'btn-custom-layer', cls:'on-purple' },
  { id:'btn-bear',         cls:'on-teal'   },
  { id:'btn-water',        cls:'on-teal'   },
  { id:'btn-mine',         cls:'on-amber'  },
  { id:'btn-gsj',          cls:'on-amber'  },
  { id:'btn-wiki',         cls:'on-amber'  },
  { id:'btn-kinno',        cls:'on-amber'  },
  { id:'btn-gps',          cls:'on-blue'   },
  { id:'btn-flw',          cls:'on-blue'   },
];

function _isActive(id) {
  const el = document.getElementById(id);
  if (!el || el.style.display === 'none') return false;
  return el.classList.contains('active') || el.classList.contains('base-active');
}

function _buildBarDots(bar, btns) {
  bar.innerHTML = '';
  btns.forEach(b => {
    if (b.spacer) {
      const sp = document.createElement('div');
      sp.className = 'fc-bar-spacer';
      bar.appendChild(sp);
      return;
    }
    const dot = document.createElement('div');
    dot.className = 'fc-bar-dot' + (_isActive(b.id) ? ' ' + b.cls : '');
    bar.appendChild(dot);
  });
}

// ── transformユーティリティ ──
function _setTransform(el, val, animate) {
  el.classList.toggle('fc-snap', animate);
  el.classList.remove('fc-intro');
  el.style.transform = val;
}

// ── 左セット 収納/展開 ──
let _fcLeftOpen = true;

function _fcLeftHide(animate) {
  _fcLeftOpen = false;
  const elL = document.getElementById('float-ctrl-left');
  const elC = document.getElementById('float-ctrl');
  // 収納完了後に display:none & バー表示
  const onEnd = () => {
    elL.removeEventListener('transitionend', onEnd);
    elL.classList.add('fc-hidden');
    elC.classList.add('fc-hidden');
    document.getElementById('zoom-level-badge').classList.add('fc-hidden');
    const scale = document.getElementById('scale-bar');
    if (scale) scale.classList.add('fc-hidden');
    const bar = document.getElementById('fc-bar-left');
    _buildBarDots(bar, FC_LEFT_BTNS);
    bar.classList.add('show');
    bar.classList.remove('fc-snap');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.classList.add('fc-snap');
      bar.style.transform = 'translateX(0)';
    }));
  };
  if (animate) {
    elL.addEventListener('transitionend', onEnd, { once: true });
  }
  _setTransform(elL, 'translateX(-120%)', animate);
  _setTransform(elC, 'translateX(-120%)', animate);
  if (!animate) onEnd();
}

function _fcLeftShow(animate) {
  _fcLeftOpen = true;
  const elL = document.getElementById('float-ctrl-left');
  const elC = document.getElementById('float-ctrl');
  const bar = document.getElementById('fc-bar-left');
  // バー収納
  bar.classList.add('fc-snap');
  bar.style.transform = 'translateX(-100%)';
  bar.addEventListener('transitionend', () => {
    bar.classList.remove('show', 'fc-snap');
    bar.style.transform = '';
  }, { once: true });
  // ボタン展開
  elL.classList.remove('fc-hidden');
  elC.classList.remove('fc-hidden');
  document.getElementById('zoom-level-badge').classList.remove('fc-hidden');
  const scale = document.getElementById('scale-bar');
  if (scale) scale.classList.remove('fc-hidden');
  // 左外から右へスライドイン
  elL.classList.remove('fc-snap', 'fc-intro');
  elC.classList.remove('fc-snap', 'fc-intro');
  elL.style.transform = 'translateX(-120%)';
  elC.style.transform = 'translateX(-120%)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    elL.classList.add('fc-snap');
    elC.classList.add('fc-snap');
    elL.style.transform = 'translateX(0)';
    elC.style.transform = 'translateX(0)';
    // transitionend競合を避けるため次フレームで更新
    requestAnimationFrame(() => {
      if(typeof updateScaleBar === 'function') updateScaleBar();
    });
  }));
}

// ── 右列 収納/展開 ──
let _fcRightOpen = true;

// 収納バーに表示するドットリスト（地図系／その他をスペーサーで区切る）
const FC_ALL_BTNS = [
  ...FC_LEFT_BTNS,
  { spacer: true },
  ...FC_RIGHT_BTNS,
];

function _fcRightHide(animate) {
  _fcRightOpen = false;
  _fcLeftOpen = false;
  const elL = document.getElementById('float-ctrl-left');
  const elC = document.getElementById('float-ctrl');
  const elR = document.getElementById('float-ctrl-right');
  const onEnd = () => {
    elR.removeEventListener('transitionend', onEnd);
    elL.classList.add('fc-hidden');
    elC.classList.add('fc-hidden');
    elR.classList.add('fc-hidden');
    document.getElementById('zoom-level-badge').classList.add('fc-hidden');
    const scale = document.getElementById('scale-bar');
    if (scale) scale.classList.add('fc-hidden');
    // タブバーを下へスライドアウト
    const tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.style.transform = 'translateY(100%)';
    const bar = document.getElementById('fc-bar-right');
    _buildBarDots(bar, FC_ALL_BTNS);
    bar.classList.add('show');
    bar.classList.remove('fc-snap');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.classList.add('fc-snap');
      bar.style.transform = 'translateY(0)';
    }));
  };
  if (animate) {
    elR.addEventListener('transitionend', onEnd, { once: true });
  }
  _setTransform(elL, 'translateY(-120%)', animate);
  _setTransform(elC, 'translateY(-120%)', animate);
  _setTransform(elR, 'translateY(-120%)', animate);
  if (!animate) onEnd();
}

function _fcRightShow(animate) {
  _fcRightOpen = true;
  _fcLeftOpen = true;
  const elL = document.getElementById('float-ctrl-left');
  const elC = document.getElementById('float-ctrl');
  const elR = document.getElementById('float-ctrl-right');
  const bar = document.getElementById('fc-bar-right');
  // バー収納
  bar.classList.add('fc-snap');
  bar.style.transform = 'translateY(-100%)';
  bar.addEventListener('transitionend', () => {
    bar.classList.remove('show', 'fc-snap');
    bar.style.transform = '';
  }, { once: true });
  // タブバーを同時に復帰
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.transform = 'translateY(0)';
  // 左列・中央・右列を一緒に展開
  [elL, elC, elR].forEach(el => {
    el.classList.remove('fc-hidden', 'fc-snap', 'fc-intro');
    el.style.transform = 'translateY(-120%)';
  });
  document.getElementById('zoom-level-badge').classList.remove('fc-hidden');
  const scale = document.getElementById('scale-bar');
  if (scale) scale.classList.remove('fc-hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    [elL, elC, elR].forEach(el => {
      el.classList.add('fc-snap');
      el.style.transform = 'translateY(0)';
    });
    // transitionend競合を避けるため次フレームで更新
    requestAnimationFrame(() => {
      if(typeof updateScaleBar === 'function') updateScaleBar();
    });
  }));
}

// ── ドラッグ追従（X軸）：左セット用 ──
function _addDragX(el, onCommit, onCancel) {
  let sx = null, dragging = false;
  const targets = ['float-ctrl-left','float-ctrl'].map(id => document.getElementById(id));
  const threshold = 80; // px

  el.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    dragging = false;
    targets.forEach(t => { t.classList.remove('fc-snap','fc-intro'); });
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (sx === null) return;
    const dx = e.touches[0].clientX - sx;
    if (dx >= 0) return; // 右方向は無視
    dragging = true;
    const clamped = Math.max(dx, -window.innerWidth);
    targets.forEach(t => { t.style.transform = `translateX(${clamped}px)`; });
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!dragging || sx === null) { sx = null; return; }
    const dx = e.changedTouches[0].clientX - sx;
    sx = null; dragging = false;
    if (dx < -threshold) {
      onCommit();
    } else {
      // スナップバック
      targets.forEach(t => {
        t.classList.add('fc-snap');
        t.style.transform = 'translateX(0)';
      });
      if (onCancel) onCancel();
    }
  }, { passive: true });
}

// ── ドラッグ追従（Y軸）：右列用 ──
function _addDragY(el, onCommit, onCancel) {
  let sy = null, dragging = false;
  const targets = ['float-ctrl-left','float-ctrl','float-ctrl-right'].map(id => document.getElementById(id));
  const threshold = 80; // px

  el.addEventListener('touchstart', e => {
    sy = e.touches[0].clientY;
    dragging = false;
    targets.forEach(t => { t.classList.remove('fc-snap','fc-intro'); });
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (sy === null) return;
    const dy = e.touches[0].clientY - sy;
    if (dy >= 0) return; // 下方向は無視
    dragging = true;
    const clamped = Math.max(dy, -window.innerHeight);
    targets.forEach(t => { t.style.transform = `translateY(${clamped}px)`; });
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!dragging || sy === null) { sy = null; return; }
    const dy = e.changedTouches[0].clientY - sy;
    sy = null; dragging = false;
    if (dy < -threshold) {
      onCommit();
    } else {
      // スナップバック
      targets.forEach(t => {
        t.classList.add('fc-snap');
        t.style.transform = 'translateY(0)';
      });
      if (onCancel) onCancel();
    }
  }, { passive: true });
}

// ── バータップ用スワイプ（Y軸）──
function _addSwipeY(el, onDown, onUp) {
  let sy = null;
  el.addEventListener('touchstart', e => {
    sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sy === null) return;
    const dy = e.changedTouches[0].clientY - sy;
    sy = null;
    if (dy > 20 && onDown) onDown();
    else if (dy < -20 && onUp) onUp();
  }, { passive: true });
}

// ── 初期化（DOM構築後に呼ぶ）──
function initFcToggle() {
  const barR = document.getElementById('fc-bar-right');
  const elL  = document.getElementById('float-ctrl-left');
  const elC  = document.getElementById('float-ctrl');
  const elR  = document.getElementById('float-ctrl-right');

  // 右バー：タップ/下スワイプで全体展開
  _addSwipeY(barR, () => _fcRightShow(true), null);
  barR.addEventListener('click', () => _fcRightShow(true));

  // 右列・左列・中央：上スワイプで全体収納
  _addDragY(elR, () => _fcRightHide(true), null);
  _addDragY(elL, () => _fcRightHide(true), null);
  _addDragY(elC, () => _fcRightHide(true), null);

  // ── 起動時スライドイン（全エリア上から下へ統一）──
  [elL, elC, elR].forEach(el => { el.style.transform = 'translateY(-120%)'; });

  requestAnimationFrame(() => requestAnimationFrame(() => {
    [elL, elC, elR].forEach(el => {
      el.classList.add('fc-intro');
      el.style.transform = 'translateY(0)';
      el.addEventListener('transitionend', () => el.classList.remove('fc-intro'), { once: true });
    });
  }));
}

// DOMContentLoaded後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFcToggle);
} else {
  initFcToggle();
}