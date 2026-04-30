'use strict';

// ═══════════════════════════════════════════
//  定数
// ═══════════════════════════════════════════
const CACHE_MAX_DEFAULT  = 400 * 1024 * 1024;  // 400MB
const CACHE_MAX_HARD     = 2048 * 1024 * 1024; // 2GB（スライダー上限）
const DL_SESSION_MAX     = 100 * 1024 * 1024;  // 1回DL上限 100MB（固定）
const CACHE_MAX_WARN_RATIO = 0.80;              // 80%超で警告

// ─── キャッシュ上限（localStorageで永続化）
function getCacheMax(){
  const v = parseInt(localStorage.getItem('cacheMaxBytes'));
  return (!isNaN(v) && v > 0) ? v : CACHE_MAX_DEFAULT;
}
function setCacheMax(bytes){
  localStorage.setItem('cacheMaxBytes', bytes);
}

// ═══════════════════════════════════════════
//  IndexedDB  DB_VER: 3 → 4
// ═══════════════════════════════════════════
const DB_NAME='gm_tiles', DB_VER=4, ST='tiles', ST_MINE='mine_data', ST_SESS='dl_sessions';
let db=null;

function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(ST))      d.createObjectStore(ST);
      if(!d.objectStoreNames.contains(ST_MINE)) d.createObjectStore(ST_MINE);
      if(!d.objectStoreNames.contains(ST_SESS)) d.createObjectStore(ST_SESS);
    };
    r.onsuccess=e=>{db=e.target.result;res();};
    r.onerror=e=>rej(e);
  });
}

function idb(mode,fn,store){
  return new Promise((res,rej)=>{
    const tx=db.transaction(store||ST,mode),s=tx.objectStore(store||ST),r=fn(s);
    r.onsuccess=()=>res(r.result);
    r.onerror=e=>rej(e);
  });
}

// ─── タイルストア
const dbGet    = (k)     => idb('readonly', s=>s.get(k));
const dbPut    = (k,v)   => idb('readwrite',s=>s.put(v,k));
const dbDel    = (k)     => idb('readwrite',s=>s.delete(k));
const dbClr    = ()      => idb('readwrite',s=>s.clear());
const dbCnt    = ()      => idb('readonly', s=>s.count());

// ─── mine_dataストア
const dbGetMine = (k)   => idb('readonly', s=>s.get(k),   ST_MINE);
const dbPutMine = (k,v) => idb('readwrite',s=>s.put(v,k), ST_MINE);
const dbDelMine = (k)   => idb('readwrite',s=>s.delete(k),ST_MINE);

// ─── dl_sessionsストア
const dbGetSess = (k)   => idb('readonly', s=>s.get(k),   ST_SESS);
const dbPutSess = (k,v) => idb('readwrite',s=>s.put(v,k), ST_SESS);
const dbDelSess = (k)   => idb('readwrite',s=>s.delete(k),ST_SESS);

function dbGetAllSess(){
  return new Promise((res,rej)=>{
    const tx=db.transaction(ST_SESS,'readonly');
    const req=tx.objectStore(ST_SESS).getAll();
    req.onsuccess=()=>res(req.result||[]);
    req.onerror=e=>rej(e);
  });
}

// ═══════════════════════════════════════════
//  タイルソース
// ═══════════════════════════════════════════
const SRCS={
  std:  {url:'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',           ext:'png', attr:'地理院タイル'},
  photo:{url:'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', ext:'jpg', attr:'地理院写真'},
  topo: {url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',                       ext:'png', attr:'OpenTopoMap'},
};
function tileURL(key,z,x,y){ return SRCS[key].url.replace('{z}',z).replace('{x}',x).replace('{y}',y); }
function tileKey(key,z,x,y){ return key+'/'+z+'/'+x+'/'+y; }

// ═══════════════════════════════════════════
//  カスタムキャッシュレイヤー（既存・変更なし）
// ═══════════════════════════════════════════
function makeCachedLayer(srcKey){
  return L.TileLayer.extend({
    _sk:srcKey,
    createTile(coords,done){
      const img=document.createElement('img');
      img.crossOrigin='anonymous';
      const maxNative=this.options.maxNativeZoom;
      let z=coords.z,x=coords.x,y=coords.y;
      if(z>maxNative){
        const diff=z-maxNative,factor=Math.pow(2,diff);
        z=maxNative; x=Math.floor(coords.x/factor); y=Math.floor(coords.y/factor);
        const size=256*factor;
        img.style.width=size+'px'; img.style.height=size+'px';
        img.style.marginLeft=-(coords.x%factor)*256+'px';
        img.style.marginTop=-(coords.y%factor)*256+'px';
        img.style.imageRendering='pixelated';
      }
      const key=tileKey(this._sk,z,x,y);
      const net=tileURL(this._sk,coords.z,coords.x,coords.y);
      if(!db){ img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img); return img; }
      dbGet(key).then(cached=>{
        if(cached){ const type=this._sk==='photo'?'image/jpeg':'image/png'; img.src=URL.createObjectURL(new Blob([cached],{type})); }
        else img.src=net;
        img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
      }).catch(()=>{ img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img); });
      return img;
    }
  });
}

// ═══════════════════════════════════════════
//  セッション管理ユーティリティ
// ═══════════════════════════════════════════

/** 全セッションの合計サイズ（バイト） */
async function calcTotalCacheSize(){
  const sessions = await dbGetAllSess();
  return sessions.reduce((sum,s)=>sum+(s.totalSize||0), 0);
}

/** 全セッション一覧をlastUsed昇順（古い順）で返す */
async function getSessionsSorted(){
  const sessions = await dbGetAllSess();
  return sessions.sort((a,b)=>a.lastUsed - b.lastUsed);
}

/**
 * LRU追い出し：上限超過時に最古セッションを確認ダイアログ付きで削除。
 * @returns {boolean} 続行可能か
 */
async function evictIfNeeded(incomingSize){
  const cacheMax = getCacheMax();
  let total = await calcTotalCacheSize();
  if(total + incomingSize <= cacheMax) return true;

  const sessions = await getSessionsSorted();
  for(const sess of sessions){
    const freed = sess.totalSize || 0;
    const label = sess.label || '名称未設定';
    const mb    = (freed/1024/1024).toFixed(1);
    const date  = new Date(sess.createdAt).toLocaleDateString('ja-JP');

    const ok = await showConfirmDialog(
      `💾 キャッシュ容量が不足しています\n\n「${label}」(${mb}MB · ${date}) を\n削除して容量を確保してよいですか？`,
      '削除して続行', 'キャンセル'
    );
    if(!ok) return false;

    if(Array.isArray(sess.tileKeys)){
      for(const k of sess.tileKeys){ await dbDel(k).catch(()=>{}); }
    }
    await dbDelSess(sess.id);
    total -= freed;
    if(total + incomingSize <= cacheMax) return true;
  }
  return true;
}

/**
 * DLセッションを保存する。
 * @param {object} opts - {label, center, zoom, tileKeys, totalSize, srcKeys, bounds, zmin, zmax}
 */
async function saveDlSession(opts){
  const id = 'sess_' + Date.now();
  const sess = {
    id,
    label:         opts.label         || '名称未設定',
    center:        opts.center        || [35.0, 136.0],
    zoom:          opts.zoom          || 14,
    createdAt:     Date.now(),
    lastUsed:      Date.now(),
    tileKeys:      opts.tileKeys      || [],
    totalSize:     opts.totalSize     || 0,
    srcKeys:       opts.srcKeys       || [],
    bounds:        opts.bounds        || null,
    zmin:          opts.zmin          || 11,
    zmax:          opts.zmax          || 15,
    pendingChunks: opts.pendingChunks || null, // 分割DL残チャンク [{zmin,zmax},...]
    pendingZmin:   opts.pendingZmin   || null, // 次チャンクの開始zmin（表示用）
  };
  await dbPutSess(id, sess);
  return sess;
}

/** セッションの lastUsed を更新（LRUキー） */
async function touchSession(id){
  try {
    const sess = await dbGetSess(id);
    if(sess){ sess.lastUsed = Date.now(); await dbPutSess(id, sess); }
  } catch(e){}
}

/** セッションを手動削除（確認ダイアログ付き） */
async function deleteSessionWithConfirm(id){
  const sess = await dbGetSess(id).catch(()=>null);
  if(!sess) return;
  const label = sess.label || '名称未設定';
  const mb    = ((sess.totalSize||0)/1024/1024).toFixed(1);
  const ok = await showConfirmDialog(
    `🗑 「${label}」(${mb}MB) を削除しますか？\nこの操作は取り消せません。`,
    '削除', 'キャンセル'
  );
  if(!ok) return;
  if(Array.isArray(sess.tileKeys)){
    for(const k of sess.tileKeys){ await dbDel(k).catch(()=>{}); }
  }
  await dbDelSess(id);
  await renderSessionList();
  await refreshCache();
}

/** 全キャッシュクリア（確認ダイアログ付き） */
async function clearCacheWithConfirm(){
  const ok = await showConfirmDialog(
    `⚠️ すべてのオフラインデータを削除しますか？\nDLセッション履歴も含めて完全に消去されます。\nこの操作は取り消せません。`,
    '全削除', 'キャンセル'
  );
  if(!ok) return;
  await dbClr();
  const sessions = await dbGetAllSess();
  for(const s of sessions){ await dbDelSess(s.id).catch(()=>{}); }
  await renderSessionList();
  await refreshCache();
}

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
      msg:`❌ 推定サイズ ${mb}MB は1回のDL上限(100MB)を超えています。\nエリアかズームレベルを絞ってください。`
    };
  }
  if(estimatedBytes > DL_SESSION_MAX * CACHE_MAX_WARN_RATIO){
    const mb = (estimatedBytes/1024/1024).toFixed(0);
    return {
      ok:true, warn:true,
      msg:`⚠️ 推定 ${mb}MB は上限に近い値です。WIFI環境を推奨します。`
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

  if(!sessions.length){
    container.innerHTML = '<div class="sess-empty">保存済みのオフラインエリアはありません</div>';
    return;
  }

  const ALL_LAYERS = ['std','photo','topo'];
  const LAYER_LABEL = {std:'地理院地図', photo:'航空写真', topo:'地形図'};

  const sorted = [...sessions].sort((a,b)=>b.lastUsed - a.lastUsed);
  container.innerHTML = sorted.map(s=>{
    const mb   = ((s.totalSize||0)/1024/1024).toFixed(1);
    const date = new Date(s.createdAt).toLocaleDateString('ja-JP');
    const used = new Date(s.lastUsed).toLocaleDateString('ja-JP');
    const lat  = s.center?.[0]?.toFixed(4)||'—';
    const lng  = s.center?.[1]?.toFixed(4)||'—';
    const srcs = (s.srcKeys||[]).join('・')||'—';
    const hasBounds = !!s.bounds;
    const addDlBtn = hasBounds
      ? `<button class="sess-adddl-btn" onclick="openAddLayerPanel('${s.id}')">＋</button>`
      : '';
    const contBtn = (s.pendingChunks && s.pendingChunks.length)
      ? `<button class="sess-cont-btn" onclick="continueChunkedDl('${s.id}')" title="続き（Z${s.pendingZmin}〜）をDL">続き▶</button>`
      : '';
    return `
    <div class="sess-card" id="sc-${s.id}">
      <div class="sess-map-thumb" onclick="jumpToSession('${s.id}')">
        <div class="sess-coord">${lat}<br>${lng}</div>
        <div class="sess-zoom-badge">Z${s.zoom||'—'}</div>
      </div>
      <div class="sess-info">
        <div class="sess-label">${_esc(s.label)}</div>
        <div class="sess-meta">${mb}MB · ${srcs}</div>
        <div class="sess-meta">DL: ${date}</div>
        <div class="sess-meta">最終使用: ${used}</div>
      </div>
      <div class="sess-btns">
        ${contBtn}
        ${addDlBtn}
        <button class="sess-del-btn" onclick="deleteSessionWithConfirm('${s.id}')">🗑</button>
      </div>
    </div>
    <div class="sess-adddl-panel" id="adp-${s.id}" style="display:none">
      <div class="adp-title">追加ダウンロード — レイヤー選択</div>
      <div class="adp-zoom-row">
        <span class="adp-zoom-label">ズーム:</span>
        <select class="adp-zsel" id="adp-zmin-${s.id}" onchange="updAddLayerEst('${s.id}')">
          ${Array.from({length:14},(_,i)=>i+5)
            .map(z=>`<option value="${z}">Z${z}</option>`).join('')}
        </select>
        <span class="adp-zoom-sep">〜</span>
        <select class="adp-zsel" id="adp-zmax-${s.id}" onchange="updAddLayerEst('${s.id}')">
          ${Array.from({length:14},(_,i)=>i+5)
            .map(z=>`<option value="${z}">Z${z}</option>`).join('')}
        </select>
        <span class="adp-zoom-hint" id="adp-zhint-${s.id}"></span>
      </div>
      <div class="adp-layers">
        ${ALL_LAYERS.map(lk=>{
          const done = (s.srcKeys||[]).includes(lk);
          return `<label class="adp-layer${done?' adp-layer--done':''}">
            <input type="checkbox" class="adp-ck" data-sess="${s.id}" data-lk="${lk}"
              ${done?'disabled checked':''} onchange="updAddLayerEst('${s.id}')">
            <span class="adp-lk-name">${LAYER_LABEL[lk]}</span>
            <span class="adp-lk-badge">${done?'✅ 済':'未'}</span>
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
    if(sb) sb.textContent = `キャッシュ: ${mb}MB`;
    await renderSessionList();
  } catch(e){ el.textContent = '取得失敗'; }
}

// ═══════════════════════════════════════════
//  追加レイヤーDLパネル
// ═══════════════════════════════════════════

// パネルごとのIDBスキャン結果キャッシュ: sessId → {lk → {total,cached,perZoom}}
const _adpScanCache = {};

// 追加DLパネルでスキャンするズーム範囲（IDB実在タイルを漏れなく検知するため広めに設定）
const ADP_SCAN_ZMIN = 5;
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
 * スキャン結果を元にチェックボックスの有効/無効を更新。
 * 全ズームが済み(done)のレイヤーはdisabledにする。
 */
function _updateAdpCheckboxes(sessId, sess, scanResult){
  const ALL_LAYERS = ['std','photo','topo'];
  ALL_LAYERS.forEach(lk => {
    const ck = document.querySelector(`.adp-ck[data-sess="${sessId}"][data-lk="${lk}"]`);
    if(!ck) return;
    const lkData = scanResult[lk];
    if(!lkData) return;
    // 元々DL済みレイヤー(srcKeys)はそのままdisabled
    const alreadyInSess = (sess.srcKeys||[]).includes(lk);
    if(alreadyInSess) return;
  });
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
  const zmin = parseInt(document.getElementById(`adp-zmin-${sessId}`)?.value) || sess.zmin || 11;
  const zmax = parseInt(document.getElementById(`adp-zmax-${sessId}`)?.value) || sess.zmax || 15;

  // スピナー表示
  if(estEl) estEl.innerHTML = '<span class="adp-spinner"></span><span class="adp-est-scanning">計算中...</span>';
  if(btn) btn.disabled = true;

  // IDBスキャンで正確なキャッシュ済み数を取得
  let netTiles = 0, totalTiles = 0;
  try {
    for(const lk of selected){
      const kb = (typeof LAYER_KB !== 'undefined' && LAYER_KB[lk]) || 7;
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
    if(typeof LAYER_KB === 'undefined') return 7;
    let sum = 0;
    selected.forEach(lk => sum += (LAYER_KB[lk]||7));
    return sum / selected.length;
  })();

  const netBytes   = netTiles   * avgKb * 1024;
  const totalBytes = totalTiles * avgKb * 1024;
  const netMb      = (netBytes   / 1024 / 1024).toFixed(0);
  const totalMb    = (totalBytes / 1024 / 1024).toFixed(0);
  const overLimit  = netBytes > DL_SESSION_MAX;

  if(estEl){
    estEl.innerHTML = `
      <span class="adp-est-line adp-est-net${overLimit?' adp-est-over':''}">
        未DL: 約 ${netMb} MB（${netTiles.toLocaleString()}枚）${overLimit?' — 100MB超過':''}
      </span>
      <span class="adp-est-line adp-est-total">
        合計: 約 ${totalMb} MB（${totalTiles.toLocaleString()}枚） Z${zmin}〜Z${zmax}
      </span>`;
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
  const zmax = parseInt(document.getElementById(`adp-zmax-${sessId}`)?.value) || sess.zmax || 15;

  // パネルをDL中UIに切り替え（パネルは閉じない）
  _adpShowProgress(sessId, selected);

  const origSave = window.saveDlSession;
  window.saveDlSession = async (opts)=>{
    window.saveDlSession = origSave;
    if(typeof addLayersToSession==='function'){
      await addLayersToSession(sessId, selected, opts.tileKeys||[], opts.totalSize||0);
    }
    _adpShowDone(sessId);
    await refreshCache();
  };
  await runDl('detail', bounds, zmin, zmax, selected, 0);
  window.saveDlSession = origSave;
  // saveDlSessionが呼ばれなかった場合（done===0等）も完了UIを確実に出す
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

  // pg-bar / pg-done / pg-tot を参照（runDl が実際に更新する要素）
  const timer = setInterval(()=>{
    if(!document.getElementById(`adp-prog-${sessId}`)){ clearInterval(timer); return; }
    const pgBar  = document.getElementById('pg-bar');
    const pgDone = document.getElementById('pg-done');
    const pgTot  = document.getElementById('pg-tot');
    const pct    = pgBar ? pgBar.style.width : '0%';
    if(dstBar) dstBar.style.width = pct;
    if(dstCnt && pgDone && pgTot)
      dstCnt.textContent = `${pgDone.textContent} / ${pgTot.textContent}（${pct}）`;
    const srcLog = document.getElementById('dl-log');
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

// ═══════════════════════════════════════════
//  分割DL: セッションカードの「続き」ボタンから再開
// ═══════════════════════════════════════════
async function continueChunkedDl(sessId){
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess){ showAlert('エラー','セッションが見つかりません'); return; }
  if(!sess.pendingChunks || !sess.pendingChunks.length){
    showAlert('情報','続きのDLはありません');
    return;
  }
  if(!sess.bounds){ showAlert('エラー','範囲情報がありません'); return; }

  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const layers = sess.srcKeys || ['std'];
  const chunks = sess.pendingChunks;

  // ui.js の _runChunkedDl を呼ぶ（ダイアログ経由せず直接実行）
  if(typeof _runChunkedDl !== 'function'){
    showAlert('エラー','DL機能が読み込まれていません'); return;
  }
  // オフラインタブを開いてDL開始
  if(typeof switchTab === 'function') switchTab('offline');

  // DLダイアログが存在すればSTEP3（進捗）に切り替え
  const dlg = document.getElementById('dl-dialog');
  if(dlg && dlg.style.display !== 'none'){
    if(typeof _dldRenderStep === 'function') _dldRenderStep(3);
    if(typeof _dldInjectChunkLabel === 'function') _dldInjectChunkLabel(chunks.length);
  }

  await _runChunkedDl(bounds, layers, chunks, 0, sessId);
  await refreshCache();
}