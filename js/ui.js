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
//  データソース（将来的な重み付け）
//    weight 0.3 → GSJ_MINE_DATA（Au_Ag鉱床）  鉱床存在確率
//    weight 0.6 → MINES（砂金採取実績地）
//    weight 1.0 → ユーザー投稿（実採取報告）  ← Firestore後で追加
// ═══════════════════════════════════════════
// ════════════════════════════════════════════════════════
//  砂金分布ヒートマップ（Canvas直接描画）
//  leaflet-heatを廃止し、L.Layer拡張でCanvasに直接描画する。
//  ズーム・移動ごとに再描画するためどのzoomでも同品質のグラデーションを維持。
//  tier: 'free' | 'hd' | 'vip' を将来的に独立Canvasで重ね合わせ可能な構造。
// ════════════════════════════════════════════════════════

// ── データ生成 ──────────────────────────────────────
function buildHeatPoints() {
  const pts = [];
  for (const d of GSJ_MINE_DATA) {
    if (d.mat !== 'Au_Ag') continue;
    pts.push([d.lat, d.lng, d.trace ? 0.2 : 0.35]);
  }
  for (const m of MINES) pts.push([m.lat, m.lng, 0.6]);
  return pts;
}

// ── スムースノイズ（Perlin風） ────────────────────────
function _sNoise(x,y){ const n=Math.sin(x*127.1+y*311.7)*43758.5453; return (n-Math.floor(n))*2-1; }
function _smoothNoise(x,y){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
  return _sNoise(ix,iy)*(1-ux)*(1-uy)+_sNoise(ix+1,iy)*ux*(1-uy)
        +_sNoise(ix,iy+1)*(1-ux)*uy  +_sNoise(ix+1,iy+1)*ux*uy;
}

// ── Canvas描画レイヤー ────────────────────────────────
const GoldHeatLayer = L.Layer.extend({
  _tier: 'free',
  _pts:  [],     // [[lat,lng,w], ...]
  _canvas: null,

  initialize(pts, tier) {
    this._pts  = pts;
    this._tier = tier;
  },

  onAdd(map) {
    this._map = map;
    // paneHeat内にCanvasを追加
    const pane = map.getPane('paneHeat');
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    pane.appendChild(this._canvas);
    this._resize();
    map.on('moveend zoomend', this._redraw, this);
    map.on('resize', this._resize, this);
    this._redraw();
    return this;
  },

  onRemove(map) {
    map.off('moveend zoomend', this._redraw, this);
    map.off('resize', this._resize, this);
    if(this._canvas) { this._canvas.remove(); this._canvas = null; }
  },

  _resize() {
    if(!this._canvas) return;
    const size = this._map.getSize();
    this._canvas.width  = size.x;
    this._canvas.height = size.y;
    this._redraw();
  },

  _redraw() {
    if(!this._canvas || !this._map) return;
    const canvas = this._canvas;
    const ctx    = canvas.getContext('2d');
    const size   = this._map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    ctx.clearRect(0, 0, size.x, size.y);

    const tier  = this._tier;
    const z     = this._map.getZoom();

    // tierごとの楕円半径（px）
    const baseR = tier === 'hd' ? 55 : 90;
    // ズームに応じてスケール（z7基準）
    const scale = Math.pow(1.55, z - 7);
    const rBase = Math.max(10, Math.round(baseR * scale));

    // グラデーション定義
    const COLORS_FREE = [
      [0.00, [0,18,51,0]],
      [0.30, [13,61,138,0.5]],
      [0.55, [200,100,0,0.75]],
      [0.78, [232,168,0,0.85]],
      [1.00, [255,245,160,0.9]],
    ];
    const COLORS_HD = [
      [0.00, [0,18,51,0]],
      [0.25, [13,61,138,0.35]],
      [0.50, [200,100,0,0.55]],
      [0.75, [232,168,0,0.70]],
      [1.00, [255,245,160,0.80]],
    ];
    const colorStops = tier === 'hd' ? COLORS_HD : COLORS_FREE;

    // 各ポイントを描画
    this._pts.forEach(([lat, lng, w]) => {
      const px = this._map.latLngToContainerPoint([lat, lng]);

      // ノイズで楕円軸比をランダム化（0.55〜1.0）
      const nv1 = _smoothNoise(lat * 15, lng * 15);
      const nv2 = _smoothNoise(lat * 15 + 100, lng * 15 + 100);
      const axisX = rBase * (0.75 + 0.25 * Math.abs(nv1));
      const axisY = rBase * (0.55 + 0.45 * Math.abs(nv2));
      // ノイズで回転角をランダム化
      const angle = _smoothNoise(lat * 8, lng * 8) * Math.PI;

      // 楕円の変換行列でradialGradientを描画
      ctx.save();
      ctx.translate(px.x, px.y);
      ctx.rotate(angle);
      ctx.scale(1, axisY / axisX);

      // 正規分布風の放射グラデーション
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, axisX);
      colorStops.forEach(([stop, [r,g,b,a]]) => {
        grad.addColorStop(stop, `rgba(${r},${g},${b},${a * w})`);
      });

      ctx.globalCompositeOperation = 'screen'; // 重なりで自然に加算合成
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, axisX, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },

  // 外部からデータを追加
  addPoints(newPts) {
    this._pts = this._pts.concat(newPts);
    this._redraw();
  },
});

// ── tier管理・zoom制限 ────────────────────────────────
let heatTier   = 'free';
let heatLayer  = null;
let heatOn     = false;

const HEAT_ZOOM = { free: 7, hd: 9, vip: 13 }; // これ以上でダイアログ

// ── ヒートマップ初期化・再描画 ────────────────────────
function initHeatLayer(tier) {
  tier = tier || 'free';
  heatTier = tier;
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }

  const basePts = buildHeatPoints();
  heatLayer = new GoldHeatLayer(basePts, tier);
  heatLayer.addTo(map);

  const btnHd = document.getElementById('btn-hd');
  if(btnHd) btnHd.classList.toggle('active', tier !== 'free');
}

// ── ズーム変化時のzoom制限チェック ────────────────────
map.on('zoomend', () => {
  if(!heatOn) return;
  const z    = map.getZoom();
  const maxZ = HEAT_ZOOM[heatTier] ?? 7;
  if(z > maxZ){
    if(heatLayer) map.removeLayer(heatLayer);
    _showHeatZoomBanner(true, heatTier);
  } else {
    if(heatLayer && !map.hasLayer(heatLayer)) heatLayer.addTo(map);
    _showHeatZoomBanner(false);
  }
});

// ── HD誘導バナー ──────────────────────────────────────
function _showHeatZoomBanner(show, tier){
  let b = document.getElementById('heat-zoom-banner');
  if(show){
    const isHd = (tier === 'hd');
    const msg  = isHd
      ? '🔒 この拡大率はVIPプランで閲覧できます'
      : '🔒 この拡大率は高解像度版で閲覧できます';
    const btn  = isHd
      ? '' // VIP誘導（将来実装）
      : '<button onclick="toggleHeatHD()" style="margin-left:8px;padding:3px 10px;border-radius:5px;background:var(--gold);border:none;color:#1a1400;font-weight:700;font-size:11px;cursor:pointer;">HDを見る</button>';
    if(!b){
      b = document.createElement('div');
      b.id = 'heat-zoom-banner';
      b.style.cssText = 'position:fixed;bottom:calc(var(--tab-h)+10px);left:50%;transform:translateX(-50%);z-index:1050;background:rgba(0,0,0,0.88);border:1px solid var(--gold);border-radius:20px;padding:7px 16px;font-size:12px;color:var(--txt);white-space:nowrap;pointer-events:auto;display:flex;align-items:center;gap:4px;';
      document.body.appendChild(b);
    }
    b.innerHTML = msg + btn;
    b.style.display = 'flex';
  } else {
    if(b) b.style.display = 'none';
  }
}

// ── ON/OFF切替 ────────────────────────────────────────
function toggleHeat() {
  heatOn = !heatOn;
  document.getElementById('btn-heat').classList.toggle('active', heatOn);
  document.getElementById('btn-hd').style.display = heatOn ? 'flex' : 'none';
  if(heatOn){
    heatTier = 'free';
    initHeatLayer('free');
  } else {
    if(heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
    document.getElementById('btn-hd')?.classList.remove('active');
    _showHeatZoomBanner(false);
  }
}

// ── Firestore連携用（外部からデータ追加）─────────────
function addHeatPoints(points) {
  if(!heatLayer) return;
  heatLayer.addPoints(points.map(p => [p.lat, p.lng, p.weight ?? 1.0]));
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