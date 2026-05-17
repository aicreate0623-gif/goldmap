'use strict';
// ═══════════════════════════════════════════
//  offline.js
//  タイル計算・DL・レジューム・プログレスUI・
//  追加レイヤーDL・セッション一覧UI
// ═══════════════════════════════════════════

const JAPAN=L.latLngBounds([24,122],[46,154]);
function lon2x(lon,z){return Math.floor((lon+180)/360*Math.pow(2,z));}
function lat2y(lat,z){return Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2,z));}
function cntTiles(b,zmin,zmax){let n=0;for(let z=zmin;z<=zmax;z++){const x0=lon2x(b.getWest(),z),x1=lon2x(b.getEast(),z),y0=lat2y(b.getNorth(),z),y1=lat2y(b.getSouth(),z);n+=(x1-x0+1)*(y1-y0+1);}return n;}
function ckLayers(){
  // DLダイアログが開いている場合はダイアログ内チェックボックスを参照
  const dlgOpen = document.getElementById('dl-dialog')?.style.display !== 'none';
  const prefix  = dlgOpen ? 'dlg-ck-' : 'ck-';
  return ['std','photo','topo','hill','relief'].filter(k=>document.getElementById(prefix+k)?.checked);
}
function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M枚';if(n>=1e3)return Math.round(n/1e3)+'K枚';return n+'枚';}
// レイヤー別1枚あたりKB係数（実測値ベース）
// 実測: std=25.8MB/2499枚→10.6KB, topo=33.5MB/2499枚→13.7KB
//       hill=21.8MB/2499枚→8.9KB, relief=115.2MB/2499枚→47.1KB
//       photo=前回実測66.8MB/2499枚→26.7KB
const LAYER_KB = {std:11, photo:27, topo:14, hill:9, relief:47};
window._LAYER_KB = LAYER_KB;
function mbEst(n, lk){ const kb = (lk && LAYER_KB[lk]) || 10; return (n*kb/1024).toFixed(0); }
// レイヤー配列を考慮した合計MB推定
function mbEstLayers(tileCount, layers){
  const b = layers.reduce((s,lk)=>s+(LAYER_KB[lk]||10)*1024*tileCount, 0);
  return (b/1024/1024).toFixed(0);
}
// 推定バイト数（レイヤー配列対応）
function estBytesLayers(tileCount, layers){
  return layers.reduce((s,lk)=>s+(LAYER_KB[lk]||10)*1024*tileCount, 0);
}

// ═══════════════════════════════════════════
//  全国ベースマップDL（Z5〜Z9 固定）
// ═══════════════════════════════════════════

/** レイヤーチェックボックス（全国ベースセクション用）を読む */
function _ckBaseLayers(){
  const sel = document.querySelector('[name="base-layer-select"]:checked');
  return sel ? [sel.value] : [];
}

/** 推定MB表示を更新（アコーディオン展開時・チェック変更時に呼ばれる） */
function updBaseNDlEst(){
  const el = document.getElementById('base-n-est');
  if(!el) return;
  const layers = _ckBaseLayers();
  if(!layers.length){ el.textContent = '— MB'; return; }
  const n = cntTiles(JAPAN, 5, 9);
  const mb = mbEstLayers(n, layers);
  el.textContent = `約 ${mb} MB`;
}

/** 全国ベースDL開始（Z5〜Z9固定・JAPAN全域） */
async function startBaseNDl(){
  const layers = _ckBaseLayers();
  if(!layers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  await runDl('base', JAPAN, 5, 9, layers, 0);
}

// ═══════════════════════════════════════════
//  ベースDL状況内: 推定MB更新・DL開始
// ═══════════════════════════════════════════

/** チェック変更時に推定MBを更新 */
function updBaseStatusEst(){
  const el = document.getElementById('base-status-est');
  if(!el) return;
  const sel = document.querySelector('[name="base-layer-select"]:checked');
  if(!sel){ el.textContent = '— MB'; return; }
  const layers = [sel.value];
  const n  = cntTiles(JAPAN, 5, 9);
  const mb = mbEstLayers(n, layers);
  el.textContent = `約 ${mb} MB`;
}

/** DL開始ボタン（状況UI内） */
async function startBaseDlFromStatus(){
  const sel = document.querySelector('[name="base-layer-select"]:checked');
  const layers = sel ? [sel.value] : [];
  if(!layers.length){ showAlert('エラー','レイヤーを選択してください'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }
  _bdprogOpen(layers);
  await runDl('base', JAPAN, 5, 9, layers, 0);
}

// ═══════════════════════════════════════════
//  矩形選択（drawRect系のみ）
//  設計:
//    DLダイアログのSTEP1でドラッグ選択に一本化。
//    useView系は廃止。
// ═══════════════════════════════════════════

// ── 確定済み範囲（DLに使う） ─────────────────────────
let detRect = null;

// ── drawRect系 ───────────────────────────────────────
// drawMode     : ドラッグ受付中フラグ
// _drawStart   : ドラッグ開始latlng
// _drawPending : ドラッグ完了後の確定前bounds
// _drawPreview : 地図上に表示中のプレビュー矩形レイヤー
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

// ドラッグモード開始（イベント登録）
function _enterDrawMode(){
  drawMode   = true;
  _drawStart = null;
  document.getElementById('float-ctrl').classList.add('draw-mode-active');
  document.getElementById('float-ctrl-left').classList.add('draw-mode-active');
  document.getElementById('float-ctrl-right').classList.add('draw-mode-active');
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  map.getContainer().style.cursor='crosshair';

  const onDown = e => { _drawStart=e.latlng; _clearDrawPreview(); };
  const onMove = e => {
    if(!_drawStart) return;
    _clearDrawPreview();
    _drawPreview = L.rectangle(L.latLngBounds(_drawStart,e.latlng),{
      color:'#00ffff',weight:2,dashArray:'6 3',fillColor:'#00ffff',fillOpacity:.08
    }).addTo(map);
  };
  const onUp = e => {
    if(!_drawStart) return;
    const bounds = L.latLngBounds(_drawStart,e.latlng);
    _drawStart=null; _stopDraw();
    _drawPending=bounds; _showDrawPreview(_drawPending);
  };
  const _toLL = e => {
    const t=e.touches[0], r=map.getContainer().getBoundingClientRect();
    return map.containerPointToLatLng(L.point(t.clientX-r.left,t.clientY-r.top));
  };
  const onTDown = e => { e.preventDefault(); _drawStart=_toLL(e); _clearDrawPreview(); };
  const onTMove = e => {
    e.preventDefault(); if(!_drawStart) return;
    _clearDrawPreview();
    _drawPreview = L.rectangle(L.latLngBounds(_drawStart,_toLL(e)),{
      color:'#00ffff',weight:2,dashArray:'6 3',fillColor:'#00ffff',fillOpacity:.08
    }).addTo(map);
  };
  const onTUp = e => {
    e.preventDefault(); if(!_drawStart) return;
    const t=e.changedTouches[0], r=map.getContainer().getBoundingClientRect();
    const ll=map.containerPointToLatLng(L.point(t.clientX-r.left,t.clientY-r.top));
    const bounds=L.latLngBounds(_drawStart,ll);
    _drawStart=null; _stopDraw();
    _drawPending=bounds; _showDrawPreview(_drawPending);
  };

  map._re={onDown,onMove,onUp,onTDown,onTMove,onTUp};
  map.on('mousedown',onDown).on('mousemove',onMove).on('mouseup',onUp);
  const mc=map.getContainer();
  mc.addEventListener('touchstart',onTDown,{passive:false});
  mc.addEventListener('touchmove', onTMove,{passive:false});
  mc.addEventListener('touchend',  onTUp,  {passive:false});
}

// ドラッグモード停止（イベント解除・_drawPending/_drawPreviewは保持）
function _stopDraw(){
  drawMode=false; _drawStart=null;
  map.dragging.enable(); map.scrollWheelZoom.enable();
  map.getContainer().style.cursor='';
  document.getElementById('float-ctrl').classList.remove('draw-mode-active');
  document.getElementById('float-ctrl-left').classList.remove('draw-mode-active');
  document.getElementById('float-ctrl-right').classList.remove('draw-mode-active');
  const e=map._re;
  if(e){
    map.off('mousedown',e.onDown).off('mousemove',e.onMove).off('mouseup',e.onUp);
    const mc=map.getContainer();
    mc.removeEventListener('touchstart',e.onTDown);
    mc.removeEventListener('touchmove', e.onTMove);
    mc.removeEventListener('touchend',  e.onTUp);
    map._re=null;
  }
}

// タブ内「範囲をクリア」
function clearRect(){
  if(drawMode) _stopDraw();
  detRect=null; _drawPending=null; _clearDrawPreview();
  const ri=document.getElementById('rect-info');     if(ri)  ri.textContent='範囲: 未選択';
  const bc=document.getElementById('btn-clearrect'); if(bc)  bc.style.display='none';
  const bd=document.getElementById('btn-dldet');     if(bd)  bd.disabled=true;
  const de=document.getElementById('det-est');       if(de)  de.textContent='— 範囲を選択してください —';
}

// 確定済み範囲を地図上に表示
function showRect(){
  _clearDrawPreview();
  if(detRect){
    _drawPreview=L.rectangle(detRect,{
      color:'#00ffff',weight:2,dashArray:'4 3',fillColor:'#00ffff',fillOpacity:.06
    }).addTo(map);
  }
}

// finishDraw: 外部（Escapeキー等）から呼ばれる互換ラッパー
function finishDraw(){ if(drawMode) _stopDraw(); }


// ═══════════════════════════════════════════
//  地図上DLダイアログ（ウィザード式・2STEP）
//  STEP1: ドラッグで範囲選択
//  STEP2: レイヤー・ズーム設定＋レイヤー別容量表示
//  STEP3: DL進捗
// ═══════════════════════════════════════════

let _dldStep   = 0;        // 現在のSTEP（0〜3）
let _dldType   = 'detail'; // 'detail' | 'base'
let _dldBounds = null;     // STEP2で確定したbounds

// レイヤー表示名（容量表示用）
const _DLD_LAYER_LABEL = { std:'地理院地図', photo:'航空写真', topo:'地形図', hill:'陰影起伏図', relief:'色別標高図' };
/** レイヤーキー配列を表示名に変換して結合 例: ['std','photo'] → '地理院地図・航空写真' */
function _layerLabel(keys, sep){ return (keys||[]).map(k=>_DLD_LAYER_LABEL[k]||k).join(sep||'・'); }

// ── ダイアログ開く ──────────────────────────────────────
function openDlDialog(){
  if(!navigator.onLine){ showAlert('オフライン', 'インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }
  if(_guardResume()) return;
  isPremiumUser().then(premium=>{
    if(!premium){ showPremiumGate('offline'); return; }
    _dldStep   = 0;
    _dldBounds = null;
    _dldType   = 'detail';
    _drawPending = null;
    _clearDrawPreview();
    _dldRenderStep(0);
    document.getElementById('dl-dialog').style.display = 'block';
    _openTab('map');
    _pushHistory();
  });
}

// ── ステップ移動（HTMLボタンから直接呼ぶ用） ──────────────
function _dldGoStep(step){
  if(step === 1){
    // STEP0→STEP1: ドラッグモード開始
    _drawPending = null;
    _clearDrawPreview();
    const ok   = document.getElementById('dld-draw-ok');
    const hint = document.getElementById('dld-draw-hint');
    if(ok)   ok.disabled = true;
    if(hint) hint.textContent = '地図上をドラッグして範囲を指定してください';
    _dldRenderStep(1);
    if(!drawMode) _enterDrawMode();
    _dldWatchDraw();
  } else if(step === 0){
    // STEP1→STEP0: ドラッグモード終了
    if(drawMode) _stopDraw();
    _drawPending = null;
    _clearDrawPreview();
    _dldResetS1Est();
    _dldRenderStep(0);
  } else if(step === 2){
    // STEP3→STEP2（戻る）
    _dldRenderStep(2);
  } else {
    _dldRenderStep(step);
  }
}

// ── ダイアログ閉じる（内部用） ──────────────────────────
function _dldClose(){
  document.getElementById('dl-dialog').style.display = 'none';
  if(drawMode) _stopDraw();
  _clearDrawPreview();
  _dldBounds   = null;
  _drawPending = null;
  _dldResetS1Est();
}

// ── キャンセル（ボタン押下用） ──────────────────────────
function _dldCancel(){
  _dldClose();
  _openTab('offline');
  _pushHistory();
  // 停止中のレジュームがあればバナーを表示
  checkResume();
}

function _goToBaseDl(){
  _openTab('offline');
  // 全国ベースマップダウンロードと管理ダイアログを開く
  if(typeof showDlg === 'function') showDlg('dlg-base-dl');
}

// ── ステップ描画 ────────────────────────────────────────
function _dldRenderStep(step){
  _dldStep = step;
  // パネル表示切替（STEP0〜3）
  ['dld-s0','dld-s1','dld-s2','dld-s3'].forEach((id,i)=>{
    const el = document.getElementById(id);
    if(el) el.style.display = (i===step) ? 'block' : 'none';
  });
  // インジケーター更新（dld-si-0〜3）
  [0,1,2,3].forEach(n=>{
    const el = document.getElementById('dld-si-'+n);
    if(!el) return;
    el.classList.toggle('active', n===step);
    el.classList.toggle('done',   n<step);
  });
  if(step===2 || step===3) _dldUpdEst();
}

// ── STEP2: ドラッグ完了を監視してOKボタンを有効化 ────────
function _dldWatchDraw(){
  const timer = setInterval(()=>{
    const dlg = document.getElementById('dl-dialog');
    if(!dlg || dlg.style.display==='none'){ clearInterval(timer); return; }
    if(_dldStep !== 1){ clearInterval(timer); return; }
    if(_drawPending){
      clearInterval(timer);
      // 概算計算機を表示
      const calcEl = document.getElementById('dld-s1-est');
      const clrBtn = document.getElementById('dld-draw-clear');
      if(calcEl) calcEl.style.display = '';
      if(clrBtn) clrBtn.disabled = false;
      const hint = document.getElementById('dld-draw-hint');
      if(hint) hint.textContent = '範囲が選択されました。概算を確認して確定してください';
      // OKボタンをいったん有効化 → _dldSyncAndCalc内で200MB超過なら無効化
      const ok = document.getElementById('dld-draw-ok');
      if(ok) ok.disabled = false;
      _dldSyncAndCalc();
    }
  }, 150);
}

// ── ラジオ的挙動：1つ選んだら他2つをdisabled、外したら全解除 ──
function _dldOnlyOne(el, prefix){
  const keys = ['std','photo','topo'];
  if(el.checked){
    keys.forEach(k=>{
      const ck = document.getElementById(prefix + k);
      if(ck && ck !== el){ ck.checked = false; ck.disabled = true; }
    });
  } else {
    keys.forEach(k=>{
      const ck = document.getElementById(prefix + k);
      if(ck) ck.disabled = false;
    });
  }
}

// ── STEP2簡易容量・解除ボタンをリセット（共通） ──────────
function _dldResetS1Est(){
  const calc = document.getElementById('dld-s1-est');
  const clr  = document.getElementById('dld-draw-clear');
  if(calc) calc.style.display = 'none';
  if(clr)  clr.disabled = true;
  // チェック・disabled・ズームをデフォルトに戻す
  const std   = document.getElementById('s1-ck-std');
  const photo = document.getElementById('s1-ck-photo');
  const topo  = document.getElementById('s1-ck-topo');
  const zmax  = document.getElementById('s1-zmax');
  if(std)   { std.checked   = false; std.disabled   = false; }
  if(photo) { photo.checked = false; photo.disabled = false; }
  if(topo)  { topo.checked  = false; topo.disabled  = false; }
  if(zmax)  zmax.value = '16';
  // STEP3側も同期してリセット
  ['std','photo','topo'].forEach(k=>{
    const s3 = document.getElementById('dlg-ck-'+k);
    const s1 = document.getElementById('s1-ck-'+k);
    if(s3 && s1){ s3.checked = s1.checked; s3.disabled = s1.disabled; }
  });
  const tot = document.getElementById('dld-s1-total');
  if(tot) tot.textContent = '— MB';
}

// ── STEP2概算計算機 → STEP3設定パネルに同期して計算 ──────
function _dldSyncAndCalc(){
  // s1の値をSTEP3側に同期
  const map = { std:'std', photo:'photo', topo:'topo', hill:'hill', relief:'relief' };
  Object.keys(map).forEach(k=>{
    const s1 = document.getElementById('s1-ck-'+k);
    const s3 = document.getElementById('dlg-ck-'+k);
    if(s1 && s3){ s3.checked = s1.checked; s3.disabled = s1.disabled; }
  });
  const s1zmax = document.getElementById('s1-zmax');
  const s3zmax = document.getElementById('dlg-det-zmax');
  if(s1zmax && s3zmax) s3zmax.value = s1zmax.value;

  // 合計容量を計算して表示
  const tot = document.getElementById('dld-s1-total');
  if(!tot || !_drawPending) return;
  const zmin = 10; // 最小ズームはZ10固定
  const zmax = parseInt(s1zmax?.value || '15');
  const base = cntTiles(_drawPending, zmin, zmax);
  const chkLayers = ['std','photo','topo','hill','relief'].filter(k=>document.getElementById('s1-ck-'+k)?.checked);
  if(!chkLayers.length){
    tot.textContent = 'レイヤーを一つ選択して下さい';
    tot.style.color = 'var(--txt-dim)';
    return;
  }
  const eb  = estBytesLayers(base, chkLayers);
  const mb  = (eb / 1024 / 1024).toFixed(0);
  const over = eb > DL_SESSION_MAX;

  // 非同期チェック中は確定ボタンを無効化
  const ok = document.getElementById('dld-draw-ok');
  if(ok && _drawPending) ok.disabled = true;

  // ベースDL未完了チェック（非同期・警告表示）
  if(typeof getBaseDlDoneLayers === 'function'){
    getBaseDlDoneLayers().then(baseDone => {
      const needBase = chkLayers.filter(lk => !baseDone.has(lk));
      if(needBase.length){
        const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図','hill':'陰影起伏図','relief':'色別標高図'}[lk]||lk)).join('・');
        tot.innerHTML =
          `<span style="color:#ffaa00">⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です。</span>` +
          `<br><button class="btn sm" style="margin-top:6px" onclick="_dldCancel();_goToBaseDl()">📥 ベースDLへ</button>`;
        tot.style.color = '';
        if(ok && _drawPending) ok.disabled = true;
      } else {
        tot.textContent = `${chkLayers.length}レイヤー · Z10〜Z${zmax} · 約 ${mb} MB${over ? ' — 200MB超過' : ''}`;
        tot.style.color = over ? '#ff5a47' : '';
        if(ok && _drawPending) ok.disabled = over;
      }
    });
  } else {
    tot.textContent = `${chkLayers.length}レイヤー · Z10〜Z${zmax} · 約 ${mb} MB${over ? ' — 200MB超過' : ''}`;
    tot.style.color = over ? '#ff5a47' : '';
    if(ok && _drawPending) ok.disabled = over;
  }
}

// ── 200MB超過チェック共通（true=超過）──────────────────────
// layers: 文字列配列['std','photo',...] または件数(後方互換)
// ※ _dldStartDl では分割DLに移行するためブロックしない。
//    STEP2（ドラッグ直後）の再ドラッグ要求にのみ使う。
function _dldCheckSize(bounds, zmaxVal, layers){
  if(!bounds) return false;
  const zmin = 10;
  const zmax = parseInt(zmaxVal) || 16;
  const layerArr = Array.isArray(layers) ? layers : Array(layers||1).fill('std');
  const tiles = cntTiles(bounds, zmin, zmax);
  const eb = estBytesLayers(tiles, layerArr);
  if(eb > DL_SESSION_MAX){
    const mb = (eb / 1024 / 1024).toFixed(0);
    showAlert('⚠️ サイズ超過',
      `推定サイズ 約${mb}MB は1回のDL上限（200MB）を超えています。\nズームレベルを下げるか、レイヤー数を減らして再度お試しください。`);
    return true;
  }
  return false;
}

// ── STEP2: 範囲を解除する ────────────────────────────────
function _dldClearDraw(){
  _drawPending = null;
  _clearDrawPreview();
  const ok   = document.getElementById('dld-draw-ok');
  const hint = document.getElementById('dld-draw-hint');
  if(ok)   ok.disabled = true;
  if(hint) hint.textContent = '地図上をドラッグして範囲を指定してください';
  _dldResetS1Est();
  // ドラッグモード再開（STEP2のまま）
  if(!drawMode) _enterDrawMode();
  _dldWatchDraw();
}

// ── STEP2: 確定ボタン → STEP3へ ────────────────────────
async function _dldConfirmDraw(){
  if(!_drawPending) return;
  const zmax      = document.getElementById('s1-zmax')?.value || '16';
  const chkLayers = ['std','photo','topo','hill','relief'].filter(k=>document.getElementById('s1-ck-'+k)?.checked);
  if(!chkLayers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(_dldCheckSize(_drawPending, zmax, chkLayers)) return;

  // ── ベースDL未完了チェック ──────────────────────────
  if(typeof getBaseDlDoneLayers === 'function'){
    const baseDone  = await getBaseDlDoneLayers();
    const needBase  = chkLayers.filter(lk => !baseDone.has(lk));
    if(needBase.length){
      const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図','hill':'陰影起伏図','relief':'色別標高図'}[lk]||lk)).join('・');
      // 概算エリアの合計欄に警告を表示（ダイアログは閉じない）
      const tot = document.getElementById('dld-s1-total');
      if(tot) tot.innerHTML =
        `<span style="color:#ffaa00">⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です。</span>` +
        `<br><button class="btn sm" style="margin-top:6px"
          onclick="_dldCancel();_goToBaseDl()">📥 ベースDLへ</button>`;
      return; // STEP3には進まない
    }
  }

  _dldBounds   = _drawPending;
  _drawPending = null;
  _showDrawPreview(_dldBounds);
  _dldRenderStep(2);
}

// ── STEP3→STEP2 戻る ────────────────────────────────────
function _dldBack(){
  _clearDrawPreview();
  if(drawMode) _stopDraw();
  _drawPending = null;
  _dldBounds   = null;
  // OKボタン・ヒント・簡易容量・解除ボタンをリセット
  const ok   = document.getElementById('dld-draw-ok');
  const hint = document.getElementById('dld-draw-hint');
  if(ok)   ok.disabled = true;
  if(hint) hint.textContent = '地図上をドラッグして範囲を指定してください';
  _dldResetS1Est();
  _dldRenderStep(1);
  // ドラッグモード再開
  if(!drawMode) _enterDrawMode();
  _dldWatchDraw();
}

// ── STEP3: レイヤー別容量推定表示 ────────────────────────
function _dldUpdEst(){
  const zmin = parseInt(document.getElementById('dlg-det-zmin').value);
  const zmax = parseInt(document.getElementById('dlg-det-zmax').value);
  const bounds = _dldBounds;
  if(!bounds){
    document.getElementById('dld-est').innerHTML = '— 範囲が選択されていません —';
    return;
  }
  const base = cntTiles(bounds, zmin, zmax);
  let rows = '';
  const checkedLayers = [];
  ['std','photo','topo','hill','relief'].forEach(k=>{
    const ck = document.getElementById('dlg-ck-'+k);
    const checked = ck?.checked;
    if(checked) checkedLayers.push(k);
    rows += `<div class="dld-est-row${checked ? '' : ' dld-est-row--off'}">
      <span class="dld-est-lbl">${_DLD_LAYER_LABEL[k]}</span>
      <span class="dld-est-val">${checked
        ? `約 <b>${mbEst(base, k)} MB</b>`
        : '<span class="dld-est-off">0 MB</span>'}</span>
    </div>`;
  });
  const totalMb = mbEstLayers(base, checkedLayers);
  rows += `<div class="dld-est-row dld-est-total">
    <span class="dld-est-lbl">合計</span>
    <span class="dld-est-val">約 <b>${totalMb} MB</b></span>
  </div>`;
  document.getElementById('dld-est').innerHTML =
    `<div class="dld-est-range">Z${zmin}〜Z${zmax}</div>${rows}`;
}

// ── 重複DL確認ダイアログ ──────────────────────────────
/**
 * 指定範囲・レイヤーのキャッシュ重複率を計算し、重複があればダイアログを表示。
 * @returns {Promise<boolean>} true=保存続行 / false=キャンセル
 */
async function _checkDupAndConfirm(bounds, zmin, zmax, layers){
  if(!db) return true; // DB未初期化時はスキップ

  const LAYER_NAMES = {std:'地理院地図', photo:'航空写真', topo:'OpenTopo', hill:'陰影起伏図', relief:'色別標高図'};

  // レイヤーごとに全タイル数・キャッシュ済み数を集計
  const stats = [];
  for(const lk of layers){
    let total = 0, cached = 0;
    for(let z = zmin; z <= zmax; z++){
      const x0 = lon2x(bounds.getWest(), z),  x1 = lon2x(bounds.getEast(), z);
      const y0 = lat2y(bounds.getNorth(), z),  y1 = lat2y(bounds.getSouth(), z);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      total += count;

      // IDBキャッシュスキャン
      try{
        const prefix = `${lk}/${z}/`;
        const keys = await new Promise((res, rej) => {
          const tx  = db.transaction(ST, 'readonly');
          const req = tx.objectStore(ST).openKeyCursor(
            IDBKeyRange.bound(prefix, prefix + '\uffff', false, false)
          );
          const buf = [];
          req.onsuccess = e => { const c = e.target.result; if(c){ buf.push(c.key); c.continue(); } else res(buf); };
          req.onerror  = e => rej(e);
        });
        // bounds内に入るキーのみカウント
        for(const k of keys){
          const parts = k.split('/');
          if(parts.length < 4) continue;
          const kx = parseInt(parts[2]), ky = parseInt(parts[3]);
          if(kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1) cached++;
        }
      }catch(e){ /* スキャン失敗は0件扱い */ }
    }
    const pct = total > 0 ? Math.round(cached / total * 100) : 0;
    stats.push({ lk, name: LAYER_NAMES[lk] || lk, total, cached, pct });
  }

  // 重複が10%未満なら確認不要
  const anyDup = stats.some(s => s.pct >= 10);
  if(!anyDup) return true;

  // ダイアログHTML生成
  const rows = stats.map(s => {
    const filled = Math.round(s.pct / 10); // 10段階
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const cls = s.pct >= 80 ? 'dup-pct high' : s.pct >= 1 ? 'dup-pct mid' : 'dup-pct low';
    return `<div class="dup-row">
      <span class="dup-name">${s.name}</span>
      <span class="dup-bar">${bar}</span>
      <span class="${cls}">${s.pct}%</span>
    </div>`;
  }).join('');

  const html = `<div class="dup-dialog-body">
    <div class="dup-rows">${rows}</div>
    <p class="dup-note">このまま保存すると、重複分も含め新しいセッションカードとして保存されます。</p>
  </div>`;

  return new Promise(resolve => {
    // showConfirm がある場合は流用、なければ独自モーダル
    const overlay = document.createElement('div');
    overlay.className = 'dup-overlay';
    overlay.innerHTML = `
      <div class="dup-modal">
        <div class="dup-modal-title">⚠️ 保存済みのデータが含まれています</div>
        ${html}
        <div class="dup-modal-btns">
          <button class="btn dup-cancel-btn">キャンセル</button>
          <button class="btn dup-ok-btn">保存する</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.dup-cancel-btn').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('.dup-ok-btn').onclick    = () => { overlay.remove(); resolve(true);  };
  });
}

// ── STEP3: DL開始 → STEP4へ ──────────────────────────
async function _dldStartDl(){
  const layers = ['std','photo','topo','hill','relief'].filter(k=>
    document.getElementById('dlg-ck-'+k)?.checked
  );
  if(!layers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(!_dldBounds){    showAlert('エラー','範囲が選択されていません'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }

  // ── ベースDL未完了チェック（STEP3でレイヤーを変更した場合も必ずガード）──
  if(typeof getBaseDlDoneLayers === 'function'){
    const baseDone = await getBaseDlDoneLayers();
    const needBase = layers.filter(lk => !baseDone.has(lk));
    if(needBase.length){
      const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図','hill':'陰影起伏図','relief':'色別標高図'}[lk]||lk)).join('・');
      showAlert('ベースDLが必要です',`「${names}」はベースDL（Z5〜Z9 全国版）が完了していません。\nオフラインタブのベースDLを先に行ってください。`);
      return;
    }
  }

  const zmin = parseInt(document.getElementById('dlg-det-zmin').value);
  const zmax = parseInt(document.getElementById('dlg-det-zmax').value);

  if(_dldCheckSize(_dldBounds, zmax, layers)) return;

  // ── 重複DL確認 ──
  const proceed = await _checkDupAndConfirm(_dldBounds, zmin, zmax, layers);
  if(!proceed) return;

  detRect = _dldBounds;
  _dldRenderStep(3);
  await runDl('detail', detRect, zmin, zmax, layers, 0);
}

// ═══════════════════════════════════════════
//  ベースDL専用プログレスUI
// ═══════════════════════════════════════════

/** オーバーレイを開いてDL中フェーズに初期化 */
function _bdprogOpen(layers){
  _bdprogSetPhase('running');
  _bdprogSyncProgress(0, 0);
  document.getElementById('base-dl-prog-overlay').style.display = 'flex';
}

/** フェーズ切替: 'running' | 'stopping' | 'stopped' | 'done' | 'select' */
function _bdprogSetPhase(phase){
  const title = document.getElementById('bdprog-title');
  if(title){
    const map = {
      running:  '⬇ 全国ベースマップをDL中…',
      stopping: '⏳ 停止処理中です…',
      stopped:  '⏸ ダウンロードを停止しました',
      done:     '✅ ダウンロード完了',
      select:   '📥 追加DLするレイヤーを選択'
    };
    title.textContent = map[phase] || '';
  }
  ['running','stopping','stopped','done','select'].forEach(p=>{
    const el = document.getElementById('bdprog-btns-'+p);
    if(el) el.style.display = p===phase ? (p==='stopped'?'flex':'block') : 'none';
  });
  // バー色: 完了時グリーン、select時は非表示
  const barWrap = document.querySelector('#base-dl-prog-dialog .bdprog-bar-wrap');
  if(barWrap) barWrap.style.display = phase === 'select' ? 'none' : 'flex';
  const bar = document.getElementById('bdprog-bar');
  if(bar) bar.style.background = '';
}

/** プログレスバー・パーセンテージ更新 */
function _bdprogSyncProgress(done, total){
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const bar  = document.getElementById('bdprog-bar');
  const pctEl= document.getElementById('bdprog-pct');
  if(bar)   bar.style.width    = pct + '%';
  if(pctEl) pctEl.textContent  = pct + '%';
}

/** 追加DLボタン: selectフェーズへ遷移 */
async function _bdprogAddDl(){
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  _bdprogSetPhase('select');
  const body = document.getElementById('bdprog-select-body');
  if(!body) return;

  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  const LAYER_NAME = {std:'地理院地図', photo:'航空写真', topo:'地形図', hill:'陰影起伏図', relief:'色別標高図'};

  // 状況判定
  const doneLayers = (typeof getBaseDlDoneLayers === 'function')
    ? await getBaseDlDoneLayers()
    : new Set();
  const prog     = loadBaseDlProgress();
  const hasResume = prog && prog.layers && prog.layers.length > 0;
  const allDone   = ALL_LAYERS.every(lk => doneLayers.has(lk));

  if(allDone){
    // ③ 全完了: 追加できるものなし
    body.innerHTML = `<div class="bdprog-select-done">✅ 全レイヤーDL済みです</div>`;
    // DL開始ボタンを非表示
    const startBtn = body.parentElement.querySelector('.btn.accent');
    if(startBtn) startBtn.style.display = 'none';

  } else if(hasResume){
    // ② レジューム途中
    const pct    = prog.total > 0 ? Math.round(prog.taskIndex / prog.total * 100) : 0;
    const layers = prog.layers.map(lk => LAYER_NAME[lk]||lk).join(' ・ ');
    body.innerHTML = `
      <div class="bdprog-select-resume">
        <div class="bdprog-select-resume-label">⏸ 途中のDLがあります</div>
        <div class="bdprog-select-resume-layers">${layers}</div>
        <div class="base-resume-bar-bg" style="margin:6px 0">
          <div class="base-resume-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="bdprog-select-resume-pct">${pct}%</div>
      </div>`;
    // DL開始ボタンをレジューム用に差し替え
    const btnRow = document.getElementById('bdprog-btns-select');
    const startBtn = btnRow ? btnRow.querySelector('.btn.accent') : null;
    if(startBtn){
      startBtn.textContent = '▶ 続きをDL';
      startBtn.onclick = () => { _bdprogClose(); baseResumeStart(); };
    }
    // 破棄ボタンを追加（既存でなければ）
    if(btnRow && !btnRow.querySelector('.btn.red')){
      const discardBtn = document.createElement('button');
      discardBtn.className = 'btn sm red';
      discardBtn.textContent = '🗑 破棄';
      discardBtn.onclick = () => { baseResumeDiscard(); _bdprogAddDl(); };
      btnRow.insertBefore(discardBtn, btnRow.firstChild);
    }

  } else {
    // ① 未DL/一部未完了: チェックボックス生成
    const allSessions = (typeof dbGetAllSess === 'function') ? await dbGetAllSess() : [];
    const rows = ALL_LAYERS.map(lk => {
      const isDone = doneLayers.has(lk);
      const sess   = isDone ? allSessions.find(s => s.mode==='base' && Array.isArray(s.srcKeys) && s.srcKeys.includes(lk)) : null;
      const status = isDone
        ? `DL済${sess ? ` <button class="base-saved-del" onclick="deleteSessionWithConfirm('${sess.id}')" title="削除">🗑</button>` : ''}`
        : '';
      return `
        <label class="base-ck-row${isDone?' base-ck-row--done':''}">
          <input type="radio" name="base-layer-select" id="base-ck-${lk}" value="${lk}" ${isDone?'disabled':''} onchange="updBaseStatusEst()">
          <span class="base-ck-name">${LAYER_NAME[lk]}</span>
          <span class="base-ck-status">${status}</span>
        </label>`;
    }).join('');

    // 推定MB計算
    const undoneLayers = ALL_LAYERS.filter(lk => !doneLayers.has(lk));
    const n  = cntTiles(JAPAN, 5, 9);
    const mb = undoneLayers.length ? mbEstLayers(n, undoneLayers) : '—';

    body.innerHTML = `
      <div class="base-ck-list">${rows}</div>
      <div class="base-status-est" id="base-status-est">約 ${mb} MB</div>
      <div class="base-status-warn">⚠️ WiFi環境でのDLを推奨します</div>`;

    // DL開始ボタンを通常に戻す
    const startBtn = body.parentElement.querySelector('.btn.accent');
    if(startBtn){
      startBtn.style.display = '';
      startBtn.textContent = '⬇ DL開始';
      startBtn.onclick = startBaseDlFromStatus;
    }
  }
}

/** 停止ボタン */
function _bdprogStop(){
  dlStop = true;
  if(_dlAbortCtrl) _dlAbortCtrl.abort();
  _bdprogSetPhase('stopping');
}

/** 閉じる */
function _bdprogClose(){
  document.getElementById('base-dl-prog-overlay').style.display = 'none';
}

/** レジューム再開 */
async function _bdprogResume(){
  const s = loadResume();
  if(!s || s.mode !== 'base'){ showAlert('エラー','レジュームデータがありません'); return; }
  const layers = s.layers;
  if(!layers||!layers.length) return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません'); return; }
  _bdprogOpen(layers);
  await runDl('base', JAPAN, s.zmin, s.zmax, layers, 0);
}

// ═══════════════════════════════════════════
//  レジューム管理
// ═══════════════════════════════════════════
const RESUME_KEY='gm_dl_resume';

/** 未完了レジュームがあればアラートを出してtrueを返す（DL開始ガード共通） */
function _guardResume(){
  const s = loadResume();
  if(!s) return false;
  const pct  = s.total > 0 ? Math.round(s.taskIndex / s.total * 100) : 0;
  const kind = s.mode === 'base'           ? 'ベースDL'
             : s.subMode === 'circle'      ? '半径エリアDL'
             : s.subMode === 'addlayer'    ? '追加レイヤーDL'
             : '矩形エリアDL';
  showAlert('⚠️ 未完了のDLがあります',
    `${kind}が途中で停止しています（進捗 ${pct}%）。\n再開バナーから再開または破棄してから操作してください。`);
  return true;
}

function saveResume(state){
  try{ localStorage.setItem(RESUME_KEY,JSON.stringify(state)); }catch(e){}
}
function loadResume(){
  try{ return JSON.parse(localStorage.getItem(RESUME_KEY)||'null'); }catch(e){return null;}
}
function deleteResume(){
  localStorage.removeItem(RESUME_KEY);
}

// ═══════════════════════════════════════════
//  ベースDL進捗（専用キー）
// ═══════════════════════════════════════════
const BASE_DL_PROG_KEY = 'gm_base_dl_progress';

/** ベースDL進捗を保存 */
function saveBaseDlProgress(state){
  try{ localStorage.setItem(BASE_DL_PROG_KEY, JSON.stringify(state)); }catch(e){}
}
/** ベースDL進捗を読み込む */
function loadBaseDlProgress(){
  try{ return JSON.parse(localStorage.getItem(BASE_DL_PROG_KEY)||'null'); }catch(e){return null;}
}
/** ベースDL進捗を削除 */
function deleteBaseDlProgress(){
  localStorage.removeItem(BASE_DL_PROG_KEY);
}

/** ベースDL状況UIを更新（3状態）
 *  - 全完了   → #base-dl-state-done
 *  - 途中保存 → #base-dl-state-resume
 *  - それ以外 → #base-dl-state-partial（各レイヤー済み表示）
 */
async function refreshBaseDlStatus(){
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  const LAYER_NAME = {std:'地理院地図', photo:'航空写真', topo:'地形図', hill:'陰影起伏図', relief:'色別標高図'};

  const elPartial = document.getElementById('base-dl-state-partial');
  const elResume  = document.getElementById('base-dl-state-resume');
  const elDone    = document.getElementById('base-dl-state-done');
  if(!elPartial || !elResume || !elDone) return;

  // 完了済みレイヤーを取得
  const done = (typeof getBaseDlDoneLayers === 'function')
    ? await getBaseDlDoneLayers()
    : new Set();

  // 途中保存チェック
  const prog = loadBaseDlProgress();
  const hasResume = prog && prog.layers && prog.layers.length > 0;

  const allDone = ALL_LAYERS.every(lk => done.has(lk));

  if(allDone){
    // ③ 全完了
    elPartial.style.display = 'none';
    elResume.style.display  = 'none';
    elDone.style.display    = 'block';
    // 各レイヤー行のステータスにゴミ箱ボタンを動的挿入
    const allSessions = (typeof dbGetAllSess === 'function') ? await dbGetAllSess() : [];
    ALL_LAYERS.forEach((lk, i) => {
      const rows = elDone.querySelectorAll('.base-ck-row--done');
      const st   = rows[i]?.querySelector('.base-ck-status');
      if(!st) return;
      const sess = allSessions.find(s =>
        s.mode === 'base' && Array.isArray(s.srcKeys) && s.srcKeys.includes(lk)
      );
      st.innerHTML = 'DL済' +
        (sess ? ` <button class="base-saved-del" onclick="deleteSessionWithConfirm('${sess.id}')" title="削除">🗑</button>` : '');
    });
  } else if(hasResume){
    // ② 途中
    elPartial.style.display = 'none';
    elResume.style.display  = 'block';
    elDone.style.display    = 'none';
    // 進捗バー・%・レイヤー名を更新
    const pct = prog.total > 0 ? Math.round(prog.taskIndex / prog.total * 100) : 0;
    const pctEl  = document.getElementById('base-resume-pct');
    const barEl  = document.getElementById('base-resume-bar-fill');
    const lyrsEl = document.getElementById('base-resume-layers');
    if(pctEl)  pctEl.textContent  = pct + '%';
    if(barEl)  barEl.style.width  = pct + '%';
    if(lyrsEl) lyrsEl.textContent = prog.layers.map(lk => LAYER_NAME[lk]||lk).join(' ・ ');
  } else {
    // ① 未DL/一部未完了
    elPartial.style.display = 'block';
    elResume.style.display  = 'none';
    elDone.style.display    = 'none';
    // ゴミ箱表示のためセッション一覧を取得
    const allSessions = (typeof dbGetAllSess === 'function') ? await dbGetAllSess() : [];
    ALL_LAYERS.forEach(lk => {
      // radio: DL済みはchecked+disabled、未DLはdisabledのみ解除（選択状態は維持）
      const ck = document.getElementById('base-ck-' + lk);
      if(ck){
        ck.disabled = done.has(lk);  // DL済みは変更不可
        if(done.has(lk)) ck.checked = false; // DL済みは選択解除
      }
      // ステータス表示 + DL済みにはゴミ箱
      const st = document.getElementById('base-status-' + lk);
      if(!st) return;
      if(done.has(lk)){
        const sess = allSessions.find(s =>
          s.mode === 'base' && Array.isArray(s.srcKeys) && s.srcKeys.includes(lk)
        );
        st.innerHTML = 'DL済' +
          (sess ? ` <button class="base-saved-del" onclick="deleteSessionWithConfirm('${sess.id}')" title="削除">🗑</button>` : '');
      } else {
        st.textContent = '';
      }
    });
    // 推定MB更新
    updBaseStatusEst();
  }
}

/** ② 途中: 続きをDL */
async function baseResumeStart(){
  // RESUME_KEY（gm_dl_resume）を正とする。
  // BASE_DL_PROG_KEY（gm_base_dl_progress）はUIの進捗表示用のみ。
  const prog = loadResume();
  if(!prog || prog.mode !== 'base' || !prog.layers || !prog.layers.length){
    showAlert('エラー','レジュームデータがありません');
    return;
  }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(!navigator.onLine){
    showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。');
    return;
  }
  _bdprogOpen(prog.layers);
  _bdprogSyncProgress(prog.taskIndex || 0, prog.total || 0);
  _bdprogSetPhase('running');
  await runDl('base', JAPAN, prog.zmin || 5, prog.zmax || 9, prog.layers, 0);
}

/** ② 途中: 破棄 */
function baseResumeDiscard(){
  deleteBaseDlProgress();
  deleteResume();          // _guardResume() が見る RESUME_KEY も必ず削除
  refreshBaseDlStatus();
}

function checkResume(){
  const s=loadResume(); if(!s)return;
  if(s.mode==='base'){
    // ベースDL: 専用プログレスオーバーレイをレジューム状態で表示
    _bdprogOpen(s.layers||[]);
    const pct = s.total>0 ? Math.round(s.taskIndex/s.total*100) : 0;
    _bdprogSyncProgress(s.taskIndex||0, s.total||0);
    _bdprogSetPhase('stopped');
  } else if(s.subMode==='addlayer'){
    // 追加レイヤーDL: resume-bannerを使用
    const banner=document.getElementById('resume-banner');
    const layerStr=_layerLabel(s.layers);
    const pct=s.total>0?Math.round(s.taskIndex/s.total*100):0;
    // bounds中心座標を表示
    let areaStr = '';
    if(s.bounds){
      const clat = ((s.bounds.n + s.bounds.s) / 2).toFixed(2);
      const clng = ((s.bounds.e + s.bounds.w) / 2).toFixed(2);
      areaStr = `<br>📍 ${clat}, ${clng}`;
    }
    document.getElementById('resume-desc').innerHTML=
      `追加レイヤー / ${layerStr}${areaStr}<br>Z${s.zmin}〜Z${s.zmax} / 進捗 <b>${fmt(s.taskIndex)} / ${fmt(s.total)}（${pct}%）</b><br>保存: ${s.savedAt||'—'}`;
    banner.classList.add('show');
  } else if(s.subMode==='circle'){
    // 半径エリアDL: resume-banner を使用
    const banner=document.getElementById('resume-banner');
    const layerStr=_layerLabel(s.layers);
    const pct=s.total>0?Math.round(s.taskIndex/s.total*100):0;
    // 中心座標・半径を表示
    let areaStr = '';
    if(s.center){
      const clat = s.center.lat.toFixed(2);
      const clng = s.center.lng.toFixed(2);
      const km   = s.radiusKm ? `半径 ${s.radiusKm} km` : '';
      areaStr = `<br>📍 ${clat}, ${clng}${km ? ' / ' + km : ''}`;
    }
    document.getElementById('resume-desc').innerHTML=
      `半径エリア / ${layerStr}${areaStr}<br>Z${s.zmin}〜Z${s.zmax} / 進捗 <b>${fmt(s.taskIndex)} / ${fmt(s.total)}（${pct}%）</b><br>保存: ${s.savedAt||'—'}`;
    banner.classList.add('show');
  } else {
    // detail（矩形）: resume-bannerを使用
    const banner=document.getElementById('resume-banner');
    const layerStr=_layerLabel(s.layers);
    const pct=s.total>0?Math.round(s.taskIndex/s.total*100):0;
    // bounds中心座標を表示
    let areaStr = '';
    if(s.bounds){
      const clat = ((s.bounds.n + s.bounds.s) / 2).toFixed(2);
      const clng = ((s.bounds.e + s.bounds.w) / 2).toFixed(2);
      areaStr = `<br>📍 ${clat}, ${clng}`;
    }
    document.getElementById('resume-desc').innerHTML=
      `詳細範囲 / ${layerStr}${areaStr}<br>Z${s.zmin}〜Z${s.zmax} / 進捗 <b>${fmt(s.taskIndex)} / ${fmt(s.total)}（${pct}%）</b><br>保存: ${s.savedAt||'—'}`;
    banner.classList.add('show');
  }
}

function clearResume(){
  deleteResume();
  document.getElementById('resume-banner').classList.remove('show');
}

/**
 * detail矩形モード専用: dl-dialogをSTEP3で再オープンしてDLを再開する。
 * openDlDialog()はリセット処理が入るため別関数で管理する。
 */
function _openDlDialogForResume(s){
  // プレビュー矩形を復元
  const bounds = L.latLngBounds([s.bounds.s, s.bounds.w], [s.bounds.n, s.bounds.e]);
  detRect      = bounds;
  _dldBounds   = bounds;
  showRect();
  // STEP3を直接表示（STEP0〜2はスキップ）
  _dldStep = 3;
  ['dld-s0','dld-s1','dld-s2','dld-s3'].forEach((id,i)=>{
    const el = document.getElementById(id);
    if(el) el.style.display = (i===3) ? 'block' : 'none';
  });
  [0,1,2,3].forEach(n=>{
    const el = document.getElementById('dld-si-'+n);
    if(!el) return;
    el.classList.toggle('active', n===3);
    el.classList.toggle('done',   n<3);
  });
  document.getElementById('dl-dialog').style.display = 'block';
  _openTab('map');
}

async function resumeDl(){
  const s=loadResume(); if(!s)return;
  const layers=s.layers; if(!layers||!layers.length)return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }

  document.getElementById('resume-banner').classList.remove('show');

  if(s.subMode==='addlayer'){
    // ── 追加レイヤーDL再開: adpパネルを開いてそのまま再開 ──
    const parentSessId = s.parentSessId || null;
    if(!parentSessId){ showAlert('エラー','セッション情報がありません'); return; }
    _openTab('offline');
    // move adp-{sessId} panel to dialog (adpRoute unified)
    await openAddLayerPanel(parentSessId);
    const sess2 = await dbGetSess(parentSessId).catch(()=>null);
    if(!sess2||!sess2.bounds){ showAlert('エラー','セッション情報がありません'); return; }
    const b2 = sess2.bounds;
    const bounds2 = L.latLngBounds([[b2.s,b2.w],[b2.n,b2.e]]);
    _adpShowProgress(parentSessId, s.layers);
    window._dldSyncProgressOverride = null; // 二重フック防止
    _adpMirrorDlProgress(parentSessId);
    _adpSetPhase(parentSessId, 'running');
    await runDl('detail', bounds2, s.zmin, s.zmax, s.layers, 0, parentSessId);
    window._dldSyncProgressOverride = null;
    if(dlStop){ _adpSetPhase(parentSessId, 'stopped'); return; }
    _adpSetPhase(parentSessId, 'done');
    await refreshCache();

  } else if(s.subMode==='circle'){
    // ── 半径エリアDL再開: cdld-panelフェーズ④を開いてDL再開 ──
    _cdldCenter = s.center || null;
    // プレビュー矩形を復元
    if(_cdldCenter){
      if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
      const _resumeBounds2 = _cdldBounds(_cdldCenter.lat, _cdldCenter.lng, s.radiusKm || 5);
      _cdldCircle = L.rectangle(_resumeBounds2, {
        color: '#c8a84b', weight: 2,
        dashArray: '4 3',
        fillColor: '#c8a84b', fillOpacity: 0.10
      }).addTo(map);
    }
    // パネルをフェーズ④（進捗画面）で表示してから再開
    _cdldShowPhase('cdld-ph4');
    _cdldPh3SetPhase('running');
    _cdldSyncProgress(s.taskIndex||0, s.total||0, '— MB');
    _openTab('map');
    // _cdldActiveSessionを復元（runDl内の完了分岐判定に使われる）
    window._cdldActiveSession = { center: s.center, radiusKm: s.radiusKm };
    window._dldSyncProgressOverride = (done, total, mb) => _cdldSyncProgress(done, total, mb);
    const bounds = L.latLngBounds([s.bounds.s, s.bounds.w], [s.bounds.n, s.bounds.e]);
    await runDl('detail', bounds, s.zmin, s.zmax, layers, 0);
    window._dldSyncProgressOverride = null;
    window._cdldActiveSession = null;
    if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
    // ※ runDl内で _cdldPh3SetPhase('done') + _cdldShowDonePanel() が自動で呼ばれる

  } else {
    // ── detail矩形DL再開: dl-dialogをSTEP3で再オープン ──
    _openDlDialogForResume(s);
    _dldS3SetPhase('running');
    _dldSyncProgress(s.taskIndex||0, s.total||0, '— MB');
    const bounds = L.latLngBounds([s.bounds.s, s.bounds.w], [s.bounds.n, s.bounds.e]);
    await runDl(s.mode || 'detail', bounds, s.zmin, s.zmax, layers, 0);
    // ※ runDl内で _dldS3SetPhase('done') + _dldShowDonePanel() が自動で呼ばれる
  }
}

// ═══════════════════════════════════════════
//  STEP3 UI制御
// ═══════════════════════════════════════════

/**
 * STEP3のフェーズを切り替える。
 * phase: 'running' | 'stopping' | 'stopped' | 'done'
 */
function _dldS3SetPhase(phase){
  const _e = id => document.getElementById(id);

  // タイトル切り替え
  const title = _e('dld-s3-title');
  if(title){
    const map = {
      running:  '⬇ タイルをダウンロード中です…',
      stopping: '⏳ 停止処理中です…',
      stopped:  '⏸ ダウンロードを停止しました',
      done:     '✅ ダウンロード完了'
    };
    title.textContent = map[phase] || '';
  }

  // 停止中メッセージ
  const stopMsg = _e('dld-stopping-msg');
  if(stopMsg) stopMsg.style.display = phase === 'stopping' ? 'block' : 'none';

  // 停止後: レジューム情報を表示
  const resumeInfo = _e('dld-resume-info');
  if(resumeInfo){
    if(phase === 'stopped'){
      const s = loadResume();
      if(s){
        const pct = s.total > 0 ? Math.round(s.taskIndex / s.total * 100) : 0;
        const pctEl   = _e('dld-resume-pct-val');
        const savedEl = _e('dld-resume-saved');
        if(pctEl)   pctEl.textContent   = pct + '%';
        if(savedEl) savedEl.textContent = s.savedAt ? '保存: ' + s.savedAt : '';
      }
      resumeInfo.style.display = 'block';
    } else {
      resumeInfo.style.display = 'none';
    }
  }

  // バー色: 完了時は金色・アニメなし / 停止時はリセット
  if(phase === 'stopped' || phase === 'done'){
    const bar = _e('dld-pb-bar');
    if(bar){
      if(phase === 'done'){
        bar.style.transition = 'none';
        bar.style.background = '';
        bar.classList.add('--done');
      } else {
        bar.style.background = '';
        bar.classList.remove('--done');
      }
    }
  }

  // 完了パネル
  const donePanel = _e('dld-s3-done-panel');
  if(donePanel) donePanel.style.display = phase === 'done' ? 'block' : 'none';

  // ボタン群切り替え
  ['running','stopping','stopped','done'].forEach(p => {
    const el = _e('dld-btns-' + p);
    if(el) el.style.display = p === phase ? 'flex' : 'none';
  });
}

/**
 * STEP3停止後「▶ 再開」ボタン: ダイアログを閉じずにそのまま再開する。
 * loadResume()でdetail/circle両モード対応。
 */
async function _dldS3ResumeFromDialog(){
  const s = loadResume();
  if(!s){ showAlert('エラー','レジュームデータがありません'); return; }
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません'); return; }

  const bounds = s.mode === 'base'
    ? JAPAN
    : L.latLngBounds([s.bounds.s, s.bounds.w], [s.bounds.n, s.bounds.e]);

  _dldS3SetPhase('running');
  _dldSyncProgress(s.taskIndex || 0, s.total || 0, '— MB');

  if(s.subMode === 'circle'){
    // 円形モード: _cdldActiveSessionを復元してcdldルートで完了処理が走るようにする
    _cdldCenter = s.center || null;
    window._cdldActiveSession = { center: s.center, radiusKm: s.radiusKm };
    window._dldSyncProgressOverride = (done, total, mb) => _cdldSyncProgress(done, total, mb);
    await runDl('detail', bounds, s.zmin, s.zmax, s.layers, 0);
    window._dldSyncProgressOverride = null;
    window._cdldActiveSession = null;
    if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
    // ※ runDl内で _cdldPh3SetPhase('done') + _cdldShowDonePanel() が自動で呼ばれる
  } else {
    detRect = bounds;
    await runDl(s.mode || 'detail', bounds, s.zmin, s.zmax, s.layers, 0);
    // ※ runDl内で _dldS3SetPhase('done') + _dldShowDonePanel() が自動で呼ばれる
  }
}

/**
 * STEP3の進捗バーを更新する。パーセント・ETA付き。
 */
function _dldSyncProgress(done, total, mb){
  // 半径エリアDL中は cdld-ph3 の進捗バーに転送
  if(typeof window._dldSyncProgressOverride === 'function'){
    window._dldSyncProgressOverride(done, total, mb);
    return;
  }
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const _e = id => document.getElementById(id);
  if(_e('dld-pb-bar'))  _e('dld-pb-bar').style.width = pct + '%';
  if(_e('dld-pb-pct'))  _e('dld-pb-pct').textContent = pct + '%';
}

/**
 * DL完了後パネルを表示する。
 * 完了サマリー＋追加DLパネルを埋め込む。
 */
async function _dldShowDonePanel(done, realBytes, layers, zmin, zmax, sessId){
  const summary = document.getElementById('dld-done-summary');
  if(summary){
    const mb = (realBytes / 1024 / 1024).toFixed(1);
    const layerNames = _layerLabel(layers, '・');
    summary.innerHTML =
      `<div class="dld-done-row">🗂 ${layerNames}</div>` +
      `<div class="dld-done-row">🔍 Z${zmin}〜Z${zmax}</div>` +
      `<div class="dld-done-row">💾 約 ${mb} MB</div>`;
  }

  const addBtn = document.getElementById('dld-btn-addlayer');

  if(!sessId){
    if(addBtn) addBtn.style.display = 'none';
    return;
  }

  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess || !sess.bounds){
    if(addBtn) addBtn.style.display = 'none';
    return;
  }

  // 追加DL可能レイヤーがあるか仮レンダリングで確認
  const tmp = document.createElement('div');
  await _dldRenderAddLayerPanel(sessId, sess, tmp);
  const hasPending = tmp.querySelector('.dldadp-ck:not(:disabled)');

  if(addBtn){
    addBtn.style.display = hasPending ? 'inline-flex' : 'none';
    addBtn.dataset.sessId = sessId;
  }
}

// ── 誘導ボタン → 追加レイヤーダイアログを開く ───────────────
function _dldScrollToAddLayer(){
  const addBtn = document.getElementById('dld-btn-addlayer');
  const sessId = addBtn?.dataset.sessId;
  _addlayerDialogOpen(sessId);
}

// ═══════════════════════════════════════════
//  追加レイヤーDLダイアログ（円形・矩形共通）
// ═══════════════════════════════════════════

/** 追加レイヤーダイアログを開く */
async function _addlayerDialogOpen(sessId){
  const overlay = document.getElementById('addlayer-dialog');
  const body    = document.getElementById('addlayer-dialog-body');
  if(!overlay || !body) return;

  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt-dim)">読み込み中…</div>';
  overlay.style.display = 'flex';

  if(!sessId){
    body.innerHTML = '<div style="padding:12px;color:var(--txt-dim)">セッション情報が見つかりません</div>';
    return;
  }

  const sess = await dbGetSess(sessId).catch(() => null);
  if(!sess || !sess.bounds){
    body.innerHTML = '<div style="padding:12px;color:var(--txt-dim)">セッション情報が見つかりません</div>';
    return;
  }

  await _dldRenderAddLayerPanel(sessId, sess, body);
}

/** 追加レイヤーダイアログを閉じる（DL完了パネル経由） */
function _addlayerDialogClose(){
  const overlay = document.getElementById('addlayer-dialog');
  if(overlay) overlay.style.display = 'none';
}

/**
 * ダイアログの✕・閉じるボタン共通クローズ関数。
 * セッション一覧＋ボタン経由（adp-パネルを移動済み）の場合は
 * closeAddLayerPanel でパネルを元の位置に戻す。
 * DL完了パネル経由の場合は _addlayerDialogClose で単純に閉じる。
 */
function _addlayerDialogCloseAny(){
  const dlg = document.getElementById('addlayer-dialog');
  if(!dlg) return;
  if(dlg.dataset.adpSessId){
    // セッション一覧＋ボタン経由: パネルを元に戻す
    closeAddLayerPanel(dlg.dataset.adpSessId);
  } else {
    // DL完了パネル経由: 単純に閉じる
    _addlayerDialogClose();
  }
}

// ═══════════════════════════════════════════
//  STEP3完了パネル専用 追加レイヤーDLパネル
// ═══════════════════════════════════════════

/**
 * STEP3完了パネル内に追加レイヤーDLパネルを直接生成する。
 * openAddLayerPanel とは独立した専用実装。DOM依存なし。
 * @param {string} sessId
 * @param {object} sess  - dbGetSessの結果
 * @param {HTMLElement} container - 描画先要素
 */
async function _dldRenderAddLayerPanel(sessId, sess, container){
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  const LAYER_NAME = {std:'地理院地図', photo:'航空写真', topo:'地形図', hill:'陰影起伏図', relief:'色別標高図'};
  const MAX_NATIVE  = {std:18, photo:18, topo:17, hill:16, relief:15};

  // ── スキャン（_adpScanCacheを共用） ──────────────────────
  delete _adpScanCache[sessId]; // 常に最新を取得
  const scanResult = await _scanAdpTiles(sess);

  // ── レイヤー別の状態を判定 ──────────────────────────────
  // done: 全ズームキャッシュ済み → disabled
  // pending: 未DLズームあり → 選択可
  const layerStates = {}; // {done, maxDoneZ, badge}
  ALL_LAYERS.forEach(lk => {
    const lkData = scanResult[lk];
    let maxDoneZ = null, allDone = true, hasAnyTile = false;
    const maxNative = MAX_NATIVE[lk];
    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      if(z > maxNative) continue;
      const pz = lkData?.perZoom?.[z];
      if(!pz || pz.total === 0) continue;
      hasAnyTile = true;
      if(pz.status === 'done') maxDoneZ = z;
      else allDone = false;
    }
    if(!hasAnyTile) allDone = false;

    const reachedMax = maxDoneZ !== null && maxDoneZ >= maxNative;
    const badge = maxDoneZ !== null
      ? (reachedMax ? '✅ MAXまで完了' : `Z${maxDoneZ}まで完了`)
      : '';
    layerStates[lk] = {done: allDone, maxDoneZ, badge, reachedMax};
  });

  // ── ズームselectの選択肢生成（Z10〜Z18） ─────────────────
  const zmaxOpts = Array.from({length:9}, (_,i)=>10+i).map(z => {
    const warn = z >= 17 ? '⚠️ ' : '';
    return `<option value="${z}">${warn}Z${z}</option>`;
  }).join('');

  // ── ズームデフォルト：未完了レイヤーの最小nextZminから推定 ──
  const nextZmins = ALL_LAYERS
    .filter(lk => !layerStates[lk].done)
    .map(lk => (layerStates[lk].maxDoneZ ?? (sess.zmax || 15)) + 1);
  const defaultZmax = nextZmins.length
    ? Math.max(Math.min(...nextZmins), 16)
    : (sess.zmax || 16);

  // ── チェックボックス行HTML生成 ────────────────────────────
  const ckRows = ALL_LAYERS.map(lk => {
    const {done, badge, reachedMax} = layerStates[lk];
    const disabledAttr = done ? 'disabled checked' : '';
    const doneClass    = done ? ' dldadp-layer--done' : '';
    const badgeColor   = done
      ? (reachedMax ? '#4caf50' : '#888')
      : (badge ? '#888' : '');
    const badgeWeight  = reachedMax ? '700' : '';
    const baseOk = localStorage.getItem('cachedMaxZoom_' + lk) !== null;
    const baseBadge = baseOk
      ? `<span class="adp-base-badge adp-base-ok">✅ベース済</span>`
      : `<span class="adp-base-badge adp-base-ng">⚠️ベース未</span>`;
    return `
      <label class="dldadp-layer${doneClass}">
        <input type="checkbox" class="dldadp-ck" data-lk="${lk}"
          ${disabledAttr}
          onchange="_dldAdpOnChange('${sessId}')">
        <span class="dldadp-name">${LAYER_NAME[lk]}</span>
        ${baseBadge}
        <span class="dldadp-badge" style="color:${badgeColor};font-weight:${badgeWeight}">${badge}</span>
      </label>`;
  }).join('');

  // ── 全完了チェック ────────────────────────────────────────
  const allComplete = ALL_LAYERS.every(lk => layerStates[lk].done);

  container.innerHTML = `
    <div class="dldadp-panel" id="dldadp-${sessId}">
      <div class="dldadp-title">📥 レイヤーを追加DL</div>
      ${allComplete
        ? `<div class="dldadp-all-done">✅ このエリアは全ズーム・全レイヤーが取得済みです</div>`
        : `<div class="dldadp-layers">${ckRows}</div>
           <div class="dldadp-zoom-row">
             <label class="dldadp-zoom-lbl">ズーム（最大）</label>
             <select id="dldadp-zmax-${sessId}" class="dldadp-zmax"
               onchange="_dldAdpOnChange('${sessId}')">${zmaxOpts}</select>
           </div>
           <div class="dldadp-est" id="dldadp-est-${sessId}">レイヤーを選択してください</div>
           <button class="btn accent dldadp-btn" id="dldadp-btn-${sessId}"
             onclick="_dldAdpStart('${sessId}')" disabled>⬇ DL開始</button>
           <div class="dldadp-prog" id="dldadp-prog-${sessId}" style="display:none">
             <div class="dldadp-prog-bar-wrap">
               <div class="s3-pb-track">
                 <div class="s3-pb-fill" id="dldadp-prog-bar-${sessId}" style="width:0%"></div>
               </div>
               <div class="dldadp-prog-pct" id="dldadp-prog-pct-${sessId}">0%</div>
             </div>
           </div>`
      }
    </div>`;

  // zmaxのデフォルト値をセット
  const zmaxEl = document.getElementById(`dldadp-zmax-${sessId}`);
  if(zmaxEl){
    const clampedDefault = Math.min(defaultZmax, 18);
    // 選択肢内で最近い値を選ぶ
    const opt = [...zmaxEl.options].reverse().find(o => parseInt(o.value) <= clampedDefault);
    if(opt) zmaxEl.value = opt.value;
    // レイヤーに応じたcap制御
    _dldAdpCapZmax(sessId);
  }
}

/** dldadp: チェック変更 → cap更新 → 容量推定更新 */
function _dldAdpOnChange(sessId){
  _dldAdpCapZmax(sessId);
  _dldAdpUpdEst(sessId);
}

/** dldadp: 選択レイヤーのmaxNativeZoomでzmax selectをcap */
function _dldAdpCapZmax(sessId){
  const MAX_NATIVE = {std:18, photo:18, topo:17, hill:16, relief:15};
  const zmaxEl = document.getElementById(`dldadp-zmax-${sessId}`);
  if(!zmaxEl) return;
  const checked = [...document.querySelectorAll(`#dldadp-${sessId} .dldadp-ck:not(:disabled):checked`)]
    .map(el => el.dataset.lk);
  const cap = checked.length ? Math.min(...checked.map(lk => MAX_NATIVE[lk] ?? 18)) : 18;
  [...zmaxEl.options].forEach(o => {
    const z = parseInt(o.value);
    o.disabled = z > cap;
  });
  if(parseInt(zmaxEl.value) > cap){
    const fallback = [...zmaxEl.options].reverse().find(o => parseInt(o.value) <= cap && !o.disabled);
    if(fallback) zmaxEl.value = fallback.value;
  }
}

/** dldadp: 容量推定を更新してDLボタンの有効/無効を制御 */
async function _dldAdpUpdEst(sessId){
  const estEl = document.getElementById(`dldadp-est-${sessId}`);
  const btn   = document.getElementById(`dldadp-btn-${sessId}`);
  const checked = [...document.querySelectorAll(`#dldadp-${sessId} .dldadp-ck:not(:disabled):checked`)]
    .map(el => el.dataset.lk);

  if(!checked.length){
    if(estEl) estEl.textContent = 'レイヤーを選択してください';
    if(btn)   btn.disabled = true;
    return;
  }

  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess || !sess.bounds){ if(btn) btn.disabled = true; return; }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const zmaxEl = document.getElementById(`dldadp-zmax-${sessId}`);
  const zmax = parseInt(zmaxEl?.value) || sess.zmax || 16;
  const zmin = ADP_SCAN_ZMIN; // Z10固定

  // ベースDL未完了チェック
  const baseDone = await getBaseDlDoneLayers();
  const needBase = checked.filter(lk =>
    !(sess.srcKeys||[]).includes(lk) && !baseDone.has(lk)
  );
  if(needBase.length){
    const names = needBase.map(lk=>_DLD_LAYER_LABEL[lk]||lk).join('・');
    if(estEl) estEl.innerHTML =
      `<span style="color:#ffaa00">⚠️「${names}」はベースDL（全国Z5〜Z9）が必要です</span>` +
      `<br><button class="btn sm" style="margin-top:6px" onclick="_addlayerDialogCloseAny();_dldCancel();_goToBaseDl()">📥 ベースDLへ</button>`;
    if(btn) btn.disabled = true;
    return;
  }

  // IDBスキャンで正確な未DL枚数を計算
  let netTiles = 0, totalTiles = 0;
  try {
    for(const lk of checked){
      for(let z = zmin; z <= zmax; z++){
        const cnt = typeof cntTiles === 'function' ? cntTiles(bounds, z, z) : 0;
        totalTiles += cnt;
        let cached = 0;
        try { cached = await _countCachedTilesForZoom(lk, z, bounds); } catch(e){}
        netTiles += Math.max(0, cnt - cached);
      }
    }
  } catch(e){ netTiles = 0; }

  const avgKb = checked.reduce((s,lk)=>s+(LAYER_KB[lk]||10),0) / checked.length;
  const netMb = (netTiles * avgKb * 1024 / 1024 / 1024).toFixed(0);
  const overLimit = netTiles * avgKb * 1024 > DL_SESSION_MAX;

  if(estEl) estEl.innerHTML =
    `<span${overLimit?' style="color:#ff5a47"':''}>未DL: 約 ${netMb} MB（${netTiles.toLocaleString()}枚）${overLimit?' — 200MB超過':''}</span>`;

  if(btn) btn.disabled = overLimit || netTiles === 0;
}

/** dldadp: DL開始 */
async function _dldAdpStart(sessId){
  const checked = [...document.querySelectorAll(`#dldadp-${sessId} .dldadp-ck:not(:disabled):checked`)]
    .map(el => el.dataset.lk);
  if(!checked.length){ showAlert('エラー','レイヤーを選択してください'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません'); return; }

  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess || !sess.bounds){ showAlert('エラー','範囲情報がありません'); return; }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const zmaxEl = document.getElementById(`dldadp-zmax-${sessId}`);
  const zmax = parseInt(zmaxEl?.value) || sess.zmax || 16;
  const zmin = ADP_SCAN_ZMIN;

  // UI → DL中モードに切替
  const panel = document.getElementById(`dldadp-${sessId}`);
  if(panel){
    const layersEl = panel.querySelector('.dldadp-layers');
    const zoomRow  = panel.querySelector('.dldadp-zoom-row');
    const estEl    = document.getElementById(`dldadp-est-${sessId}`);
    const btn      = document.getElementById(`dldadp-btn-${sessId}`);
    const prog     = document.getElementById(`dldadp-prog-${sessId}`);
    if(layersEl) layersEl.style.display = 'none';
    if(zoomRow)  zoomRow.style.display  = 'none';
    if(estEl)    estEl.style.display    = 'none';
    if(btn)      btn.style.display      = 'none';
    if(prog){
      prog.style.display     = 'block';
      // 停止ボタンを追加（既存でなければ）
      if(!document.getElementById(`dldadp-stop-${sessId}`)){
        const stopBtn = document.createElement('button');
        stopBtn.id = `dldadp-stop-${sessId}`;
        stopBtn.className = 'btn sm red';
        stopBtn.style.cssText = 'margin-top:8px;width:100%';
        stopBtn.textContent = '⏹ 停止';
        stopBtn.onclick = () => {
          dlStop = true;
          if(_dlAbortCtrl) _dlAbortCtrl.abort();
          stopBtn.disabled = true;
          stopBtn.textContent = '⏳ 停止中…';
        };
        prog.appendChild(stopBtn);
      }
    }
    // STEP3プログレスバーをミラーリング
    _dldAdpMirrorProgress(sessId);
  }

  await runDl('detail', bounds, zmin, zmax, checked, 0, sessId);

  // ミラーリング用オーバーライドをリセット
  window._dldSyncProgressOverride = null;
  // 停止ボタンを除去
  const stopBtn = document.getElementById(`dldadp-stop-${sessId}`);
  if(stopBtn) stopBtn.remove();

  // DL完了 → 完了表示
  const progBar = document.getElementById(`dldadp-prog-bar-${sessId}`);
  const progPct = document.getElementById(`dldadp-prog-pct-${sessId}`);
  if(progBar){ progBar.style.transition = 'none'; progBar.style.width = '100%'; progBar.style.background = ''; progBar.classList.add('--done'); }
  if(progPct) progPct.textContent = '✅';

  // 誘導ボタンを再判定（追加DL後にまだ残レイヤーがあれば再表示）
  for(const btnId of ['dld-btn-addlayer', 'cdld-btn-addlayer']){
    const addBtn = document.getElementById(btnId);
    if(!addBtn) continue;
    const latestSessId = addBtn.dataset.sessId || sessId;
    const latestSess = await dbGetSess(latestSessId).catch(()=>null);
    if(!latestSess || !latestSess.bounds){
      addBtn.style.display = 'none';
      continue;
    }
    const tmp = document.createElement('div');
    await _dldRenderAddLayerPanel(latestSessId, latestSess, tmp);
    const hasPending = tmp.querySelector('.dldadp-ck:not(:disabled)');
    addBtn.style.display = hasPending ? 'inline-flex' : 'none';
    addBtn.dataset.sessId = latestSessId;
  }

  await refreshCache();
}

/** dldadp: 追加DL中の進捗をパネル内にミラーリング
 *  矩形DL・円形DLどちらの完了パネルからでも動作するよう
 *  _dldSyncProgressOverride コールバックで受け取る方式に統一
 */
function _dldAdpMirrorProgress(sessId){
  const bar = document.getElementById(`dldadp-prog-bar-${sessId}`);
  const pct = document.getElementById(`dldadp-prog-pct-${sessId}`);

  const _prev = window._dldSyncProgressOverride;
  window._dldSyncProgressOverride = (done, total, mb) => {
    if(typeof _prev === 'function') _prev(done, total, mb);
    // 停止ボタン押下直後は pct に即フィードバック
    if(dlStop){
      if(pct) pct.textContent = '⏳';
      return;
    }
    const p = total > 0 ? Math.round(done / total * 100) : 0;
    if(bar) bar.style.width = p + '%';
    if(pct) pct.textContent = p + '%';
  };
}

// ═══════════════════════════════════════════
//  ダウンロードエンジン
// ═══════════════════════════════════════════
let dlRun=false, dlStop=false;
let _dlAbortCtrl = null; // AbortController（実行中fetch一括キャンセル用）
const CONCUR=6;
const CONCUR_TOPO=3; // topo単独DL時の並列数制限（OpenTopoMapサーバー配慮）

async function runDl(mode, bounds, zmin, zmax, layers, startIdx, parentSessId=null){
  if(dlRun)return;

  // タスク全生成
  const tasks=[];
  for(const lk of layers) for(let z=zmin;z<=zmax;z++){
    const x0=lon2x(bounds.getWest(),z),x1=lon2x(bounds.getEast(),z);
    const y0=lat2y(bounds.getNorth(),z),y1=lat2y(bounds.getSouth(),z);
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) tasks.push({lk,z,x,y});
  }

  // ── キャッシュ済みキーを一括取得してSetを構築 ──────────────
  // dbGet を1件ずつ叩く代わりに prefix スキャンで一括取得。
  // 数万件でも数十ms・RAM消費も最小限（キーのみ保持）。
  let cachedSet = new Set();
  if(db){
    try{
      // 対象レイヤー×ズームの prefix を列挙してキーを収集
      for(const lk of layers){
        for(let z=zmin;z<=zmax;z++){
          const prefix = `${lk}/${z}/`;
          const keys = await new Promise((res,rej)=>{
            const tx=db.transaction(ST,'readonly');
            const req=tx.objectStore(ST).openKeyCursor(
              IDBKeyRange.bound(prefix, prefix+'\uffff', false, false)
            );
            const buf=[];
            req.onsuccess=e=>{const c=e.target.result;if(c){buf.push(c.key);c.continue();}else res(buf);};
            req.onerror=e=>rej(e);
          });
          keys.forEach(k=>cachedSet.add(k));
        }
      }
    }catch(e){ cachedSet=new Set(); } // 失敗時はフォールバック（全件fetch）
  }

  // キャッシュ済みをスキップしたfetch対象タスクのみに絞る
  const cachedCount = tasks.filter(t=>cachedSet.has(tileKey(t.lk,t.z,t.x,t.y))).length;
  const allFetchTasks = tasks.filter(t=>!cachedSet.has(tileKey(t.lk,t.z,t.x,t.y)));
  // startIdx が指定されている場合は途中から再開（レジューム）
  const fetchTasks = startIdx > 0 ? allFetchTasks.slice(startIdx) : allFetchTasks;
  // total は全タスク数（進捗表示の分母）
  const total = tasks.length;

  dlRun=true; dlStop=false;
  _dlAbortCtrl = new AbortController();
  // topo単独DLの場合のみ並列数を3に制限（OpenTopoMapサーバー配慮）
  const _concur = (layers.length === 1 && layers[0] === 'topo') ? CONCUR_TOPO : CONCUR;

  // ボタン切替（ベース/詳細タブ内）
  const SB=mode==='base'?document.getElementById('btn-stpbase'):document.getElementById('btn-stpdet');
  const DB2=mode==='base'?document.getElementById('btn-dlbase'):document.getElementById('btn-dldet');
  if(SB)  SB.style.display='block';
  if(DB2) DB2.disabled=true;

  // UI初期化（mode別）
  if(mode==='base'){
    _bdprogSetPhase('running');
  } else {
    _dldS3SetPhase('running');
  }

  // resumeの境界情報
  const boundsData=mode==='base'?null:{n:bounds.getNorth(),s:bounds.getSouth(),e:bounds.getEast(),w:bounds.getWest()};

  // レジューム再開時は前回DL済みバイト数を初期値として引き継ぐ（_initDone表示より前に定義）
  const _resumeForTick = loadResume();
  const _prevBytesForTick = (_resumeForTick && _resumeForTick.mode === mode)
    ? (_resumeForTick.prevBytes || 0) : 0;

  // 統計リセット（キャッシュ済み分を done の初期値に）
  const _initDone = cachedCount;
  if(mode==='base'){
    _bdprogSyncProgress(_initDone, total);
  } else {
    _dldSyncProgress(_initDone, total, '');
  }

  let done=_initDone, fail=0, realBytes=0;
  const log=msg=>{};  // ログ廃止

  const _syncUI = (d, t, mb) => {
    if(mode==='base') _bdprogSyncProgress(d, t);
    else              _dldSyncProgress(d, t, mb);
  };
  const tick=()=>{
    // レジューム前の累積分を加算して続きから表示
    const mbReal=((_prevBytesForTick + realBytes)/1024/1024).toFixed(0)+' MB';
    _syncUI(done, total, mbReal);
  };

  // fetchTasks のみをキューに積む（cachedSet除外済みなので重複DLなし）
  // startIdx オフセットは cachedSet による除外で代替するため不要
  const q = fetchTasks.slice(0);
  let active=0;

  await new Promise(resolve=>{
    let _forceResolveTimer = null;
    const _resolveOnce=(()=>{let done=false;return()=>{if(!done){done=true;if(_forceResolveTimer)clearTimeout(_forceResolveTimer);resolve();}};})();
    const next=()=>{
      if(dlStop){_resolveOnce();return;}
      while(active<_concur&&q.length){
        if(dlStop){_resolveOnce();return;}
        active++;
        const t=q.shift();
        const k=tileKey(t.lk,t.z,t.x,t.y);
        const url2=tileURL(t.lk,t.z,t.x,t.y);
        const promise=db
          ?fetch(url2,{signal:_dlAbortCtrl.signal})
              .then(r=>r.ok?r.arrayBuffer():null)
              .then(buf=>{if(buf)return dbPut(k,buf).then(()=>{done++;realBytes+=buf.byteLength;tick();});else{done++;fail++;tick();}})
              .catch(()=>{done++;fail++;tick();})
          :fetch(url2,{signal:_dlAbortCtrl.signal})
              .then(r=>r.ok?r.arrayBuffer():null)
              .then(buf=>{if(buf){done++;realBytes+=buf.byteLength;tick();}else{done++;fail++;tick();}})
              .catch(()=>{done++;fail++;tick();});

        promise.finally(()=>{
          active--;
          if(done%200===0||done===total) log(`完了: ${fmt(done)} / ${fmt(total)}  失敗: ${fail}`);

          if(dlStop){
            if(active===0){
              // 全fetch完了後に停止処理
              const now=new Date().toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
              saveResume({mode,subMode:window._cdldActiveSession?'circle':(parentSessId?'addlayer':undefined),center:window._cdldActiveSession?.center,radiusKm:window._cdldActiveSession?.radiusKm,bounds:boundsData,zmin,zmax,layers,taskIndex:done,total,savedAt:now,parentSessId:parentSessId||null});
              // ベースDLの場合は専用キーにも保存
              if(mode==='base'){
                saveBaseDlProgress({layers,zmin,zmax,taskIndex:done,total,savedAt:now});
              }
              _resolveOnce();
            }
          } else if(!q.length&&active===0){
            _resolveOnce();
          } else {
            next();
          }
        });
      }
    };
    next();
    // fetchTasks が空（全タイルキャッシュ済み）の場合、
    // promise.finally が一度も実行されず resolve() が呼ばれないためフリーズする。
    if(!q.length && active === 0){ _resolveOnce(); }
  });

  dlRun=false; if(SB) SB.style.display='none'; if(DB2) DB2.disabled=false;
  if(!dlStop){
    // 完了したらレジューム削除
    deleteResume();
    // ベースDLの場合は専用進捗キーも削除
    if(mode==='base') deleteBaseDlProgress();
    document.getElementById('resume-banner').classList.remove('show');
    log('✅ 完了！ '+fmt(done)+'枚保存（失敗: '+fail+'）');
    // セッション保存
    let _savedSessId = parentSessId || null;
    if(done>0){
      if(parentSessId){
        // ＋追加DL → 既存セッションに合算（新規セッション作成しない）
        const allTileKeys = tasks.map(t=>tileKey(t.lk,t.z,t.x,t.y));
        if(typeof addLayersToSession==='function'){
          await addLayersToSession(parentSessId, layers, allTileKeys, realBytes, zmax);
        }
      } else if(typeof saveDlSession==='function'){
        const _center = mode==='base'
          ? [35.0, 136.0]
          : [bounds.getCenter().lat, bounds.getCenter().lng];
        const _zoom   = mode==='base' ? zmax : (typeof map!=='undefined' ? map.getZoom() : zmax);
        const _bounds = mode==='base' ? null : {n:bounds.getNorth(),s:bounds.getSouth(),e:bounds.getEast(),w:bounds.getWest()};
        if(mode==='base'){
          // ベースDL → レイヤーごとに個別セッション（既存があればマージ）
          // レイヤー按分はLAYER_KB（実測係数）を使用
          const totalKb = layers.reduce((s,k)=>s+(LAYER_KB[k]||10), 0);
          const allSessions = await dbGetAllSess();
          for(const lk of layers){
            const _tileKeys = tasks.filter(t=>t.lk===lk).map(t=>tileKey(t.lk,t.z,t.x,t.y));
            const myBytes   = totalKb > 0 ? realBytes * (LAYER_KB[lk]||10) / totalKb : realBytes;
            // 同一レイヤーのベースセッションが既存にあればマージ（重複排除）
            const existing = allSessions.find(s =>
              s.mode === 'base' &&
              Array.isArray(s.srcKeys) && s.srcKeys.length === 1 && s.srcKeys[0] === lk
            );
            if(existing){
              existing.tileKeys  = [...new Set([...(existing.tileKeys||[]), ..._tileKeys])];
              existing.totalSize = (existing.totalSize || 0) + myBytes;
              existing.lastUsed  = Date.now();
              await dbPutSess(existing.id, existing);
            } else {
              const _label = `${_layerLabel([lk])} Z${zmin}〜Z${zmax} ${new Date().toLocaleDateString('ja-JP')}`;
              await saveDlSession({label:_label, center:_center, zoom:_zoom, tileKeys:_tileKeys, totalSize:myBytes, srcKeys:[lk], bounds:_bounds, zmin, zmax, mode});
            }
          }
        } else {
          // detail → 全レイヤーまとめて1セッション
          const _tileKeys = tasks.map(t=>tileKey(t.lk,t.z,t.x,t.y));
          const _label    = `${_layerLabel(layers)} Z${zmin}〜Z${zmax} ${new Date().toLocaleDateString('ja-JP')}`;
          const _sess = await saveDlSession({label:_label, center:_center, zoom:_zoom, tileKeys:_tileKeys, totalSize:realBytes, srcKeys:layers, bounds:_bounds, zmin, zmax, mode});
          _savedSessId = _sess?.id || null;
        }
      }
    }
    // DL完了時に必ずMAXズームを更新（done=0のキャッシュ済み完了も含む）
    if(typeof updateMaxCachedZooms==='function') await updateMaxCachedZooms();
    // 完了UI表示（mode別）
    if(mode==='base'){
      _bdprogSyncProgress(done, total);
      _bdprogSetPhase('done');
    } else if(window._cdldActiveSession){
      // 半径エリアDL完了
      _cdldSyncProgress(done, total, (realBytes/1024/1024).toFixed(1)+' MB');
      _cdldPh3SetPhase('done');
      _cdldShowDonePanel(done, realBytes, layers, zmin, zmax, _savedSessId);
    } else {
      _dldS3SetPhase('done');
      _dldShowDonePanel(done, realBytes, layers, zmin, zmax, _savedSessId);
    }
  } else {
    log('⏸ 停止しました。続きから再開できます。');
    if(mode==='base'){
      _bdprogSetPhase('stopped');
    } else if(window._cdldActiveSession){
      _cdldPh3SetPhase('stopped');
    } else {
      _dldS3SetPhase('stopped');
    }
  }
  dlRun = false;
  refreshCache();
  // ベースDL状況UIを最新状態に更新
  if(typeof refreshBaseDlStatus === 'function') refreshBaseDlStatus();
}

/** 停止ボタン押下: AbortControllerでfetchをキャンセルし「停止中…」表示 */
function _dldStopWithFeedback(){
  dlStop = true;
  if(_dlAbortCtrl) _dlAbortCtrl.abort();
  _dldS3SetPhase('stopping');
  // fetchがハングした場合の保険: 8秒後に強制リセット
  setTimeout(()=>{
    if(dlStop && dlRun){
      dlRun = false;
      _dldS3SetPhase('stopped');
    }
  }, 8000);
}

/** 後方互換: stopDl() も引き続き動作 */
function stopDl(){ _dldStopWithFeedback(); }

// ═══════════════════════════════════════════
//  追加レイヤーDL完了後にセッションを更新
// ═══════════════════════════════════════════
async function addLayersToSession(sessId, newLayers, newTileKeys, addedBytes, newZmax){
  try {
    const sess = await dbGetSess(sessId);
    if(!sess) return;
    sess.srcKeys   = [...new Set([...(sess.srcKeys||[]), ...newLayers])];
    sess.tileKeys  = [...new Set([...(sess.tileKeys||[]), ...newTileKeys])];
    sess.totalSize = (sess.totalSize||0) + addedBytes;
    sess.lastUsed  = Date.now();
    // zmax をセッション全体のsrcKeysに対応したmaxNativeZoomの最大値で再計算
    // 例: std(18)+hill(16) → zmax=18、relief(15)のみ → zmax=15
    const _MAX_NATIVE = {std:18, photo:18, topo:17, hill:16, relief:15};
    const allKeys = [...new Set([...(sess.srcKeys||[])])];
    sess.zmax = allKeys.length
      ? Math.max(...allKeys.map(k => _MAX_NATIVE[k] ?? 18))
      : (newZmax ?? sess.zmax ?? 15);
    // ユーザーが手動リネーム済みの場合はlabelを上書きしない
    if(!sess.userRenamed){
      sess.label = `${_layerLabel(sess.srcKeys)} Z${sess.zmin||11}〜Z${sess.zmax||15} ${new Date(sess.createdAt).toLocaleDateString('ja-JP')}`;
    }
    // layerStatus を更新：追加レイヤーの zmin/zmax を記録
    if(!sess.layerStatus) sess.layerStatus = {};
    const _addZmin = sess.zmin || 11;
    newLayers.forEach(lk => {
      sess.layerStatus[lk] = { zmin: _addZmin, zmax: newZmax || sess.zmax || 15 };
    });
    await dbPutSess(sessId, sess);
    if(typeof updateMaxCachedZooms==='function') await updateMaxCachedZooms();
  } catch(e){ console.error('addLayersToSession error', e); }
}


// ═══════════════════════════════════════════
//  以下 cache.js より移動: セッション一覧・追加レイヤーDL
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
//  DL前サイズチェック（概算計算機用）
// ═══════════════════════════════════════════
/**
 * 推定サイズ(bytes)を受け取り制限チェック結果を返す。
 * @returns {{ok:boolean, warn:boolean, msg:string}}
 */
function checkDlSizeLimit(estimatedBytes){
  if(estimatedBytes > DL_SESSION_MAX){
    const mb = (estimatedBytes/1024/1024).toFixed(0);
    return {
      ok:false, warn:false,
      msg:`❌ 推定サイズ 約${mb}MB は1回のDL上限(200MB)を超えています。\nエリアかズームレベルを絞ってください。`
    };
  }
  if(estimatedBytes > DL_SESSION_MAX * CACHE_MAX_WARN_RATIO){
    const mb = (estimatedBytes/1024/1024).toFixed(0);
    return {
      ok:true, warn:true,
      msg:`⚠️ 推定 約${mb}MB は上限に近い値です。WIFI環境を推奨します。`
    };
  }
  return {ok:true, warn:false, msg:''};
}

// ═══════════════════════════════════════════
//  セッション一覧レンダリング
// ═══════════════════════════════════════════
async function renderSessionList(){
  const container = document.getElementById('session-list');
  if(!container) return;

  const sessions = await dbGetAllSess();
  const total    = sessions.reduce((s,x)=>s+(x.totalSize||0),0);
  const cacheMax = getCacheMax();
  const pct      = Math.min(100, Math.round(total/cacheMax*100));

  const bar  = document.getElementById('sess-usage-bar-fill');
  const info = document.getElementById('sess-usage-info');
  if(bar){
    bar.style.width      = pct+'%';
    bar.style.background = pct>=90?'#ff4444':pct>=70?'#ffaa00':'var(--gold,#c8a84b)';
  }
  if(info) info.textContent = `${(total/1024/1024).toFixed(0)}MB / ${(cacheMax/1024/1024).toFixed(0)}MB 使用中`;

  // ベースDL状況UIを更新（refreshBaseDlStatus で管理）
  const detailSessions = sessions.filter(s => s.mode !== 'base');

  // ベースDL状況UIを更新
  if(typeof refreshBaseDlStatus === 'function') refreshBaseDlStatus();

  if(!detailSessions.length){
    container.innerHTML = '<div class="sess-empty">保存済みのオフラインエリアはありません</div>';
    return;
  }

  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  const LAYER_LABEL = {std:'地理院地図', photo:'航空写真', topo:'地形図', hill:'陰影起伏図', relief:'色別標高図'};

  const sorted = [...detailSessions].sort((a,b)=>b.createdAt - a.createdAt);
  container.innerHTML = sorted.map(s=>{
    const mb   = ((s.totalSize||0)/1024/1024).toFixed(1);
    const date = new Date(s.createdAt).toLocaleDateString('ja-JP');
    const used = new Date(s.lastUsed).toLocaleDateString('ja-JP');
    const lat  = s.center?.[0]?.toFixed(4)||'—';
    const lng  = s.center?.[1]?.toFixed(4)||'—';
    const srcs  = (s.srcKeys||[]).map(k=>LAYER_LABEL[k]||k).join('・')||'—';
    // リネーム済みラベルを最優先。未設定の場合のみ自動生成
    const label = (s.label && s.label !== '名称未設定')
      ? s.label
      : (s.srcKeys && s.srcKeys.length
        ? `${s.srcKeys.map(k=>LAYER_LABEL[k]||k).join('・')} Z${s.zmin||'—'}〜Z${s.zmax||'—'} ${new Date(s.createdAt).toLocaleDateString('ja-JP')}`
        : '名称未設定');
    const hasBounds = !!s.bounds;
    const addDlBtn = hasBounds
      ? `<button class="sess-adddl-btn" onclick="openAddLayerPanel('${s.id}')">＋</button>`
      : '';
    return `
    <div class="sess-card" id="sc-${s.id}">
      <div class="sess-map-thumb" onclick="jumpToSession('${s.id}')">
        <svg class="sess-thumb-icon" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="12" x2="36" y2="12" stroke="rgba(100,180,255,0.45)" stroke-width="1"/>
          <line x1="0" y1="24" x2="36" y2="24" stroke="rgba(100,180,255,0.45)" stroke-width="1"/>
          <line x1="12" y1="0" x2="12" y2="36" stroke="rgba(100,180,255,0.45)" stroke-width="1"/>
          <line x1="24" y1="0" x2="24" y2="36" stroke="rgba(100,180,255,0.45)" stroke-width="1"/>
          <circle cx="18" cy="14" r="5" fill="none" stroke="var(--gold)" stroke-width="1.8"/>
          <line x1="18" y1="19" x2="18" y2="25" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span class="sess-thumb-label">エリア確認</span>
      </div>
      <div class="sess-info">
        <div class="sess-label-row">
          <span class="sess-label" id="sl-${s.id}">${_esc(label)}</span>
          <button class="sess-rename-btn" onclick="_sessRenameStart('${s.id}')" title="リネーム">✏️</button>
        </div>
        <div class="sess-meta">約${mb}MB · ${srcs}</div>
      </div>
      <div class="sess-btns">
        ${addDlBtn}
        <button class="sess-del-btn" onclick="deleteSessionWithConfirm('${s.id}')">🗑</button>
      </div>
    </div>
    <div class="sess-adddl-panel" id="adp-${s.id}" style="display:none">
      <div class="adp-title">追加ダウンロード — レイヤー選択</div>
      <div class="adp-zoom-row">
        <span class="adp-zoom-label">ズーム:</span>
        <select class="adp-zsel" id="adp-zmin-${s.id}" disabled>
          <option value="${(s.zmax||15)+1}">Z${(s.zmax||15)+1}</option>
        </select>
        <span class="adp-zoom-sep">〜</span>
        <select class="adp-zsel" id="adp-zmax-${s.id}" onchange="updAddLayerZmaxCap('${s.id}');updAddLayerEst('${s.id}')">
          ${Array.from({length:14},(_,i)=>i+5)
            .map(z=>`<option value="${z}"${z===18?' disabled':''}>` +
              `${z>=17?'⚠️ ':''}Z${z}</option>`).join('')}
        </select>
        <span class="adp-zoom-hint" id="adp-zhint-${s.id}"></span>
      </div>
      <div class="adp-layers">
        ${ALL_LAYERS.map(lk=>{
          const done = (s.srcKeys||[]).includes(lk);
          // ベースDL状態: localStorageのcachedMaxZoom_{lk}で簡易判定（+ボタン時に最新取得）
          const baseOk = localStorage.getItem('cachedMaxZoom_' + lk) !== null;
          const baseBadge = baseOk
            ? `<span class="adp-base-badge adp-base-ok"  id="adp-base-${s.id}-${lk}">✅ベース済</span>`
            : `<span class="adp-base-badge adp-base-ng"  id="adp-base-${s.id}-${lk}">⚠️ベース未</span>`;
          // 未DLレイヤーもスキャン完了まで disabled（⏳）で初期化
          // スキャン後に _updateAdpCheckboxes が正しい状態に更新する
          return `<label class="adp-layer${done?' adp-layer--done':''}">
            <input type="checkbox" class="adp-ck" data-sess="${s.id}" data-lk="${lk}"
              ${done?'disabled checked':'disabled'} onchange="_adpOnlyOne(this,'${s.id}');updAddLayerZmaxCap('${s.id}');updAddLayerEst('${s.id}')">
            <span class="adp-lk-name">${LAYER_LABEL[lk]}</span>
            ${baseBadge}
            <span class="adp-lk-badge" id="adp-ls-${s.id}-${lk}">${(()=>{
              if(!done) return '';
              const ls = (s.layerStatus||{})[lk];
              if(ls) return `<span class="adp-ls-badge">Z${ls.zmin}〜Z${ls.zmax}</span>`;
              return '✅ 済';
            })()}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="adp-est" id="adp-est-${s.id}">レイヤーを選択してください</div>
      <div class="adp-footer">
        <button class="btn sm" onclick="closeAddLayerPanel('${s.id}')">キャンセル</button>
        <button class="btn accent" id="adp-btn-${s.id}" onclick="startAddLayerDl('${s.id}')" disabled>▶ DL開始</button>
      </div>
    </div>`;
  }).join('');
}

function _esc(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** セッションのlabelをIDBに保存 */
async function _renameSession(id, newLabel){
  try {
    const sess = await dbGetSess(id);
    if(!sess) return;
    sess.label = newLabel.trim() || '名称未設定';
    sess.userRenamed = true; // ユーザーが手動リネーム済みフラグ
    await dbPutSess(id, sess);
  } catch(e){ console.warn('renameSession error', e); }
}

/** インラインリネーム開始（✏️ボタンから呼ぶ） */
function _sessRenameStart(id){
  const labelEl = document.getElementById('sl-' + id);
  if(!labelEl) return;
  const current = labelEl.textContent;
  const row = labelEl.parentElement;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sess-label-input';
  input.value = current === '名称未設定' ? '' : current;
  input.placeholder = '名称未設定';
  input.maxLength = 30;

  row.replaceChild(input, labelEl);
  const renameBtn = row.querySelector('.sess-rename-btn');
  if(renameBtn) renameBtn.style.display = 'none';
  input.focus();
  input.select();

  const commit = async () => {
    const newLabel = input.value.trim() || '名称未設定';
    await _renameSession(id, newLabel);
    labelEl.textContent = newLabel;
    row.replaceChild(labelEl, input);
    if(renameBtn) renameBtn.style.display = '';
  };
  input.addEventListener('blur', commit, {once: true});
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter')  { input.blur(); }
    if(e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      row.replaceChild(labelEl, input);
      if(renameBtn) renameBtn.style.display = '';
    }
  });
}

// セッション範囲矩形を管理するグローバル変数
let _sessRectLayer = null;

/** セッション中心にジャンプしlastUsedを更新 */
async function jumpToSession(id){
  const sess = await dbGetSess(id).catch(()=>null);
  if(!sess||!sess.center) return;
  if(typeof map !== 'undefined'){
    map.setView(sess.center, sess.zoom||14);
    if(typeof switchTab==='function') switchTab('map');

    // 既存の矩形を削除
    if(_sessRectLayer){ map.removeLayer(_sessRectLayer); _sessRectLayer=null; }

    // bounds があれば矩形を描画
    if(sess.bounds){
      const b = sess.bounds;
      _sessRectLayer = L.rectangle(
        [[b.s, b.w],[b.n, b.e]],
        { color:'#c8aa50', weight:2, opacity:0.9, fillColor:'#c8aa50', fillOpacity:0.08, dashArray:'6 4' }
      ).addTo(map);
    }
  }
  await touchSession(id);
  await renderSessionList();
}

// ═══════════════════════════════════════════
//  キャッシュ上限スライダー
// ═══════════════════════════════════════════
const CACHE_STEPS_MB = [200, 500, 800, 1024, 2048];

function initCacheSlider(){
  const slider = document.getElementById('cache-limit-slider');
  const label  = document.getElementById('cache-limit-val');
  if(!slider) return;

  const cur = getCacheMax()/1024/1024;
  const idx = CACHE_STEPS_MB.reduce((bi,v,i)=>Math.abs(v-cur)<Math.abs(CACHE_STEPS_MB[bi]-cur)?i:bi, 0);
  slider.value = idx;
  const _fmt = mb => mb>=1024?(mb/1024).toFixed(0)+'GB':mb+'MB';
  if(label) label.textContent = _fmt(CACHE_STEPS_MB[idx]);

  slider.addEventListener('input',()=>{
    if(label) label.textContent = _fmt(CACHE_STEPS_MB[slider.value]);
  });
  slider.addEventListener('change', async()=>{
    const mb = CACHE_STEPS_MB[slider.value];
    if(mb > 500){
      const ok = await showConfirmDialog(
        `⚠️ キャッシュ上限を ${_fmt(mb)} に拡張します。\n端末のストレージを圧迫する可能性があります。\n自己責任での使用となります。よろしいですか？`,
        '拡張する', 'キャンセル'
      );
      if(!ok){
        const cur2 = getCacheMax()/1024/1024;
        const idx2 = CACHE_STEPS_MB.reduce((bi,v,i)=>Math.abs(v-cur2)<Math.abs(CACHE_STEPS_MB[bi]-cur2)?i:bi,0);
        slider.value = idx2;
        if(label) label.textContent = _fmt(CACHE_STEPS_MB[idx2]);
        return;
      }
    }
    setCacheMax(mb*1024*1024);
    await renderSessionList();
  });
}

// ═══════════════════════════════════════════
//  共通確認ダイアログ
// ═══════════════════════════════════════════
function showConfirmDialog(message, okLabel='OK', cancelLabel='キャンセル'){
  return new Promise(res=>{
    let dlg = document.getElementById('cache-confirm-dlg');
    if(!dlg){
      dlg = document.createElement('div');
      dlg.id = 'cache-confirm-dlg';
      dlg.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.72);backdrop-filter:blur(8px);align-items:center;justify-content:center;';
      dlg.innerHTML = `
        <div style="background:#1a1e24;border:1px solid rgba(255,255,255,0.12);border-radius:16px;
          padding:24px 20px;max-width:320px;width:calc(100vw - 48px);color:#e0e0e0;
          font-size:14px;line-height:1.8;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
          <div id="ccd-msg" style="white-space:pre-wrap;margin-bottom:20px;"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="ccd-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#aaa;font-size:13px;cursor:pointer;"></button>
            <button id="ccd-ok"     style="padding:8px 18px;border-radius:8px;border:none;background:var(--gold,#c8a84b);color:#000;font-size:13px;font-weight:700;cursor:pointer;"></button>
          </div>
        </div>`;
      document.body.appendChild(dlg);
    }
    document.getElementById('ccd-msg').textContent    = message;
    document.getElementById('ccd-ok').textContent     = okLabel;
    document.getElementById('ccd-cancel').textContent = cancelLabel;
    dlg.style.display = 'flex';

    const cleanup = result => {
      dlg.style.display = 'none';
      document.getElementById('ccd-ok').replaceWith(document.getElementById('ccd-ok').cloneNode(true));
      document.getElementById('ccd-cancel').replaceWith(document.getElementById('ccd-cancel').cloneNode(true));
      res(result);
    };
    document.getElementById('ccd-ok').addEventListener('click',    ()=>cleanup(true),  {once:true});
    document.getElementById('ccd-cancel').addEventListener('click', ()=>cleanup(false), {once:true});
  });
}

// ═══════════════════════════════════════════
//  refreshCache（更新・ステータスバー反映）
// ═══════════════════════════════════════════
async function refreshCache(){
  const el = document.getElementById('cache-info');
  if(!el) return;
  try {
    const cnt      = await dbCnt();
    const sessions = await dbGetAllSess();
    const total    = sessions.reduce((s,x)=>s+(x.totalSize||0), 0);
    const mb       = (total/1024/1024).toFixed(1);
    const maxMb    = (getCacheMax()/1024/1024).toFixed(0);
    el.textContent = `${cnt}枚 / 約${mb}MB 使用中（上限 ${maxMb}MB）`;
    const sb = document.getElementById('sb-cache');
    if(sb) sb.textContent = `キャッシュ: 約${mb}MB`;
    await renderSessionList();
  } catch(e){ el.textContent = '取得失敗'; }
}

// ═══════════════════════════════════════════
//  追加レイヤーDLパネル
// ═══════════════════════════════════════════

// パネルごとのIDBスキャン結果キャッシュ: sessId → {lk → {total,cached,perZoom}}
const _adpScanCache = {};

// 追加DLパネルでスキャンするズーム範囲
// ベースDLがZ5〜Z9のため、追加DLはZ10以上を対象とする
const ADP_SCAN_ZMIN = 10;
const ADP_SCAN_ZMAX = 18;

/**
 * ADP_SCAN_ZMIN〜ADP_SCAN_ZMAXの全ズームについて各レイヤーの
 * 総タイル数・既存タイル数をIndexedDBから計算してキャッシュする。
 */
async function _scanAdpTiles(sess){
  if(_adpScanCache[sess.id]) return _adpScanCache[sess.id];

  const b = sess.bounds;
  if(!b || typeof cntTiles !== 'function'){
    _adpScanCache[sess.id] = {};
    return {};
  }

  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  const result = {};

  for(const lk of ALL_LAYERS){
    let totalAll = 0, cachedAll = 0;
    const perZoom = {};

    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      const tileCount = cntTiles(bounds, z, z);
      totalAll += tileCount;

      let zCached = 0;
      try {
        zCached = await _countCachedTilesForZoom(lk, z, bounds);
      } catch(e){ zCached = 0; }
      cachedAll += zCached;

      const status = zCached === 0 ? 'none'
                   : zCached >= tileCount ? 'done'
                   : 'partial';
      perZoom[z] = { total: tileCount, cached: zCached, status };
    }

    result[lk] = { total: totalAll, cached: cachedAll, perZoom };
  }

  _adpScanCache[sess.id] = result;
  return result;
}

/**
 * 指定レイヤー・ズームのbounds内タイルについてIDB存在数を返す。
 */
async function _countCachedTilesForZoom(lk, z, bounds){
  const tiles = _tilesInBounds(bounds, z);
  if(!tiles.length) return 0;

  const prefix = `${lk}/${z}/`;
  const allKeys = await new Promise((res, rej)=>{
    const tx = db.transaction(ST, 'readonly');
    const store = tx.objectStore(ST);
    const keys = [];
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    const req = store.openKeyCursor(range);
    req.onsuccess = e => {
      const cursor = e.target.result;
      if(cursor){ keys.push(cursor.key); cursor.continue(); }
      else res(keys);
    };
    req.onerror = e => rej(e);
  });

  const keySet = new Set(allKeys);
  let count = 0;
  for(const [x, y] of tiles){
    if(keySet.has(`${lk}/${z}/${x}/${y}`)) count++;
  }
  return count;
}

/**
 * bounds内のズームzのタイル座標 [x,y][] を返す。
 */
function _tilesInBounds(bounds, z){
  const n = bounds.getNorth(), s = bounds.getSouth();
  const w = bounds.getWest(),  e = bounds.getEast();
  const lat2tile = lat => Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * Math.pow(2, z)
  );
  const lng2tile = lng => Math.floor((lng + 180) / 360 * Math.pow(2, z));
  const xMin = lng2tile(w), xMax = lng2tile(e);
  const yMin = lat2tile(n), yMax = lat2tile(s);
  const tiles = [];
  for(let x = xMin; x <= xMax; x++)
    for(let y = yMin; y <= yMax; y++)
      tiles.push([x, y]);
  return tiles;
}

async function openAddLayerPanel(sessId){
  document.querySelectorAll('.sess-adddl-panel').forEach(p=>p.style.display='none');
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;

  // 開くたびに最新状態を反映するためスキャンキャッシュを破棄
  delete _adpScanCache[sessId];

  // スキャン中表示
  const estEl = document.getElementById('adp-est-'+sessId);
  if(estEl) estEl.textContent = '⏳ DL状態を確認中…';

  // ── ダイアログに物理移動して表示 ──────────────────────────
  const dlg  = document.getElementById('addlayer-dialog');
  const body = document.getElementById('addlayer-dialog-body');
  if(dlg && body){
    // 以前のパネルが残っていれば元に戻す
    _adpRestorePanel();
    // DL完了パネル経由で残ったHTML残骸をクリアしてから移動
    body.innerHTML = '';
    // パネルをダイアログbodyに移動（IDはそのまま保持）
    panel.style.display = 'block';
    body.appendChild(panel);
    dlg.dataset.adpSessId = sessId;
    dlg.style.display = 'flex';
  } else {
    // フォールバック: ダイアログがなければ従来通りカード下展開
    panel.style.display = 'block';
  }

  // IDBスキャン
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(sess){
    // ＋ボタン押下時: getBaseDlDoneLayers()で最新ベースDL状態を取得してバッジ更新
    const baseDone = await getBaseDlDoneLayers();
    const ALL_LAYERS_BASE = ['std','photo','topo','hill','relief'];
    ALL_LAYERS_BASE.forEach(lk => {
      const el = document.getElementById(`adp-base-${sessId}-${lk}`);
      if(!el) return;
      if(baseDone.has(lk)){
        el.textContent = '✅ベース済';
        el.className   = 'adp-base-badge adp-base-ok';
      } else {
        el.textContent = '⚠️ベース未';
        el.className   = 'adp-base-badge adp-base-ng';
      }
    });

    const scanResult = await _scanAdpTiles(sess);
    _renderAdpZoomHint(sessId, scanResult);
    _updateAdpCheckboxes(sessId, sess, scanResult);  // ①チェックボックス状態を確定
    await _setAdpZoomDefaults(sessId);               // ②ズームデフォルト値を自動セット（スキャン結果ベース）

    // ③全レイヤー・全ズーム完了チェック（ベースDL済みも確認）
    const allCks = panel.querySelectorAll('.adp-ck');
    const allLayerKeys = [...allCks].map(ck => ck.dataset.lk).filter(Boolean);
    const allBaseOk = allLayerKeys.every(lk => baseDone.has(lk));
    const allComplete = allCks.length > 0 &&
      [...allCks].every(ck => ck.disabled && ck.checked) &&
      allBaseOk;
    if(allComplete){
      // ズーム行・レイヤー行・DL開始ボタンを隠して完了メッセージ表示
      // キャンセル（閉じる）ボタンは残す
      const zoomRow = panel.querySelector('.adp-zoom-row');
      const layers  = panel.querySelector('.adp-layers');
      const dlBtn   = document.getElementById(`adp-btn-${sessId}`);
      if(zoomRow) zoomRow.style.display = 'none';
      if(layers)  layers.style.display  = 'none';
      if(dlBtn)   dlBtn.style.display   = 'none';
      if(estEl)   estEl.innerHTML =
        '<span style="color:#4caf50;font-size:13px">✅ このエリアは全ズーム・全レイヤーが取得済みです</span>';
      return; // updAddLayerEst は呼ばない
    }
  }
  await updAddLayerEst(sessId);
}

/**
 * スキャン結果を元に、選択中レイヤーで done のズームを
 * adp-zmin / adp-zmax の選択肢から除去し、
 * デフォルト値を未DLの最小/最大ズームに設定する。
 * 判定は「チェック中のレイヤーが全て done」かつ「タイルが存在するズーム」のみ。
 */
/**
 * スキャン結果を元に、済みズームをヒントテキストで表示する。
 * ズームselectは常にZ5〜Z18全表示。
 */
function _renderAdpZoomHint(sessId, scanResult){
  const hintEl = document.getElementById(`adp-zhint-${sessId}`);
  if(!hintEl) return;

  // 全レイヤーでdoneなズームを収集
  const doneZooms = new Set();
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
    const allDone = ALL_LAYERS.every(lk => {
      const d = scanResult[lk];
      if(!d || !d.perZoom) return false;
      return d.perZoom[z]?.status === 'done';
    });
    if(allDone) doneZooms.add(z);
  }

  if(!doneZooms.size){ hintEl.textContent = ''; return; }
  const list = [...doneZooms].sort((a,b)=>a-b).map(z=>`Z${z}`).join('・');
  hintEl.textContent = `（${list} 取得済み）`;
}

function closeAddLayerPanel(sessId){
  // ダイアログ経由で開いていた場合はパネルを元の位置に戻してダイアログを閉じる
  _adpRestorePanel();
  const dlg = document.getElementById('addlayer-dialog');
  if(dlg) dlg.style.display = 'none';
  // パネル自体も確実に非表示
  const panel = document.getElementById('adp-'+sessId);
  if(panel){
    panel.style.display='none';
    delete panel.dataset.adpDone; // 次回オープン用にフラグリセット
  }
  if(sessId) delete _adpScanCache[sessId];
}

/**
 * ダイアログbody内に移動したadp-パネルを元のsess-card直後に戻す。
 * 元の親が消えていれば session-list に append してフォールバック。
 */
function _adpRestorePanel(){
  const dlg  = document.getElementById('addlayer-dialog');
  const body = document.getElementById('addlayer-dialog-body');
  if(!dlg || !body) return;
  const panel = body.querySelector('.sess-adddl-panel');
  if(!panel) return;
  const sessId = dlg.dataset.adpSessId || '';
  const card   = document.getElementById('sc-' + sessId);
  if(card && card.parentNode){
    card.parentNode.insertBefore(panel, card.nextSibling);
  } else {
    // フォールバック: session-list に戻す
    const list = document.getElementById('session-list');
    if(list) list.appendChild(panel);
  }
  panel.style.display = 'none';
  delete dlg.dataset.adpSessId;
}

/**
 * スキャン結果を元にチェックボックスの有効/無効・バッジを更新。
 * - srcKeysに含まれるレイヤー（DL済み）: disabled + checked + ✅ 済
 * - 全ズームが done のレイヤー          : disabled + checked + Znまで
 * - 未DL・partialのレイヤー            : enabled  + unchecked + Znまで or 未DL
 */
function _updateAdpCheckboxes(sessId, sess, scanResult){
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];
  ALL_LAYERS.forEach(lk => {
    const ck = document.querySelector(`.adp-ck[data-sess="${sessId}"][data-lk="${lk}"]`);
    if(!ck) return;

    const badgeEl = ck.parentElement?.querySelector('.adp-lk-badge');
    const labelEl = ck.parentElement;

    // スキャン結果が取れなかった場合
    const lkData = scanResult[lk];
    if(!lkData || !lkData.perZoom){
      const alreadyInSess = (sess.srcKeys||[]).includes(lk);
      if(!alreadyInSess){
        ck.disabled = false;
        ck.checked  = false;
        if(badgeEl) badgeEl.textContent = '';
      }
      return;
    }

    // スキャン結果からdoneな最大Zを取得
    let maxDoneZ = null;
    let allDone = true;
    let hasAnyTile = false;
    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      if(lk === 'topo'   && z >= 18) continue;
      if(lk === 'hill'   && z >= 17) continue;
      if(lk === 'relief' && z >= 16) continue;
      const pz = lkData.perZoom[z];
      if(!pz || pz.total === 0) continue;
      hasAnyTile = true;
      if(pz.status === 'done'){
        maxDoneZ = z;
      } else {
        allDone = false;
      }
    }
    if(!hasAnyTile) allDone = false;

    // バッジ文字列
    const maxNative = _ADP_MAX_NATIVE[lk] ?? 18;
    const reachedMax = maxDoneZ !== null && maxDoneZ >= maxNative;
    const badgeText = maxDoneZ !== null
      ? (reachedMax ? '✅ 完了' : `Z${maxDoneZ}まで完了`)
      : '';

    if(allDone){
      ck.disabled = true;
      ck.checked  = true;
      if(badgeEl){
        badgeEl.textContent = badgeText;
        badgeEl.style.fontSize   = '';
        badgeEl.style.fontWeight = '';
        badgeEl.style.color      = reachedMax ? '#4caf50' : '#aaa';
      }
      if(labelEl) labelEl.classList.add('adp-layer--done');
    } else {
      ck.disabled = false;
      ck.checked  = false;
      if(badgeEl){
        badgeEl.textContent = badgeText;
        badgeEl.style.fontSize   = '';
        badgeEl.style.fontWeight = '';
        badgeEl.style.color      = badgeText ? '#aaa' : '';
      }
      if(labelEl) labelEl.classList.remove('adp-layer--done');
    }
  });
}

/**
 * ズームデフォルト値をセット。
 * スキャン結果のレイヤー別done状況を見て、
 * 未完了レイヤーの中で最も低い「次のzmin」をデフォルトに使う。
 * - zmin select: 未完了レイヤーの最小nextZmin を表示（disabled）
 * - zmax select: zmin と同じか、推奨上限(16)のいずれか小さい方
 */
async function _setAdpZoomDefaults(sessId){
  const zminEl = document.getElementById(`adp-zmin-${sessId}`);
  const zmaxEl = document.getElementById(`adp-zmax-${sessId}`);
  if(!zmaxEl) return;

  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess) return;

  // スキャン結果を参照（openAddLayerPanel内で既にスキャン済みのはず）
  const scanResult = _adpScanCache[sessId] || {};
  const ALL_LAYERS = ['std','photo','topo','hill','relief'];

  // 未完了レイヤーごとの「次のzmin」を収集
  // 未完了 = ADP_SCAN_ZMAX までに done でないズームが存在する
  const nextZmins = [];
  for(const lk of ALL_LAYERS){
    const lkData = scanResult[lk];
    if(!lkData || !lkData.perZoom){
      // スキャン結果なし → sess.zmax+1 をフォールバックに使う
      nextZmins.push((sess.zmax || 15) + 1);
      continue;
    }
    // このレイヤーで最後にdoneだったズームを探す（レイヤー単体で判定）
    let lastDoneZ = ADP_SCAN_ZMIN - 1;
    let lkAllDone = true;
    let lkHasTile = false;
    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      const pz = lkData.perZoom[z];
      if(!pz || pz.total === 0) continue; // タイルなしズームは無視
      lkHasTile = true;
      if(pz.status === 'done'){
        lastDoneZ = z;
      } else {
        lkAllDone = false; // doneでないズームが1つでもあれば未完了
      }
    }
    // タイルが1枚もなければ未DL扱い
    if(!lkHasTile) lkAllDone = false;
    // このレイヤーが全ズームdoneなら対象外（nextZminに加えない）
    if(!lkAllDone) nextZmins.push(lastDoneZ + 1);
  }

  // 未完了レイヤーがなければ何もしない（全完了済み → openAddLayerPanelで処理）
  if(!nextZmins.length) return;

  // 未完了レイヤーの中で最も低いnextZminを採用
  const recZmin = Math.min(...nextZmins);

  // zmin selectを更新（disabled なので option の value/text を書き換え）
  if(zminEl){
    zminEl.innerHTML = `<option value="${recZmin}">Z${recZmin}</option>`;
  }

  // zmax select: recZmin 以上で最近い選択肢を選ぶ
  // recZmin が推奨上限(16)を超えている場合はそのまま recZmin をデフォルトにする
  const recZmax = Math.max(recZmin, 16);
  const opt = [...zmaxEl.options].find(o => parseInt(o.value) >= recZmax);
  if(opt) zmaxEl.value = opt.value;
}

// レイヤー選択に応じてadp-zmaxの上限をキャップする
// maxNativeZoom: std/photo=18, topo=17, hill=16, relief=15
const _ADP_MAX_NATIVE = {std:18, photo:18, topo:17, hill:16, relief:15};

// ── 追加DL: ラジオ的挙動（1択制） ──────────────────────────
function _adpOnlyOne(el, sessId){
  const cks = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]`)];
  if(el.checked){
    cks.forEach(ck=>{
      if(ck !== el && !ck.checked){ ck.disabled = true; }
    });
  } else {
    // チェックを外したら未済レイヤーのdisabledを解除
    cks.forEach(ck=>{
      // DL済み（adp-layer--done）は常にdisabledのまま
      if(!ck.closest('.adp-layer--done')) ck.disabled = false;
    });
  }
}

function updAddLayerZmaxCap(sessId){
  const zmaxEl = document.getElementById(`adp-zmax-${sessId}`);
  if(!zmaxEl) return;
  // チェック済みレイヤーのmaxNativeZoom最小値を求める
  const checked = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el => el.dataset.lk);
  const cap = checked.length
    ? Math.min(...checked.map(lk => _ADP_MAX_NATIVE[lk] ?? 18))
    : 18;
  // 選択肢のdisabled状態を更新
  [...zmaxEl.options].forEach(o => {
    const z = parseInt(o.value);
    o.disabled = z > cap;
    o.text = z > cap ? `Z${z}` : (z >= 17 ? `⚠️ Z${z}` : `Z${z}`);
  });
  // 現在の選択値がcapを超えていたらcapに戻す
  if(parseInt(zmaxEl.value) > cap){
    const fallback = [...zmaxEl.options].reverse().find(o => parseInt(o.value) <= cap && !o.disabled);
    if(fallback) zmaxEl.value = fallback.value;
  }
}

async function updAddLayerEst(sessId){
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess||!sess.bounds) return;
  const selected = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el=>el.dataset.lk);
  const estEl = document.getElementById('adp-est-'+sessId);
  const btn   = document.getElementById('adp-btn-'+sessId);
  if(!selected.length){
    if(estEl) estEl.innerHTML = '<span class="adp-est-line">レイヤーを選択してください</span>';
    if(btn)   btn.disabled = true;
    return;
  }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const zmin = parseInt(document.getElementById(`adp-zmin-${sessId}`)?.value) || (sess.zmax||15) + 1;
  const zmax = parseInt(document.getElementById(`adp-zmax-${sessId}`)?.value) || 16;

  // ── ベースDL未完了チェック ──────────────────────────────
  const baseDone = await getBaseDlDoneLayers();
  // 新規レイヤー（sess.srcKeys に未含まれる）かつベース未DLのものを抽出
  const needBase = selected.filter(lk =>
    !(sess.srcKeys||[]).includes(lk) && !baseDone.has(lk)
  );
  if(needBase.length){
    const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図','hill':'陰影起伏図','relief':'色別標高図'}[lk]||lk)).join('・');
    if(estEl) estEl.innerHTML = `
      <span class="adp-est-line adp-est-over">
        ⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です
      </span>
      <span class="adp-est-line">
        <button class="btn sm" style="margin-top:4px"
          onclick="_addlayerDialogCloseAny();_goToBaseDl()">📥 ベースDLへ</button>
      </span>`;
    if(btn) btn.disabled = true;
    return;
  }

  // スピナー表示
  if(estEl) estEl.innerHTML = '<span class="adp-spinner"></span><span class="adp-est-scanning">計算中...</span>';
  if(btn) btn.disabled = true;

  // IDBスキャンで正確なキャッシュ済み数を取得
  let netTiles = 0, totalTiles = 0;
  try {
    for(const lk of selected){
      const kb = (typeof LAYER_KB !== 'undefined' && LAYER_KB[lk]) || 10;
      for(let z = zmin; z <= zmax; z++){
        const tileCount = (typeof cntTiles === 'function') ? cntTiles(bounds, z, z) : 0;
        totalTiles += tileCount;
        let cached = 0;
        try { cached = await _countCachedTilesForZoom(lk, z, bounds); } catch(e){}
        netTiles += Math.max(0, tileCount - cached);
      }
    }
  } catch(e){ netTiles = 0; }

  const avgKb = (()=>{
    if(typeof LAYER_KB === 'undefined') return 10;
    let sum = 0;
    selected.forEach(lk => sum += (LAYER_KB[lk]||10));
    return sum / selected.length;
  })();

  const netBytes   = netTiles   * avgKb * 1024;
  const totalBytes = totalTiles * avgKb * 1024;
  const netMb      = (netBytes   / 1024 / 1024).toFixed(0);
  const totalMb    = (totalBytes / 1024 / 1024).toFixed(0);
  const overLimit  = netBytes > DL_SESSION_MAX;
  const overRec    = zmax > 16; // 推奨範囲外（Z17〜Z18）

  if(estEl){
    estEl.innerHTML = `
      <span class="adp-est-line adp-est-net${overLimit?' adp-est-over':''}">
        未DL: 約 ${netMb} MB（${netTiles.toLocaleString()}枚）${overLimit?' — 200MB超過':''}
      </span>
      <span class="adp-est-line adp-est-total">
        合計: 約 ${totalMb} MB（${totalTiles.toLocaleString()}枚） Z${zmin}〜Z${zmax}
      </span>
      ${overRec ? `<span class="adp-est-line adp-est-warn">
        ⚠️ Z17以上はデータ量が非常に大きくなります。Wi-Fi環境を推奨します
      </span>` : ''}`;
  }
  if(btn) btn.disabled = overLimit || netBytes === 0;
}

async function startAddLayerDl(sessId){
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess||!sess.bounds){ showAlert('エラー','範囲情報がありません'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  const selected = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el=>el.dataset.lk);
  if(!selected.length){ showAlert('エラー','レイヤーを選択してください'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(typeof runDl !== 'function'){ showAlert('エラー','DL機能が読み込まれていません'); return; }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  // ズームselectの値を優先（なければセッション値）
  const zmin = parseInt(document.getElementById(`adp-zmin-${sessId}`)?.value) || sess.zmin || 11;
  const zmax = parseInt(document.getElementById(`adp-zmax-${sessId}`)?.value) || sess.zmax || 16;

  // パネルをDL中UIに切り替え（パネルは閉じない）
  _adpShowProgress(sessId, selected);
  window._dldSyncProgressOverride = null; // 二重フック防止
  _adpMirrorDlProgress(sessId);
  _adpSetPhase(sessId, 'running');

  // parentSessId を渡すことで runDl 内で直接 addLayersToSession を呼ぶ
  await runDl('detail', bounds, zmin, zmax, selected, 0, sessId);

  // override解放
  window._dldSyncProgressOverride = null;

  // 停止された場合
  if(dlStop){
    _adpSetPhase(sessId, 'stopped');
    return;
  }

  _adpSetPhase(sessId, 'done');
  await refreshCache();
}

/**
 * 追加DLパネルをDL中モードに切り替える。
 * ui.js の _dldLog / _dldProg を監視して進捗を表示する。
 */
/**
 * 追加DLパネルをDL中モードに切り替える。
 * フェーズ対応ボタン群（running/stopping/stopped/done）を生成する。
 */
function _adpShowProgress(sessId, layers){
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;

  const layerNames = layers.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図','hill':'陰影起伏図','relief':'色別標高図'}[lk]||lk)).join('・');
  panel.querySelector('.adp-layers').style.display = 'none';
  panel.querySelector('.adp-footer').style.display = 'none';
  // hide dialog default-close button while DL progress is shown
  const dlgFooter = document.getElementById('addlayer-dialog-footer-default');
  if(dlgFooter) dlgFooter.style.display = 'none';

  let prog = document.getElementById(`adp-prog-${sessId}`);
  if(!prog){
    prog = document.createElement('div');
    prog.id = `adp-prog-${sessId}`;
    prog.className = 'adp-progress-area';
    panel.appendChild(prog);
  }
  prog.style.display = 'block';
  prog.dataset.layerNames = layerNames;
  prog.innerHTML = `
    <div class="adp-prog-label" id="adp-prog-label-${sessId}">⬇ DL中: ${layerNames}</div>
    <div class="dldadp-prog-bar-wrap">
      <div class="s3-pb-track" style="flex:1">
        <div class="s3-pb-fill" id="adp-pbar-${sessId}" style="width:0%"></div>
      </div>
      <div class="dldadp-prog-pct" id="adp-pcnt-${sessId}">0%</div>
    </div>
    <div id="adp-resume-info-${sessId}" style="display:none;font-size:11px;color:var(--txt-dim);margin-top:4px"></div>
    <div id="adp-btns-running-${sessId}"  style="display:flex;margin-top:8px;gap:6px;justify-content:flex-end;width:100%">
      <button class="btn red" onclick="_adpStopDl('${sessId}')">■ 停止</button>
    </div>
    <div id="adp-btns-stopping-${sessId}" style="display:none;margin-top:8px;gap:6px;justify-content:flex-end;width:100%">
      <button class="btn red" disabled>⏳ 停止中…</button>
    </div>
    <div id="adp-btns-stopped-${sessId}"  style="display:none;margin-top:8px;gap:6px;width:100%">
      <span style="flex:1"></span>
      <button class="btn sm"   onclick="_adpCloseAndReset('${sessId}')">閉じる</button>
      <button class="btn blue" onclick="_adpResumeFromPanel('${sessId}')">▶ 再開</button>
    </div>
    <div id="adp-btns-done-${sessId}"     style="display:none;margin-top:8px;gap:6px;width:100%;flex-wrap:wrap">
      <button class="btn sm" id="adp-btn-addlayer-${sessId}" onclick="_adpStartNext('${sessId}')" style="display:none">📥 レイヤーを追加DL</button>
      <span style="flex:1"></span>
      <button class="btn accent" onclick="_adpCloseAndReset('${sessId}')">✅ 閉じる</button>
    </div>
  `;
  // フック設定は呼び出し元で明示管理（二重セット防止）
}

/**
 * adpパネルのフェーズ切り替え（running / stopping / stopped / done）
 */
function _adpSetPhase(sessId, phase){
  const bar   = document.getElementById(`adp-pbar-${sessId}`);
  const pct   = document.getElementById(`adp-pcnt-${sessId}`);
  const label = document.getElementById(`adp-prog-label-${sessId}`);
  const info  = document.getElementById(`adp-resume-info-${sessId}`);

  ['running','stopping','stopped','done'].forEach(p => {
    const el = document.getElementById(`adp-btns-${p}-${sessId}`);
    if(el) el.style.display = p === phase ? 'flex' : 'none';
  });

  if(phase === 'running'){
    const prog = document.getElementById(`adp-prog-${sessId}`);
    if(label) label.textContent = '⬇ DL中: ' + (prog?.dataset.layerNames || '');
    if(bar) bar.style.background = '';
    if(info) info.style.display = 'none';
  } else if(phase === 'stopping'){
    if(label) label.textContent = '⏳ 停止処理中…';
  } else if(phase === 'stopped'){
    if(label) label.textContent = '⏸ ダウンロードを停止しました';
    if(bar) bar.style.background = '';
    if(info){
      const s = loadResume();
      if(s && s.total > 0){
        const p = Math.round(s.taskIndex / s.total * 100);
        info.textContent = `進捗 ${p}%（${fmt(s.taskIndex)} / ${fmt(s.total)}）`;
        info.style.display = 'block';
      }
    }
  } else if(phase === 'done'){
    if(label) label.textContent = '✅ ダウンロード完了';
    if(bar){ bar.style.transition = 'none'; bar.style.width = '100%'; bar.style.background = ''; bar.classList.add('--done'); }
    if(pct) pct.textContent = '✅';
    if(info) info.style.display = 'none';
    // 残レイヤーがあれば追加DLボタンを表示
    const addBtn = document.getElementById(`adp-btn-addlayer-${sessId}`);
    if(addBtn){
      dbGetSess(sessId).then(sess => {
        if(!sess || !sess.bounds){ addBtn.style.display = 'none'; return; }
        const tmp = document.createElement('div');
        _dldRenderAddLayerPanel(sessId, sess, tmp).then(() => {
          const hasPending = tmp.querySelector('.dldadp-ck:not(:disabled)');
          addBtn.style.display = hasPending ? 'inline-flex' : 'none';
        });
      }).catch(() => { addBtn.style.display = 'none'; });
    }
  }
}

/** adp 停止ボタン押下 */
function _adpStopDl(sessId){
  dlStop = true;
  if(_dlAbortCtrl) _dlAbortCtrl.abort();
  _adpSetPhase(sessId, 'stopping');
  // fetchがハングした場合の保険: 8秒後に強制リセット
  setTimeout(()=>{
    if(dlStop && dlRun){
      dlRun = false;
      _adpSetPhase(sessId, 'stopped');
    }
  }, 8000);
}

/** adp 再開ボタン押下（stopped フェーズから再開） */
async function _adpResumeFromPanel(sessId){
  const s = loadResume();
  if(!s || s.subMode !== 'addlayer'){
    showAlert('エラー', 'レジュームデータがありません'); return;
  }
  if(!navigator.onLine){ showAlert('オフライン', 'インターネット接続がありません'); return; }

  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess||!sess.bounds){ showAlert('エラー','セッション情報がありません'); return; }
  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);

  _adpSetPhase(sessId, 'running');
  window._dldSyncProgressOverride = null; // 二重フック防止
  _adpMirrorDlProgress(sessId);

  await runDl('detail', bounds, s.zmin, s.zmax, s.layers, 0, sessId);

  window._dldSyncProgressOverride = null;

  if(dlStop){
    _adpSetPhase(sessId, 'stopped');
    return;
  }
  _adpSetPhase(sessId, 'done');
  await refreshCache();
}

/**
 * adp 完了後「📥 レイヤーを追加DL」ボタン押下
 * 現在のプログレスUIをリセットして同じダイアログ内で次の追加DLへ連鎖
 */
async function _adpStartNext(sessId){
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;
  // progエリアを除去してレイヤー選択UIに戻す
  const prog = document.getElementById(`adp-prog-${sessId}`);
  if(prog) prog.remove();
  // adp-layers / adp-footer を再表示
  const lays = panel.querySelector('.adp-layers');
  const foot = panel.querySelector('.adp-footer');
  if(lays) lays.style.display = '';
  if(foot) foot.style.display = '';
  // スキャンキャッシュをクリアして最新状態で再描画
  delete _adpScanCache[sessId];
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess) return;
  // ダイアログbodyを再レンダリング
  const body = document.getElementById('addlayer-dialog-body');
  if(body) await _dldRenderAddLayerPanel(sessId, sess, body);
  // footer閉じるボタンを再表示
  const dlgFooter = document.getElementById('addlayer-dialog-footer-default');
  if(dlgFooter) dlgFooter.style.display = '';
}

/** adp パネルを閉じてリセット（停止後・完了後共通） */
function _adpCloseAndReset(sessId){
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;
  const lays = panel.querySelector('.adp-layers');
  const foot = panel.querySelector('.adp-footer');
  if(lays) lays.style.display = '';
  if(foot) foot.style.display = '';
  // restore dialog default-close button
  const dlgFooterR = document.getElementById('addlayer-dialog-footer-default');
  if(dlgFooterR) dlgFooterR.style.display = '';
  // パネルを元位置に戻してからadp-progを削除（順序が重要）
  closeAddLayerPanel(sessId);
  const p = document.getElementById(`adp-prog-${sessId}`);
  if(p) p.remove();
  // 停止中のレジュームがあればバナーを表示
  if(typeof checkResume === 'function') checkResume();
}

/**
 * adp 追加DL中の進捗をフックで受け取りバーに反映する。
 * ポーリング方式を廃止し _dldSyncProgressOverride コールバック方式に統一。
 */
function _adpMirrorDlProgress(sessId){
  const bar = document.getElementById(`adp-pbar-${sessId}`);
  const pct = document.getElementById(`adp-pcnt-${sessId}`);

  const _prev = window._dldSyncProgressOverride;
  window._dldSyncProgressOverride = (done, total, mb) => {
    if(typeof _prev === 'function') _prev(done, total, mb);
    if(dlStop){
      if(pct) pct.textContent = '⏳';
      return;
    }
    const p = total > 0 ? Math.round(done / total * 100) : 0;
    if(bar) bar.style.width = p + '%';
    if(pct) pct.textContent = p + '%';
  };
}


/**
 * ベースDLセクションの各レイヤー行にステータスを表示する。
 * renderSessionList() から自動的に呼ばれる。
 * @param {Array} sessions - dbGetAllSess() の結果（全セッション）
 */
function renderBaseDlStatus(sessions){
  const LAYERS = ['std','photo','topo','hill','relief'];

  LAYERS.forEach(lk => {
    const el = document.getElementById('base-status-' + lk);
    if(!el) return;

    // そのレイヤーを含むベースセッションを探す
    // 新規: mode === 'base' / 旧データ: bounds===null かつ Z5〜Z9 でフォールバック
    const sess = sessions.find(s =>
      Array.isArray(s.srcKeys) && s.srcKeys.includes(lk) &&
      (
        s.mode === 'base' ||
        (!s.mode && !s.bounds && s.zmin <= 5 && s.zmax >= 9)
      )
    );

    if(sess){
      // レイヤー単位セッションなのでtotalSizeをそのまま使用
      const mb = ((sess.totalSize||0) / 1024 / 1024).toFixed(0);
      el.innerHTML =
        `<span class="base-saved-badge">✅ 約${mb}MB</span>` +
        `<button class="base-saved-del" onclick="deleteSessionWithConfirm('${sess.id}')" title="削除">🗑</button>`;
    } else {
      el.innerHTML = '';
    }
  });
}

// ═══════════════════════════════════════════
//  半径エリアDL
// ═══════════════════════════════════════════

let _cdldCenter   = null;  // {lat, lng}
let _cdldTapping  = false; // タップ待ちフラグ
let _cdldCircle   = null;  // 地図上のプレビュー円
let _cdldTapHandler = null;

/** 半径スライダー値(km)を取得 */
function _cdldRadiusKm(){
  return parseInt(document.getElementById('cdld-radius-slider')?.value || 5);
}

/** km → 緯度差・経度差に変換して L.LatLngBounds を生成 */
function _cdldBounds(lat, lng, km){
  const dLat = km / 111.0;
  const dLng = km / (111.0 * Math.cos(lat * Math.PI / 180));
  return L.latLngBounds(
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng]
  );
}

/** 地図上の正方形プレビューを更新（実DL範囲と一致） */
function _cdldUpdateCircle(){
  if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
  if(!_cdldCenter) return;
  const km = _cdldRadiusKm();
  const bounds = _cdldBounds(_cdldCenter.lat, _cdldCenter.lng, km);
  _cdldCircle = L.rectangle(bounds, {
    color: '#c8a84b',
    weight: 2,
    dashArray: '4 3',
    fillColor: '#c8a84b',
    fillOpacity: 0.10
  }).addTo(map);
}

/** 推定容量を計算して表示 */
function _cdldCalc(){
  const el = document.getElementById('cdld-est');
  const btn = document.getElementById('cdld-dl-btn');
  if(!_cdldCenter){ if(el) el.textContent = '— MB'; if(btn) btn.disabled = true; return; }
  const layers = ['std','photo','topo'].filter(k => document.getElementById('cdld-ck-'+k)?.checked);
  if(!layers.length){ if(el) el.textContent = '— MB'; if(btn) btn.disabled = true; return; }
  const zmax = parseInt(document.getElementById('cdld-zmax')?.value || 16);
  const bounds = _cdldBounds(_cdldCenter.lat, _cdldCenter.lng, _cdldRadiusKm());
  const tiles  = cntTiles(bounds, 10, zmax);
  const bytes  = estBytesLayers(tiles, layers);
  const mb     = (bytes / 1024 / 1024).toFixed(1);

  // 非同期チェック中はボタンを無効化しておく
  if(btn) btn.disabled = true;

  // ベースDL未完了チェック（非同期・警告表示）
  if(typeof getBaseDlDoneLayers === 'function'){
    getBaseDlDoneLayers().then(baseDone => {
      const needBase = layers.filter(lk => !baseDone.has(lk));
      if(needBase.length){
        const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
        if(el) el.innerHTML =
          `<span style="color:#ffaa00">⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です。</span>` +
          `<br><button class="btn sm" style="margin-top:6px" onclick="_addlayerDialogCloseAny();_cdldCancel();_goToBaseDl()">📥 ベースDLへ</button>`;
        if(btn) btn.disabled = true;
      } else {
        if(el) el.textContent = `推定 約 ${mb} MB`;
        if(btn) btn.disabled = false;
      }
    });
  } else {
    if(el) el.textContent = `推定 約 ${mb} MB`;
    if(btn) btn.disabled = false;
  }
}

/** レイヤー1択制御 */
function _cdldOnlyOne(el){
  if(!el.checked){ el.checked = true; return; } // 全解除防止
  ['cdld-ck-std','cdld-ck-photo','cdld-ck-topo'].forEach(id => {
    const ck = document.getElementById(id);
    if(ck && ck !== el) ck.checked = false;
  });
}

/** 半径変更時 */
function _cdldOnRadiusChange(){
  const km = _cdldRadiusKm();
  const el = document.getElementById('cdld-radius-val');
  if(el) el.textContent = km + ' km';
  _cdldUpdateCircle();
  _cdldCalc();
}

// ─── cdld フェーズ切替ヘルパー ───────────────────────────
function _cdldShowPhase(ph){
  ['cdld-ph1','cdld-ph2','cdld-ph3','cdld-ph4'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = (id === ph) ? 'block' : 'none';
  });
  const panel = document.getElementById('cdld-panel');
  if(panel) panel.style.display = ph ? 'block' : 'none';
  // ph3表示時に推定容量を再計算
  if(ph === 'cdld-ph3') _cdldCalc();
}

/** タップ待ちモード（フェーズ①）開始 ― マップタブへ自動切替 */
function _cdldStartTap(){
  if(_cdldTapping) return;
  _cdldTapping = true;
  // バーを表示したまま地図タブへ
  _cdldShowPhase('cdld-ph1');
  _openTab('map');
  _pushHistory();
  // 1回だけクリックを受け取る
  _cdldTapHandler = function(e){
    _cdldTapping = false;
    _cdldSetCenter(e.latlng.lat, e.latlng.lng);
    // タップ後はフェーズ②（半径選択）へ
    _cdldShowPhase('cdld-ph2');
  };
  map.once('click', _cdldTapHandler);
}

/** フェーズ②から「📍 変更」→ フェーズ①に戻る */
function _cdldBackToTap(){
  if(_cdldTapHandler){ map.off('click', _cdldTapHandler); _cdldTapHandler = null; }
  _cdldStartTap();
}

/** 中心座標をセット（タップ or 外部からの引数渡し共通） */
function _cdldSetCenter(lat, lng){
  _cdldCenter = { lat, lng };
  const el = document.getElementById('cdld-center-val');
  if(el) el.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
  _cdldUpdateCircle();
  _cdldCalc();
}

/** ダイアログを開く（引数なし=タップ選択、引数あり=ポイント連携） */
function openCircleDlDialog(lat, lng){
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }
  isPremiumUser().then(premium => {
    if(!premium){ showPremiumGate('offline'); return; }

    // 内部状態を初期化
    _cdldTapping = false;
    if(_cdldTapHandler){ map.off('click', _cdldTapHandler); _cdldTapHandler = null; }
    _cdldCenter = null;
    if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }

    // フェーズ②のUI をリセット
    const slider    = document.getElementById('cdld-radius-slider');
    const radiusVal = document.getElementById('cdld-radius-val');
    const est       = document.getElementById('cdld-est');
    const dlBtn     = document.getElementById('cdld-dl-btn');
    const centerVal = document.getElementById('cdld-center-val');
    if(slider)    slider.value = 5;
    if(radiusVal) radiusVal.textContent = '5 km';
    if(est)       est.textContent = '— MB';
    if(dlBtn)     dlBtn.disabled = true;
    if(centerVal) centerVal.textContent = '—';
    // レイヤー初期化
    ['cdld-ck-std','cdld-ck-photo','cdld-ck-topo'].forEach((id,i) => {
      const ck = document.getElementById(id);
      if(ck) ck.checked = (i === 0);
    });

    if(lat !== undefined && lng !== undefined){
      // 座標引数あり → フェーズ②（半径選択）を直接表示
      _cdldSetCenter(lat, lng);
      _cdldShowPhase('cdld-ph2');
      _openTab('map');
      _pushHistory();
    } else {
      // 引数なし → フェーズ①（タップ待ちバー）
      _cdldStartTap();
    }
  });
}

/** キャンセル・閉じる共通処理 */
function _cdldCancel(){
  if(_cdldTapHandler){ map.off('click', _cdldTapHandler); _cdldTapHandler = null; }
  if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
  _cdldCenter  = null;
  _cdldTapping = false;
  _cdldShowPhase(null); // パネルを隠す
  // 停止中のレジュームがあればバナーを表示
  checkResume();
}

/** フェーズ③完了後の閉じるボタン */
function _cdldClose(){
  _cdldCancel();
}

/** フェーズ③ フェーズ切替（矩形 _dldS3SetPhase に対応） */
function _cdldPh3SetPhase(phase){
  const _e = id => document.getElementById(id);
  const titleMap = {
    running:  '⬇ タイルをダウンロード中です…',
    stopping: '⏳ 停止処理中です…',
    stopped:  '⏸ ダウンロードを停止しました',
    done:     '✅ ダウンロード完了'
  };
  const title = _e('cdld-ph3-title');
  if(title) title.textContent = titleMap[phase] || '';

  const stopMsg = _e('cdld-stopping-msg');
  if(stopMsg) stopMsg.style.display = phase === 'stopping' ? 'block' : 'none';

  const donePanel = _e('cdld-done-panel');
  if(donePanel) donePanel.style.display = phase === 'done' ? 'block' : 'none';

  // ボタングループ切り替え
  ['running','stopping','stopped','done'].forEach(p => {
    const el = _e('cdld-btns-' + p);
    if(el) el.style.display = p === phase ? 'flex' : 'none';
  });
}

/** フェーズ③ 進捗バー更新（矩形 _dldSyncProgress に対応） */
function _cdldSyncProgress(done, total, mb){
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const _e = id => document.getElementById(id);
  if(_e('cdld-pb-bar')) _e('cdld-pb-bar').style.width = pct + '%';
  if(_e('cdld-pb-pct')) _e('cdld-pb-pct').textContent  = pct + '%';
}

/** フェーズ③ 完了パネル表示（矩形 _dldShowDonePanel 相当） */
async function _cdldShowDonePanel(done, realBytes, layers, zmin, zmax, sessId){
  // バー: 完了時はアニメ停止・金色維持
  const pbBar = document.getElementById('cdld-pb-bar');
  if(pbBar){ pbBar.style.transition = 'none'; pbBar.style.width = '100%'; pbBar.classList.add('--done'); }
  const summary = document.getElementById('cdld-done-summary');
  if(summary){
    const mb = (realBytes / 1024 / 1024).toFixed(1);
    const layerNames = _layerLabel(layers, '・');
    summary.innerHTML =
      `<div class="dld-done-row">🗂 ${layerNames}</div>` +
      `<div class="dld-done-row">🔍 Z${zmin}〜Z${zmax}</div>` +
      `<div class="dld-done-row">💾 約 ${mb} MB</div>`;
  }

  const addBtn = document.getElementById('cdld-btn-addlayer');

  if(!sessId){
    if(addBtn) addBtn.style.display = 'none';
    return;
  }

  const sess = await dbGetSess(sessId).catch(() => null);
  if(!sess || !sess.bounds){
    if(addBtn) addBtn.style.display = 'none';
    return;
  }

  // 追加DL可能レイヤーがあるか仮レンダリングで確認
  const tmp = document.createElement('div');
  await _dldRenderAddLayerPanel(sessId, sess, tmp);
  const hasPending = tmp.querySelector('.dldadp-ck:not(:disabled)');

  if(addBtn){
    addBtn.style.display = hasPending ? 'inline-flex' : 'none';
    addBtn.dataset.sessId = sessId;
  }
}

/** 完了パネル内の追加DLボタン → ダイアログを開く */
function _cdldScrollToAddLayer(){
  const addBtn = document.getElementById('cdld-btn-addlayer');
  const sessId = addBtn?.dataset.sessId;
  _addlayerDialogOpen(sessId);
}

/** 停止ボタン */
function _cdldStop(){
  _cdldPh3SetPhase('stopping');
  dlStop = true;
  if(_dlAbortCtrl) _dlAbortCtrl.abort();
  // fetchがハングした場合の保険: 8秒後に強制リセット
  setTimeout(()=>{
    if(dlStop && dlRun){
      dlRun = false;
      _cdldPh3SetPhase('stopped');
    }
  }, 8000);
}

/** stopped フェーズ: 再開ボタン */
async function _cdldResume(){
  const s = loadResume();
  if(!s || s.subMode !== 'circle'){ showAlert('エラー','レジュームデータがありません'); return; }

  const bounds = L.latLngBounds([s.bounds.s, s.bounds.w], [s.bounds.n, s.bounds.e]);
  _cdldCenter = s.center || null;

  if(_cdldCenter){
    if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
    const _resumeBounds = _cdldBounds(_cdldCenter.lat, _cdldCenter.lng, s.radiusKm || 5);
    _cdldCircle = L.rectangle(_resumeBounds, {
      color: '#c8a84b', weight: 2,
      dashArray: '4 3',
      fillColor: '#c8a84b', fillOpacity: 0.10
    }).addTo(map);
  }

  _cdldPh3SetPhase('running');
  _cdldSyncProgress(s.taskIndex || 0, s.total || 0, '— MB');

  window._cdldActiveSession = { center: s.center, radiusKm: s.radiusKm };
  window._dldSyncProgressOverride = (done, total, mb) => _cdldSyncProgress(done, total, mb);

  await runDl('detail', bounds, s.zmin, s.zmax, s.layers, 0); // startIdx=0: IDBスキャンで自動スキップ

  window._dldSyncProgressOverride = null;
  window._cdldActiveSession = null;
  if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
}

/** stopped フェーズ: 破棄ボタン */
function _cdldDiscard(){
  clearResume();
  _cdldCancel();
}

/** DL開始 */
async function _cdldStartDl(){
  if(!_cdldCenter){ showAlert('エラー','中心座標を選択してください'); return; }
  const layers = ['std','photo','topo'].filter(k => document.getElementById('cdld-ck-'+k)?.checked);
  if(!layers.length){ showAlert('エラー','レイヤーを選択してください'); return; }
  if(dlRun){ showAlert('DL中','ダウンロードが実行中です。\n完了または停止してから再試みてください。'); return; }
  if(_guardResume()) return;
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません'); return; }

  // ベースDL完了チェック
  if(typeof getBaseDlDoneLayers === 'function'){
    const baseDone = await getBaseDlDoneLayers();
    const needBase = layers.filter(lk => !baseDone.has(lk));
    if(needBase.length){
      const names = needBase.map(lk => ({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
      const el = document.getElementById('cdld-est');
      const btn = document.getElementById('cdld-dl-btn');
      if(el) el.innerHTML =
        `<span style="color:#ffaa00">⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です。</span>` +
        `<br><button class="btn sm" style="margin-top:6px" onclick="_addlayerDialogCloseAny();_cdldCancel();_goToBaseDl()">📥 ベースDLへ</button>`;
      if(btn) btn.disabled = true;
      return;
    }
  }

  const zmax   = parseInt(document.getElementById('cdld-zmax')?.value || 16);
  const bounds = _cdldBounds(_cdldCenter.lat, _cdldCenter.lng, _cdldRadiusKm());

  // 容量チェック（既存関数流用）
  if(_dldCheckSize(bounds, zmax, layers)) return;

  // ── 重複DL確認 ──
  const proceed = await _checkDupAndConfirm(bounds, 10, zmax, layers);
  if(!proceed) return;

  // フェーズ④へ
  _cdldShowPhase('cdld-ph4');
  _cdldPh3SetPhase('running');

  // circle DL識別用セッション情報をグローバルに保持（runDl内のsaveResumeから参照）
  window._cdldActiveSession = { center: { lat: _cdldCenter.lat, lng: _cdldCenter.lng }, radiusKm: _cdldRadiusKm() };

  // レジューム保存（subMode:'circle' で矩形と区別）
  const now = new Date().toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  saveResume({
    mode: 'detail',
    subMode: 'circle',
    center: { lat: _cdldCenter.lat, lng: _cdldCenter.lng },
    radiusKm: _cdldRadiusKm(),
    bounds: { n: bounds.getNorth(), s: bounds.getSouth(), e: bounds.getEast(), w: bounds.getWest() },
    zmin: 10, zmax, layers,
    taskIndex: 0, total: 0,
    savedAt: now
  });

  detRect = bounds;

  // runDl 完了コールバックをフック（circle専用進捗・完了処理）
  const _cdldTickHook = (done, total, mb) => {
    _cdldSyncProgress(done, total, mb);
  };
  // runDl に渡すためにグローバルの _dldSyncProgress を一時差し替え
  const _saved = window._dldSyncProgressOverride;
  window._dldSyncProgressOverride = _cdldTickHook;

  await runDl('detail', bounds, 10, zmax, layers, 0);

  window._dldSyncProgressOverride = _saved;
  window._cdldActiveSession = null;

  // 完了後に円プレビューを除去
  if(_cdldCircle){ _cdldCircle.remove(); _cdldCircle = null; }
}