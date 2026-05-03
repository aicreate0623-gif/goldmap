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
  return ['std','photo','topo'].filter(k=>document.getElementById(prefix+k)?.checked);
}
function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M枚';if(n>=1e3)return Math.round(n/1e3)+'K枚';return n+'枚';}
// レイヤー別1枚あたりKB係数（実測値ベース）
// std: 地理院地図PNG ≈ 10KB、photo: 航空写真JPEG ≈ 18KB、topo: OpenTopoMap PNG ≈ 3KB
// 1枚あたりKB係数（実測値ベース: 地理院2460枚/25.8MB・航空2499枚/66.8MB・地形図2848枚/33.8MB）
const LAYER_KB = {std:11, photo:28, topo:12};
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
  return ['std','photo','topo'].filter(k=>document.getElementById('base-ck-'+k)?.checked);
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
  await runDl('base', JAPAN, 5, 9, layers, 0);
}

// ═══════════════════════════════════════════
//  全国DLダイアログ（base-dl-overlay）
// ═══════════════════════════════════════════

/** ダイアログを開く・DL済みステータスを反映 */
async function openBaseDlDialog(){
  const done = (typeof getBaseDlDoneLayers === 'function')
    ? await getBaseDlDoneLayers()
    : new Set();
  ['std','photo','topo'].forEach(lk => {
    const ck = document.getElementById('bdlg-ck-' + lk);
    const st = document.getElementById('bdlg-status-' + lk);
    if(ck) ck.checked = !done.has(lk);
    if(st) st.textContent = done.has(lk) ? '✅ DL済' : '';
  });
  updBaseDlgEst();
  document.getElementById('base-dl-overlay').style.display = 'flex';
}

/** ダイアログを閉じる */
function closeBaseDlDialog(){
  document.getElementById('base-dl-overlay').style.display = 'none';
}

/** 容量推定を更新（チェック変更時に呼ばれる） */
function updBaseDlgEst(){
  const el = document.getElementById('bdlg-est');
  if(!el) return;
  const layers = ['std','photo','topo'].filter(lk => document.getElementById('bdlg-ck-' + lk)?.checked);
  if(!layers.length){ el.textContent = '— MB'; return; }
  const n  = (typeof cntTiles === 'function') ? cntTiles(JAPAN, 5, 9) : 0;
  const mb = (typeof mbEstLayers === 'function') ? mbEstLayers(n, layers) : '—';
  el.textContent = `約 ${mb} MB`;
}

/** DL開始ボタン */
async function startBaseDlFromDialog(){
  const layers = ['std','photo','topo'].filter(lk => document.getElementById('bdlg-ck-' + lk)?.checked);
  if(!layers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }
  closeBaseDlDialog();
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
const _DLD_LAYER_LABEL = { std:'地理院地図', photo:'航空写真', topo:'地形図' };
/** レイヤーキー配列を表示名に変換して結合 例: ['std','photo'] → '地理院地図・航空写真' */
function _layerLabel(keys, sep){ return (keys||[]).map(k=>_DLD_LAYER_LABEL[k]||k).join(sep||'・'); }

// ── ダイアログ開く ──────────────────────────────────────
function openDlDialog(){
  if(!navigator.onLine){ showAlert('オフライン', 'インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }
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
      if(clrBtn) clrBtn.style.display = '';
      const hint = document.getElementById('dld-draw-hint');
      if(hint) hint.textContent = '範囲が選択されました。概算を確認して確定してください';
      // OKボタンをいったん有効化 → _dldSyncAndCalc内で100MB超過なら無効化
      const ok = document.getElementById('dld-draw-ok');
      if(ok) ok.disabled = false;
      _dldSyncAndCalc();
    }
  }, 150);
}

// ── STEP2簡易容量・解除ボタンをリセット（共通） ──────────
function _dldResetS1Est(){
  const calc = document.getElementById('dld-s1-est');
  const clr  = document.getElementById('dld-draw-clear');
  if(calc) calc.style.display = 'none';
  if(clr)  clr.style.display  = 'none';
  // チェック・ズームをデフォルトに戻す
  const std   = document.getElementById('s1-ck-std');
  const photo = document.getElementById('s1-ck-photo');
  const topo  = document.getElementById('s1-ck-topo');
  const zmax  = document.getElementById('s1-zmax');
  if(std)   std.checked   = true;
  if(photo) photo.checked = false;
  if(topo)  topo.checked  = false;
  if(zmax)  zmax.value    = '16';
  const tot = document.getElementById('dld-s1-total');
  if(tot) tot.textContent = '— MB';
}

// ── STEP2概算計算機 → STEP3設定パネルに同期して計算 ──────
function _dldSyncAndCalc(){
  // s1の値をSTEP3側に同期
  const map = { std:'std', photo:'photo', topo:'topo' };
  Object.keys(map).forEach(k=>{
    const s1 = document.getElementById('s1-ck-'+k);
    const s3 = document.getElementById('dlg-ck-'+k);
    if(s1 && s3) s3.checked = s1.checked;
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
  const chkLayers = ['std','photo','topo'].filter(k=>document.getElementById('s1-ck-'+k)?.checked);
  if(!chkLayers.length){
    tot.textContent = 'レイヤーを1つ以上選択してください';
    tot.style.color = 'var(--txt-dim)';
    return;
  }
  const eb  = estBytesLayers(base, chkLayers);
  const mb  = (eb / 1024 / 1024).toFixed(0);
  const over = eb > DL_SESSION_MAX;
  tot.textContent = `${chkLayers.length}レイヤー · Z10〜Z${zmax} · 約 ${mb} MB${over ? ' — 100MB超過' : ''}`;
  tot.style.color = over ? '#ff5a47' : '';

  // 100MB超過時は確定ボタンを無効化・解消時は再有効化
  // （_drawPendingがある＝ドラッグ完了済みの場合のみボタン状態を操作）
  if(_drawPending){
    const ok = document.getElementById('dld-draw-ok');
    if(ok) ok.disabled = over;
  }
}

// ── 100MB超過チェック共通（true=超過）──────────────────────
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
      `推定サイズ 約${mb}MB は1回のDL上限（100MB）を超えています。\nズームレベルを下げるか、レイヤー数を減らして再度お試しください。`);
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
  const chkLayers = ['std','photo','topo'].filter(k=>document.getElementById('s1-ck-'+k)?.checked);
  if(!chkLayers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(_dldCheckSize(_drawPending, zmax, chkLayers)) return;

  // ── ベースDL未完了チェック ──────────────────────────
  if(typeof getBaseDlDoneLayers === 'function'){
    const baseDone  = await getBaseDlDoneLayers();
    const needBase  = chkLayers.filter(lk => !baseDone.has(lk));
    if(needBase.length){
      const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
      // STEP2のヒントエリアに警告を表示（ダイアログは閉じない）
      const hint = document.getElementById('dld-draw-hint');
      if(hint) hint.innerHTML =
        `<span style="color:#ffaa00">⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です。</span>` +
        `<br><button class="btn sm" style="margin-top:6px"
          onclick="_dldCancel();_openTab('offline')">📥 ベースDLへ</button>`;
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
  ['std','photo','topo'].forEach(k=>{
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

// ── STEP3: DL開始 → STEP4へ ──────────────────────────
async function _dldStartDl(){
  const layers = ['std','photo','topo'].filter(k=>
    document.getElementById('dlg-ck-'+k)?.checked
  );
  if(!layers.length){ showAlert('エラー','レイヤーを1つ以上選択してください'); return; }
  if(!_dldBounds){    showAlert('エラー','範囲が選択されていません'); return; }
  if(!navigator.onLine){ showAlert('オフライン','インターネット接続がありません。\nオンライン時にダウンロードしてください。'); return; }

  // ── ベースDL未完了チェック（STEP3でレイヤーを変更した場合も必ずガード）──
  if(typeof getBaseDlDoneLayers === 'function'){
    const baseDone = await getBaseDlDoneLayers();
    const needBase = layers.filter(lk => !baseDone.has(lk));
    if(needBase.length){
      const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
      showAlert('ベースDLが必要です',`「${names}」はベースDL（Z5〜Z9 全国版）が完了していません。\nオフラインタブのベースDLを先に行ってください。`);
      return;
    }
  }

  const zmin = parseInt(document.getElementById('dlg-det-zmin').value);
  const zmax = parseInt(document.getElementById('dlg-det-zmax').value);

  if(_dldCheckSize(_dldBounds, zmax, layers)) return;

  detRect = _dldBounds;
  _dldRenderStep(3);
  await runDl('detail', detRect, zmin, zmax, layers, 0);
}

// ── STEP3: ダイアログ内バーに進捗同期 ─────────────────
function _dldSyncProgress(done, total, mb){
  const pct = total>0 ? Math.round(done/total*100) : 0;
  const el = id => document.getElementById(id);
  if(el('dld-pb-done')) el('dld-pb-done').textContent = done.toLocaleString();
  if(el('dld-pb-tot'))  el('dld-pb-tot').textContent  = total.toLocaleString();
  if(el('dld-pb-bar'))  el('dld-pb-bar').style.width  = pct+'%';
  if(el('dld-pb-mb'))   el('dld-pb-mb').textContent   = mb+' MB';
  // ダイアログ内ログミラー（200枚ごと）
  if(done%200===0 && el('dld-log')){
    const log = el('dld-log');
    log.textContent = `完了: ${fmt(done)} / ${fmt(total)}\n` + log.textContent;
    log.textContent = log.textContent.split('\n').slice(0,20).join('\n');
  }
}

// ── DL完了・停止時に閉じるボタン表示 ──────────────────
function _dldShowDone(stopped){
  const btns = document.getElementById('dld-dl-btns');
  if(!btns) return;
  btns.innerHTML = stopped
    ? `<button class="btn sm"     onclick="_dldCancel()">閉じる</button>`
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
  const layerStr=_layerLabel(s.layers);
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
    detRect=bounds; showRect();
  }
  await runDl(s.mode, bounds, s.zmin, s.zmax, layers, 0);
}

// ═══════════════════════════════════════════
//  DLプログレスダイアログ制御
// ═══════════════════════════════════════════

/** ダイアログを開いてDL開始状態にリセット */
function dlprogOpen(subText){
  const ov = document.getElementById('dl-prog-overlay');
  if(ov) ov.style.display = 'flex';
  _dlprogSetPhase('running');
  _dlprogSub(subText || '');
  _dlprogLog('');
}

/** ダイアログを閉じる（中断保存・完了） */
function dlprogClose(){
  const ov = document.getElementById('dl-prog-overlay');
  if(ov) ov.style.display = 'none';
  checkResume();
}

/** 停止後フェーズ: 続き or 中断保存 を表示 */
function dlprogStopped(){
  _dlprogSetPhase('stopped');
}

/** 完了フェーズ */
function dlprogDone(){
  _dlprogSetPhase('done');
}

/** 続きをDL（停止後から再開） */
async function dlprogResume(){
  _dlprogSetPhase('running');
  await resumeDl();
}

/** プログレス数値・バー更新 */
function dlprogUpdate(done, total, mb){
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const _e = id => document.getElementById(id);
  if(_e('dlprog-done')) _e('dlprog-done').textContent = done.toLocaleString();
  if(_e('dlprog-tot'))  _e('dlprog-tot').textContent  = total.toLocaleString();
  if(_e('dlprog-bar'))  _e('dlprog-bar').style.width  = pct + '%';
  if(_e('dlprog-pct'))  _e('dlprog-pct').textContent  = pct + '%';
  if(_e('dlprog-mb'))   _e('dlprog-mb').textContent   = mb;
}

/** サブタイトル（レイヤー名・ズーム範囲）更新 */
function _dlprogSub(text){
  const el = document.getElementById('dlprog-sub');
  if(el) el.textContent = text;
}

/** ログ追記 */
function _dlprogLog(msg){
  const el = document.getElementById('dlprog-log');
  if(!el) return;
  if(msg === '') { el.textContent = ''; return; }
  el.textContent = msg + '\n' + el.textContent;
  el.textContent = el.textContent.split('\n').slice(0, 30).join('\n');
}

/** フェーズ切替: 'running' | 'stopped' | 'done' */
function _dlprogSetPhase(phase){
  const ids = ['running','stopped','done'];
  ids.forEach(p => {
    const el = document.getElementById('dlprog-btns-' + p);
    if(el) el.style.display = p === phase ? 'flex' : 'none';
  });
}

// ═══════════════════════════════════════════
//  ダウンロードエンジン
// ═══════════════════════════════════════════
let dlRun=false, dlStop=false;
const CONCUR=6;

async function runDl(mode, bounds, zmin, zmax, layers, startIdx){
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
  const fetchTasks  = tasks.filter(t=>!cachedSet.has(tileKey(t.lk,t.z,t.x,t.y)));
  // total は全タスク数（進捗表示の分母）
  // done 初期値はキャッシュ済み数のみ（startIdxと合算しない）
  const total = tasks.length;

  dlRun=true; dlStop=false;
  document.getElementById('prog-section').classList.add('show');
  // DLプログレスダイアログを開く
  const _subText = `${_layerLabel(layers, ' · ')}  Z${zmin}〜Z${zmax}`;
  dlprogOpen(_subText);

  // ボタン切替（ベース/詳細タブ内）
  const SB=mode==='base'?document.getElementById('btn-stpbase'):document.getElementById('btn-stpdet');
  const DB2=mode==='base'?document.getElementById('btn-dlbase'):document.getElementById('btn-dldet');
  if(SB)  SB.style.display='block';
  if(DB2) DB2.disabled=true;

  // 統計リセット（キャッシュ済み分を done の初期値に）
  // startIdx はレジューム時のプログレスバー表示開始位置にのみ使用
  const _initDone = cachedCount;
  document.getElementById('pg-tot').textContent=total.toLocaleString();
  document.getElementById('pg-rem').textContent=fmt(Math.max(0,total-_initDone));
  document.getElementById('pg-done').textContent=_initDone.toLocaleString();
  document.getElementById('pg-bar').style.width=(total>0?Math.round(_initDone/total*100):0)+'%';
  document.getElementById('dl-log').textContent='';

  // resumeの境界情報
  const boundsData=mode==='base'?null:{n:bounds.getNorth(),s:bounds.getSouth(),e:bounds.getEast(),w:bounds.getWest()};

  let done=_initDone, fail=0, realBytes=0;
  const log=msg=>{
    const el=document.getElementById('dl-log');
    if(el){el.textContent=msg+'\n'+el.textContent;el.textContent=el.textContent.split('\n').slice(0,40).join('\n');}
    _dlprogLog(msg);
  };

  const tick=()=>{
    const processed=done+fail;
    const mbReal=(realBytes/1024/1024).toFixed(0)+' MB';
    document.getElementById('pg-done').textContent=done.toLocaleString();
    document.getElementById('pg-rem').textContent=fmt(Math.max(0,total-processed));
    document.getElementById('pg-mb').textContent=mbReal;
    document.getElementById('pg-bar').style.width=(total>0?Math.round(processed/total*100):0)+'%';
    // DLプログレスダイアログ更新
    dlprogUpdate(processed, total, mbReal);
    // DLダイアログ内バー同期
    if(typeof _dldSyncProgress==='function') _dldSyncProgress(done,total,mbReal);
    // DLダイアログ内ログミラー
    const _dlog=document.getElementById('dld-log');
    if(_dlog&&done%200===0){
      _dlog.textContent=`完了: ${fmt(done)} / ${fmt(total)}  失敗: ${fail}\n`+_dlog.textContent;
      _dlog.textContent=_dlog.textContent.split('\n').slice(0,20).join('\n');
    }
  };

  // fetchTasks のみをキューに積む（cachedSet除外済みなので重複DLなし）
  // startIdx オフセットは cachedSet による除外で代替するため不要
  const q = fetchTasks.slice(0);
  let active=0;

  await new Promise(resolve=>{
    const next=()=>{
      if(dlStop){resolve();return;}
      while(active<CONCUR&&q.length){
        active++;
        const t=q.shift();
        const k=tileKey(t.lk,t.z,t.x,t.y);
        const url2=tileURL(t.lk,t.z,t.x,t.y);
        const promise=db
          ?fetch(url2,{signal:AbortSignal.timeout?AbortSignal.timeout(8000):undefined})
              .then(r=>r.ok?r.arrayBuffer():null)
              .then(buf=>{if(buf)return dbPut(k,buf).then(()=>{done++;realBytes+=buf.byteLength;tick();});else{fail++;tick();}})
              .catch(()=>{fail++;tick();})
          :fetch(url2)
              .then(r=>r.ok?r.arrayBuffer():null)
              .then(buf=>{if(buf){done++;realBytes+=buf.byteLength;tick();}else{fail++;tick();}})
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

  dlRun=false; if(SB) SB.style.display='none'; if(DB2) DB2.disabled=false;
  if(!dlStop){
    // 完了したらレジューム削除
    deleteResume();
    document.getElementById('resume-banner').classList.remove('show');
    log('✅ 完了！ '+fmt(done)+'枚保存（失敗: '+fail+'）');
    dlprogDone();
    if(typeof _dldShowDone==='function') _dldShowDone(false);
    // セッション保存（レイヤーごとに個別保存）
    if(typeof saveDlSession==='function' && done>0){
      const _center = mode==='base'
        ? [35.0, 136.0]
        : [bounds.getCenter().lat, bounds.getCenter().lng];
      const _zoom   = zmax;
      const _bounds = mode==='base' ? null : {n:bounds.getNorth(),s:bounds.getSouth(),e:bounds.getEast(),w:bounds.getWest()};
      // レイヤーKBあたりの推定サイズ比（容量按分用）
      const layerKb = {std:11, photo:28, topo:12};
      const totalKb = layers.reduce((s,k)=>s+(layerKb[k]||10), 0);
      for(const lk of layers){
        const _tileKeys = tasks.filter(t=>t.lk===lk).map(t=>tileKey(t.lk,t.z,t.x,t.y));
        const myBytes   = totalKb > 0 ? realBytes * (layerKb[lk]||10) / totalKb : realBytes;
        const _label    = `${_layerLabel([lk])} Z${zmin}〜Z${zmax} ${new Date().toLocaleDateString('ja-JP')}`;
        await saveDlSession({label:_label, center:_center, zoom:_zoom, tileKeys:_tileKeys, totalSize:myBytes, srcKeys:[lk], bounds:_bounds, zmin, zmax, mode});
      }
    }
    // DL完了時に必ずMAXズームを更新（done=0のキャッシュ済み完了も含む）
    if(typeof updateMaxCachedZooms==='function') await updateMaxCachedZooms();
  } else {
    log('⏸ 停止しました。続きから再開できます。');
    dlprogStopped();
    if(typeof _dldShowDone==='function') _dldShowDone(true);
  }
  refreshCache();
}

function stopDl(){dlStop=true;}

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
    // zmax を追加DLの上限で更新（次回追加DLのzmin基準になる）
    if(typeof newZmax === 'number' && newZmax > (sess.zmax||0)){
      sess.zmax = newZmax;
    }
    sess.label = `${_layerLabel(sess.srcKeys)} Z${sess.zmin||11}〜Z${sess.zmax||15} ${new Date(sess.createdAt).toLocaleDateString('ja-JP')}`;
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
      msg:`❌ 推定サイズ 約${mb}MB は1回のDL上限(100MB)を超えています。\nエリアかズームレベルを絞ってください。`
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

  // ベースセッションは別途 renderBaseDlStatus() で表示するため除外
  const detailSessions = sessions.filter(s => s.mode !== 'base');

  // renderBaseDlStatus は常に同期して更新
  if(typeof renderBaseDlStatus === 'function') renderBaseDlStatus(sessions);

  if(!detailSessions.length){
    container.innerHTML = '<div class="sess-empty">保存済みのオフラインエリアはありません</div>';
    return;
  }

  const ALL_LAYERS = ['std','photo','topo'];
  const LAYER_LABEL = {std:'地理院地図', photo:'航空写真', topo:'地形図'};

  const sorted = [...detailSessions].sort((a,b)=>b.createdAt - a.createdAt);
  container.innerHTML = sorted.map(s=>{
    const mb   = ((s.totalSize||0)/1024/1024).toFixed(1);
    const date = new Date(s.createdAt).toLocaleDateString('ja-JP');
    const used = new Date(s.lastUsed).toLocaleDateString('ja-JP');
    const lat  = s.center?.[0]?.toFixed(4)||'—';
    const lng  = s.center?.[1]?.toFixed(4)||'—';
    const srcs  = (s.srcKeys||[]).map(k=>LAYER_LABEL[k]||k).join('・')||'—';
    // 既存セッションのlabelにキー名（std/photo/topo）が残っている場合は日本語で再構築
    const label = s.srcKeys && s.srcKeys.length
      ? `${s.srcKeys.map(k=>LAYER_LABEL[k]||k).join('・')} Z${s.zmin||'—'}〜Z${s.zmax||'—'} ${new Date(s.createdAt).toLocaleDateString('ja-JP')}`
      : (s.label || '名称未設定');
    const hasBounds = !!s.bounds;
    const addDlBtn = hasBounds
      ? `<button class="sess-adddl-btn" onclick="openAddLayerPanel('${s.id}')">＋</button>`
      : '';
    return `
    <div class="sess-card" id="sc-${s.id}">
      <div class="sess-map-thumb" onclick="jumpToSession('${s.id}')">
        <div class="sess-coord">${lat}<br>${lng}</div>
        <div class="sess-zoom-badge">Z${s.zoom||'—'}</div>
      </div>
      <div class="sess-info">
        <div class="sess-label">${_esc(label)}</div>
        <div class="sess-meta">約${mb}MB · ${srcs}</div>
        <div class="sess-meta">DL: ${date}</div>
        <div class="sess-meta">最終使用: ${used}</div>
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
        <select class="adp-zsel" id="adp-zmax-${s.id}" onchange="updAddLayerEst('${s.id}')">
          ${Array.from({length:14},(_,i)=>i+5)
            .map(z=>`<option value="${z}"${z===18?' disabled':''}>` +
              `${z>=17?'⚠️ ':''}Z${z}</option>`).join('')}
        </select>
        <span class="adp-zoom-hint" id="adp-zhint-${s.id}"></span>
      </div>
      <div class="adp-layers">
        ${ALL_LAYERS.map(lk=>{
          const done = (s.srcKeys||[]).includes(lk);
          // 未DLレイヤーもスキャン完了まで disabled（⏳）で初期化
          // スキャン後に _updateAdpCheckboxes が正しい状態に更新する
          return `<label class="adp-layer${done?' adp-layer--done':''}">
            <input type="checkbox" class="adp-ck" data-sess="${s.id}" data-lk="${lk}"
              ${done?'disabled checked':'disabled'} onchange="updAddLayerEst('${s.id}')">
            <span class="adp-lk-name">${LAYER_LABEL[lk]}</span>
            <span class="adp-lk-badge">${done?'✅ 済':'⏳'}</span>
            <div class="adp-zoom-status" id="adp-zstatus-${s.id}-${lk}">⏳</div>
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
const CACHE_STEPS_MB = [200, 400, 800, 1024, 2048];

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
    if(mb > 400){
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
  const ALL_LAYERS = ['std','photo','topo'];
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

  panel.style.display = 'block';

  // IDBスキャン
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(sess){
    const scanResult = await _scanAdpTiles(sess);
    _renderAdpZoomStatus(sessId, sess, scanResult);
    _renderAdpZoomHint(sessId, scanResult);
    _updateAdpCheckboxes(sessId, sess, scanResult);  // ①チェックボックス状態を確定
    await _setAdpZoomDefaults(sessId);               // ②ズームデフォルト値を自動セット（スキャン結果ベース）

    // ③全レイヤー・全ズーム完了チェック
    const allCks = panel.querySelectorAll('.adp-ck');
    const allComplete = allCks.length > 0 &&
      [...allCks].every(ck => ck.disabled && ck.checked);
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
  const ALL_LAYERS = ['std','photo','topo'];
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
  const panel = document.getElementById('adp-'+sessId);
  if(panel){
    panel.style.display='none';
    delete panel.dataset.adpDone; // 次回オープン用にフラグリセット
  }
  delete _adpScanCache[sessId];
}

/**
 * ズーム別DL状態をパネルに描画する。
 */
function _renderAdpZoomStatus(sessId, sess, scanResult){
  const ALL_LAYERS = ['std','photo','topo'];

  ALL_LAYERS.forEach(lk => {
    const statusEl = document.getElementById(`adp-zstatus-${sessId}-${lk}`);
    if(!statusEl) return;
    const lkData = scanResult[lk];
    if(!lkData || !lkData.perZoom){ statusEl.textContent = ''; return; }

    // タイルが実在するズームのみ表示（ADP_SCAN_ZMIN〜ADP_SCAN_ZMAX）
    const validZooms = [];
    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      if((lkData.perZoom[z]?.total || 0) > 0) validZooms.push(z);
    }
    if(!validZooms.length){ statusEl.textContent = ''; return; }

    // 連続する同状態をグループ化
    const parts = [];
    let groupStart = validZooms[0], groupStatus = lkData.perZoom[validZooms[0]]?.status || 'none';
    for(let i = 1; i < validZooms.length; i++){
      const z = validZooms[i];
      const st = lkData.perZoom[z]?.status || 'none';
      // ズームが連続しているかつ同じ状態かをチェック
      if(st === groupStatus && z === validZooms[i-1] + 1){
        continue;
      }
      parts.push({ zs: groupStart, ze: validZooms[i-1], status: groupStatus });
      groupStart = z; groupStatus = st;
    }
    parts.push({ zs: groupStart, ze: validZooms[validZooms.length-1], status: groupStatus });

    const STATUS_LABEL = { done: '✅済', partial: '⚠一部', none: '未' };
    const STATUS_COLOR = { done: '#4caf50', partial: '#ffaa00', none: '#888' };
    statusEl.innerHTML = parts.map(p => {
      const zLabel = p.zs === p.ze ? `Z${p.zs}` : `Z${p.zs}-${p.ze}`;
      return `<span style="color:${STATUS_COLOR[p.status]};margin-right:6px">${zLabel}: ${STATUS_LABEL[p.status]}</span>`;
    }).join('');
  });
}

/**
 * スキャン結果を元にチェックボックスの有効/無効・バッジを更新。
 * - srcKeysに含まれるレイヤー（DL済み）: disabled + checked + ✅ 済
 * - 全ズームが done のレイヤー          : disabled + checked + ✅ 済
 * - 未DL・partialのレイヤー            : enabled  + unchecked + 未
 */
function _updateAdpCheckboxes(sessId, sess, scanResult){
  const ALL_LAYERS = ['std','photo','topo'];
  ALL_LAYERS.forEach(lk => {
    const ck = document.querySelector(`.adp-ck[data-sess="${sessId}"][data-lk="${lk}"]`);
    if(!ck) return;

    const badgeEl = ck.parentElement?.querySelector('.adp-lk-badge');
    const labelEl = ck.parentElement;

    // srcKeysに含まれていてもズームが未DLの場合があるため早期returnしない
    // → スキャン結果で allDone を判定して状態を上書きする

    // スキャン結果が取れなかった場合
    const lkData = scanResult[lk];
    if(!lkData || !lkData.perZoom){
      // srcKeysに含まれる = 一度DL済みなので済み表示のまま
      const alreadyInSess = (sess.srcKeys||[]).includes(lk);
      if(!alreadyInSess){
        ck.disabled = false;
        ck.checked  = false;
        if(badgeEl) badgeEl.textContent = '未';
      }
      return;
    }

    // スキャン範囲内で「未(none)」または「一部(partial)」のズームが1つでもあれば未DL扱い
    // total===0（セッション範囲外）のズームは無視する
    let allDone = true;
    let hasAnyTile = false; // タイルが存在するズームが1つでもあるか
    for(let z = ADP_SCAN_ZMIN; z <= ADP_SCAN_ZMAX; z++){
      if(lk === 'topo' && z === 18) continue; // OpenTopoMapはZ18非対応のため除外
      const pz = lkData.perZoom[z];
      if(!pz || pz.total === 0) continue; // タイルが存在しないズームは無視
      hasAnyTile = true;
      if(pz.status !== 'done'){ allDone = false; break; }
    }
    // タイルが1枚もスキャンできなかった場合は「未」として扱う（スキャン失敗保険）
    if(!hasAnyTile) allDone = false;

    if(allDone){
      ck.disabled = true;
      ck.checked  = true;
      if(badgeEl) badgeEl.textContent = '✅ 済';
      if(labelEl) labelEl.classList.add('adp-layer--done');
    } else {
      ck.disabled = false;
      ck.checked  = false;
      if(badgeEl) badgeEl.textContent = '未';
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
  const ALL_LAYERS = ['std','photo','topo'];

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
  // recZmin が推奨上限(18)を超えている場合はそのまま recZmin をデフォルトにする
  const recZmax = Math.max(recZmin, 18);
  const opt = [...zmaxEl.options].find(o => parseInt(o.value) >= recZmax);
  if(opt) zmaxEl.value = opt.value;
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
    const names = needBase.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
    if(estEl) estEl.innerHTML = `
      <span class="adp-est-line adp-est-over">
        ⚠️ 「${names}」はベースDL（Z5〜Z9 全国版）が必要です
      </span>
      <span class="adp-est-line">
        <button class="btn sm" style="margin-top:4px"
          onclick="_openTab('offline')">📥 ベースDLへ</button>
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
        未DL: 約 ${netMb} MB（${netTiles.toLocaleString()}枚）${overLimit?' — 100MB超過':''}
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
  const selected = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el=>el.dataset.lk);
  if(!selected.length){ showAlert('エラー','レイヤーを選択してください'); return; }

  if(typeof runDl !== 'function'){ showAlert('エラー','DL機能が読み込まれていません'); return; }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  // ズームselectの値を優先（なければセッション値）
  const zmin = parseInt(document.getElementById(`adp-zmin-${sessId}`)?.value) || sess.zmin || 11;
  const zmax = parseInt(document.getElementById(`adp-zmax-${sessId}`)?.value) || sess.zmax || 16;

  // パネルをDL中UIに切り替え（パネルは閉じない）
  _adpShowProgress(sessId, selected);

  let hookCalled = false;
  const origSave = window.saveDlSession;
  window.saveDlSession = async (opts)=>{
    hookCalled = true;
    window.saveDlSession = origSave;
    if(typeof addLayersToSession==='function'){
      await addLayersToSession(sessId, selected, opts.tileKeys||[], opts.totalSize||0, zmax);
    }
    _adpShowDone(sessId);
    await refreshCache();
  };
  await runDl('detail', bounds, zmin, zmax, selected, 0);
  window.saveDlSession = origSave;
  // done===0（全キャッシュ済み）等でフックが呼ばれなかった場合も
  // セッションのzmax/srcKeysだけは必ず更新する
  if(!hookCalled && typeof addLayersToSession==='function'){
    await addLayersToSession(sessId, selected, [], 0, zmax);
  }
  _adpShowDone(sessId);
  await refreshCache();
}

/**
 * 追加DLパネルをDL中モードに切り替える。
 * ui.js の _dldLog / _dldProg を監視して進捗を表示する。
 */
function _adpShowProgress(sessId, layers){
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;

  // 選択UI → プログレスUIに差し替え
  const layerNames = layers.map(lk=>({'std':'地理院地図','photo':'航空写真','topo':'地形図'}[lk]||lk)).join('・');
  panel.querySelector('.adp-layers').style.display = 'none';
  panel.querySelector('.adp-footer').style.display = 'none';

  let prog = document.getElementById(`adp-prog-${sessId}`);
  if(!prog){
    prog = document.createElement('div');
    prog.id = `adp-prog-${sessId}`;
    prog.className = 'adp-progress-area';
    panel.appendChild(prog);
  }
  prog.style.display = 'block';
  prog.innerHTML = `
    <div class="adp-prog-label">⬇ DL中: ${layerNames}</div>
    <div class="adp-prog-bar-wrap">
      <div class="adp-prog-bar" id="adp-pbar-${sessId}" style="width:0%"></div>
    </div>
    <div class="adp-prog-count" id="adp-pcnt-${sessId}">0 / —</div>
    <div class="adp-prog-log"  id="adp-plog-${sessId}"></div>
  `;

  // ui.jsのdl-logとdl-progを監視してミラーする（MutationObserver）
  _adpMirrorDlProgress(sessId);
}

function _adpMirrorDlProgress(sessId){
  const dstCnt = document.getElementById(`adp-pcnt-${sessId}`);
  const dstBar = document.getElementById(`adp-pbar-${sessId}`);
  const dstLog = document.getElementById(`adp-plog-${sessId}`);

  // dlprog-* を参照（runDl が dlprogUpdate() 経由で実際に更新する要素）
  const timer = setInterval(()=>{
    if(!document.getElementById(`adp-prog-${sessId}`)){ clearInterval(timer); return; }
    const pgBar  = document.getElementById('dlprog-bar');
    const pgDone = document.getElementById('dlprog-done');
    const pgTot  = document.getElementById('dlprog-tot');
    const pgPct  = document.getElementById('dlprog-pct');
    const pct    = pgPct ? pgPct.textContent : (pgBar ? pgBar.style.width : '0%');
    if(dstBar && pgBar) dstBar.style.width = pgBar.style.width;
    if(dstCnt && pgDone && pgTot)
      dstCnt.textContent = `${pgDone.textContent} / ${pgTot.textContent}（${pct}）`;
    const srcLog = document.getElementById('dlprog-log');
    if(srcLog && dstLog){
      const firstLine = srcLog.textContent.split('\n')[0] || '';
      if(firstLine) dstLog.textContent = firstLine;
    }
  }, 300);
}

function _adpShowDone(sessId){
  const panel = document.getElementById('adp-'+sessId);
  if(!panel) return;
  // 二重呼び出し防止（saveDlSessionフックと runDl完了後の両方から呼ばれる場合）
  if(panel.dataset.adpDone === '1') return;
  panel.dataset.adpDone = '1';
  const prog = document.getElementById(`adp-prog-${sessId}`);
  if(prog){
    const bar = document.getElementById(`adp-pbar-${sessId}`);
    if(bar){ bar.style.width = '100%'; bar.style.background = '#4caf50'; }
    const cnt = document.getElementById(`adp-pcnt-${sessId}`);
    if(cnt) cnt.textContent = '✅ DL完了';
    const log = document.getElementById(`adp-plog-${sessId}`);
    if(log) log.textContent = '';
  }
  // 閉じるボタンを表示
  let closeBtn = document.getElementById(`adp-close-${sessId}`);
  if(!closeBtn){
    closeBtn = document.createElement('button');
    closeBtn.id = `adp-close-${sessId}`;
    closeBtn.className = 'btn accent';
    closeBtn.style.cssText = 'margin-top:10px;width:100%';
    closeBtn.textContent = '閉じる';
    closeBtn.onclick = ()=>{
      closeAddLayerPanel(sessId);
      // プログレスエリアをリセット（次回オープン用）
      const p = document.getElementById(`adp-prog-${sessId}`);
      if(p) p.remove();
      const lays = panel.querySelector('.adp-layers');
      const foot = panel.querySelector('.adp-footer');
      if(lays) lays.style.display = '';
      if(foot) foot.style.display = '';
    };
    panel.appendChild(closeBtn);
  }
}

/**
 * ベースDLセクションの各レイヤー行にステータスを表示する。
 * renderSessionList() から自動的に呼ばれる。
 * @param {Array} sessions - dbGetAllSess() の結果（全セッション）
 */
function renderBaseDlStatus(sessions){
  const LAYERS = ['std','photo','topo'];

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