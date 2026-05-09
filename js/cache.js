'use strict';

// ═══════════════════════════════════════════
//  定数
// ═══════════════════════════════════════════
const CACHE_MAX_DEFAULT  = 500 * 1024 * 1024;  // 500MB
const CACHE_MAX_HARD     = 2048 * 1024 * 1024; // 2GB（スライダー上限）
const DL_SESSION_MAX     = 120 * 1024 * 1024;  // 1回DL上限 120MB（固定）
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
  std:   {url:'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',              ext:'png', attr:'地理院タイル',   maxNative:18},
  photo: {url:'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',    ext:'jpg', attr:'地理院写真',     maxNative:18},
  topo:  {url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',                          ext:'png', attr:'OpenTopoMap',   maxNative:17},
  hill:  {url:'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png',     ext:'png', attr:'地理院陰影',     maxNative:16},
  relief:{url:'https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png',           ext:'png', attr:'地理院色別標高', maxNative:15},
};
function tileURL(key,z,x,y){ return SRCS[key].url.replace('{z}',z).replace('{x}',x).replace('{y}',y); }
function tileKey(key,z,x,y){ return key+'/'+z+'/'+x+'/'+y; }

// ═══════════════════════════════════════════
//  カスタムキャッシュレイヤー（既存・変更なし）
// ═══════════════════════════════════════════
// ── オフライン低解像度フォールバック ON/OFF ──────────


/**
 * フォールバック用：2段下のズームからキャッシュを探して引き延ばし表示。
 * z-1 → z-2 の順に試し、見つかれば引き延ばしてdoneを呼ぶ。
 */
// ═══════════════════════════════════════════
//  オフラインフォールバック用: 最大キャッシュズーム管理
// ═══════════════════════════════════════════
const LAYERS_ALL = ['std','photo','topo','hill','relief'];

/** localStorageからレイヤーごとの最大キャッシュズームを読む */
function getMaxCachedZoom(sk){
  const v = parseInt(localStorage.getItem('cachedMaxZoom_' + sk));
  return isNaN(v) ? null : v;
}

/** 全セッションを走査してレイヤーごとの最大zmaxをlocalStorageに書き込む */
async function updateMaxCachedZooms(){
  const sessions = await dbGetAllSess();
  LAYERS_ALL.forEach(lk => {
    const max = sessions
      .filter(s => (s.srcKeys||[]).includes(lk))
      .reduce((m, s) => Math.max(m, s.zmax||0), 0);
    if(max > 0) localStorage.setItem('cachedMaxZoom_' + lk, max);
    else        localStorage.removeItem('cachedMaxZoom_' + lk);
  });
}


// トースト連発防止タイマー
let _offlineToastTimer = null;
let _offlineToastDelay = null;
function _showOfflineToast(){
  if(_offlineToastTimer || _offlineToastDelay) return;
  _offlineToastDelay = setTimeout(()=>{
    _offlineToastDelay = null;
    if(typeof showToast === 'function') showToast('⚠ DLされていない範囲が含まれています', 2500);
    _offlineToastTimer = setTimeout(()=>{ _offlineToastTimer = null; }, 4000);
  }, 1000);
}

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

      // ── オンライン優先：ネット取得を試み失敗したらキャッシュにフォールバック ──
      const type=this._sk==='photo'?'image/jpeg':'image/png';
      const ctrl=new AbortController();
      const tid=setTimeout(()=>ctrl.abort(), 5000);
      fetch(net,{signal:ctrl.signal})
        .then(r=>{ clearTimeout(tid); if(!r.ok) throw new Error('http '+r.status); return r.arrayBuffer(); })
        .then(buf=>{
          img.src=URL.createObjectURL(new Blob([buf],{type}));
          img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
        })
        .catch(async ()=>{
          // ネット失敗 → キャッシュ確認
          const cached = await dbGet(key).catch(()=>null);
          if(cached){
            img.src=URL.createObjectURL(new Blob([cached],{type}));
            img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
          } else {
            _showOfflineToast();
            img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
          }
        });
      return img;
    }
  });
}

// ═══════════════════════════════════════════
//  セッション管理ユーティリティ
// ═══════════════════════════════════════════

/**
 * mode==='base' のセッションからDL済みレイヤーのSetを返す。
 * @returns {Promise<Set<string>>}  例: Set{'std','photo'}
 */
async function getBaseDlDoneLayers(){
  const sessions = await dbGetAllSess();
  const done = new Set();
  sessions.forEach(s => {
    if(s.mode === 'base'){
      (s.srcKeys || []).forEach(lk => done.add(lk));
    }
  });
  return done;
}

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
    mode:          opts.mode          || "detail", // "base" | "detail"
  };
  // detailモードのみ layerStatus を記録（base は別管理）
  if(sess.mode === 'detail'){
    const zmin = sess.zmin || 11;
    const zmax = sess.zmax || 15;
    sess.layerStatus = {};
    (sess.srcKeys || []).forEach(lk => {
      sess.layerStatus[lk] = { zmin, zmax };
    });
  }
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
    `🗑 「${label}」(約${mb}MB) を削除しますか？\nこの操作は取り消せません。`,
    '削除', 'キャンセル'
  );
  if(!ok) return;

  // ── 削除ボタンをプログレスバーに差し替え ──
  const card = document.getElementById('sc-' + id);
  const btns = card ? card.querySelector('.sess-btns') : null;
  if(btns){
    btns.innerHTML = `
      <div class="sess-del-prog" id="sdp-${id}">
        <div class="sess-del-prog-label" id="sdp-lbl-${id}">削除中…</div>
        <div class="sess-del-prog-bar-bg">
          <div class="sess-del-prog-bar" id="sdp-bar-${id}" style="width:0%"></div>
        </div>
      </div>`;
  }

  // ── ベースDLセクション内の🗑ボタンにもプログレスを表示 ──
  // sess.srcKeys からレイヤーキーを特定して base-status-{lk} 要素に挿入
  if(!card && sess.mode === 'base'){
    const lk = (sess.srcKeys || [])[0];
    const baseEl = lk ? document.getElementById('base-status-' + lk) : null;
    if(baseEl){
      baseEl.innerHTML = `
        <div class="sess-del-prog" id="sdp-${id}">
          <div class="sess-del-prog-label" id="sdp-lbl-${id}">削除中…</div>
          <div class="sess-del-prog-bar-bg">
            <div class="sess-del-prog-bar" id="sdp-bar-${id}" style="width:0%"></div>
          </div>
        </div>`;
    }
  }

  // ── 他セッションが参照しているタイルキーをSetに集める ──
  const otherSessions = await dbGetAllSess().catch(() => []);
  const sharedKeys = new Set();
  for(const s of otherSessions){
    if(s.id === id) continue; // 削除対象自身はスキップ
    if(Array.isArray(s.tileKeys)){
      for(const k of s.tileKeys) sharedKeys.add(k);
    }
  }

  // ── タイル削除（他セッションと被るキーはスキップ、100件ごとに進捗更新）──
  const keys  = Array.isArray(sess.tileKeys) ? sess.tileKeys : [];
  const total = keys.length;
  const CHUNK = 100;
  for(let i = 0; i < total; i++){
    if(!sharedKeys.has(keys[i])){
      await dbDel(keys[i]).catch(()=>{});
    }
    if((i + 1) % CHUNK === 0 || i === total - 1){
      const pct = Math.round((i + 1) / total * 100);
      const bar = document.getElementById('sdp-bar-' + id);
      const lbl = document.getElementById('sdp-lbl-' + id);
      if(bar) bar.style.width = pct + '%';
      if(lbl) lbl.textContent = `削除中… ${pct}%`;
      await new Promise(r => setTimeout(r, 0)); // UIを更新
    }
  }

  await dbDelSess(id);
  const _card = document.getElementById('sc-' + id);
  if(_card) _card.remove();
  await updateMaxCachedZooms();
  await renderSessionList();
  await refreshCache();
}

/** 全キャッシュクリア（確認ダイアログ付き） */
async function clearCacheWithConfirm(){
  const ok = await showConfirmDialog(
    `⚠️ すべてのオフラインデータを削除しますか？\n全国ベースマップ（Z5〜Z9）を含むDLセッション履歴も完全に消去されます。\nこの操作は取り消せません。`,
    '全削除', 'キャンセル'
  );
  if(!ok) return;
  await dbClr();
  const sessions = await dbGetAllSess();
  for(const s of sessions){ await dbDelSess(s.id).catch(()=>{}); }
  await updateMaxCachedZooms();
  await renderSessionList();
  await refreshCache();
}
// ═══════════════════════════════════════════
//  保存済みエリア一覧
// ═══════════════════════════════════════════

/**
 * 日本地図輪郭の簡易SVGパス（viewBox 0 0 100 120 想定）
 * 本州・九州・四国・北海道を大まかに表現
 */
const _JP_SVG_PATH = `
  M44,8 L47,7 L52,9 L55,12 L53,16 L49,18 L46,16 L43,12 Z
  M30,22 L35,20 L42,21 L48,24 L55,26 L62,28 L68,32 L70,38
  L67,44 L63,48 L58,52 L52,55 L46,57 L40,55 L35,50 L30,45
  L26,38 L25,32 L27,26 Z
  M22,58 L28,56 L33,58 L35,63 L32,67 L27,68 L22,65 L21,61 Z
  M58,56 L64,54 L70,56 L74,61 L72,67 L66,70 L60,68 L57,63 Z
  M36,70 L44,68 L52,70 L58,74 L60,80 L56,85 L48,87 L40,85
  L34,80 L33,74 Z
`;

/**
 * bounds → SVG viewBox(0,0,100,120) 上の座標に変換
 * 日本の緯度経度範囲: lat 24〜46, lng 122〜146
 */
function _boundsToSvgRect(bounds){
  if(!bounds) return null;
  const LAT_MIN=24, LAT_MAX=46, LNG_MIN=122, LNG_MAX=146;
  const W=100, H=120;
  const n = bounds.north ?? bounds._northEast?.lat ?? bounds[1]?.[0];
  const s = bounds.south ?? bounds._southWest?.lat ?? bounds[0]?.[0];
  const e = bounds.east  ?? bounds._northEast?.lng ?? bounds[1]?.[1];
  const w = bounds.west  ?? bounds._southWest?.lng ?? bounds[0]?.[1];
  if(n==null||s==null||e==null||w==null) return null;
  const x1 = (w - LNG_MIN) / (LNG_MAX - LNG_MIN) * W;
  const x2 = (e - LNG_MIN) / (LNG_MAX - LNG_MIN) * W;
  const y1 = (1 - (n - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H;
  const y2 = (1 - (s - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H;
  return {
    x: Math.max(0, x1),
    y: Math.max(0, y1),
    w: Math.min(W, x2) - Math.max(0, x1),
    h: Math.min(H, y2) - Math.max(0, y1),
  };
}

/** center座標 → SVG上の点 */
function _centerToSvgXY(center){
  const LAT_MIN=24, LAT_MAX=46, LNG_MIN=122, LNG_MAX=146;
  const W=100, H=120;
  const lat = Array.isArray(center) ? center[0] : center.lat;
  const lng = Array.isArray(center) ? center[1] : center.lng;
  return {
    x: (lng - LNG_MIN) / (LNG_MAX - LNG_MIN) * W,
    y: (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H,
  };
}

/** セッション1件分のSVGサムネイルを生成して返す */
function _buildSessThumbSvg(sess){
  const rect = _boundsToSvgRect(sess.bounds);
  const pt   = _centerToSvgXY(sess.center || [35,136]);

  // boundsがある場合：矩形（circleは楕円で表現）
  let shapeEl = '';
  if(rect && rect.w > 0 && rect.h > 0){
    if(sess.mode === 'circle'){
      const cx = rect.x + rect.w/2;
      const cy = rect.y + rect.h/2;
      const rx = rect.w/2;
      const ry = rect.h/2;
      shapeEl = `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"
        rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"
        fill="rgba(200,168,75,0.35)" stroke="#c8a84b" stroke-width="1.5"/>`;
    } else {
      shapeEl = `<rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}"
        width="${rect.w.toFixed(1)}" height="${rect.h.toFixed(1)}"
        fill="rgba(200,168,75,0.30)" stroke="#c8a84b" stroke-width="1.5"/>`;
    }
  } else {
    // boundsがない場合はcenter点のみ
    shapeEl = `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}"
      r="4" fill="#c8a84b" opacity="0.8"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"
    width="64" height="64" style="display:block;">
    <!-- 海背景 -->
    <rect width="100" height="120" fill="rgba(10,30,60,0.9)"/>
    <!-- 日本本土（簡易輪郭） -->
    <path d="${_JP_SVG_PATH}" fill="rgba(60,80,60,0.7)" stroke="rgba(120,160,120,0.5)" stroke-width="0.8"/>
    <!-- エリア強調 -->
    ${shapeEl}
  </svg>`;
}

/** セッションのlabelをIDBに保存 */
async function _renameSession(id, newLabel){
  try {
    const sess = await dbGetSess(id);
    if(!sess) return;
    sess.label = newLabel.trim() || '名称未設定';
    await dbPutSess(id, sess);
  } catch(e){ console.warn('renameSession error', e); }
}

/** 保存済みエリア一覧を描画（detail / circle モードのみ） */
async function renderSessionList(){
  const el = document.getElementById('session-list');
  if(!el) return;

  let sessions;
  try { sessions = await dbGetAllSess(); }
  catch(e){ el.innerHTML = '<div class="sess-empty">読み込みエラー</div>'; return; }

  // base除外・新しい順ソート
  const list = sessions
    .filter(s => s.mode !== 'base')
    .sort((a,b) => (b.lastUsed||0) - (a.lastUsed||0));

  if(list.length === 0){
    el.innerHTML = '<div class="sess-empty">DL済みのエリアはありません</div>';
    return;
  }

  el.innerHTML = '';
  for(const sess of list){
    const id      = sess.id;
    const label   = sess.label || '名称未設定';
    const mb      = ((sess.totalSize||0)/1024/1024).toFixed(1);
    const dateStr = sess.lastUsed
      ? new Date(sess.lastUsed).toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'})
      : '—';
    const thumbSvg = _buildSessThumbSvg(sess);

    const card = document.createElement('div');
    card.className = 'sess-card';
    card.id = 'sc-' + id;
    card.innerHTML = `
      <!-- サムネイル（タップで地図移動） -->
      <div class="sess-thumb-svg" onclick="_sessGoto('${id}')">${thumbSvg}</div>

      <!-- 情報エリア -->
      <div class="sess-info">
        <div class="sess-label-row">
          <span class="sess-label" id="sl-${id}">${label}</span>
          <button class="sess-rename-btn" onclick="_sessRenameStart('${id}')" title="リネーム">✏️</button>
        </div>
        <div class="sess-meta">
          最終使用: ${dateStr}<br>
          ${mb} MB
        </div>
      </div>

      <!-- アクションボタン -->
      <div class="sess-btns">
        <button class="sess-move-btn"   onclick="_sessGoto('${id}')"   title="地図移動">📍</button>
        <button class="sess-adddl-btn"  onclick="_sessAddDl('${id}')"  title="追加DL">📥</button>
        <button class="sess-del-btn"    onclick="deleteSessionWithConfirm('${id}')" title="削除">🗑</button>
      </div>
    `;
    el.appendChild(card);
  }
}

/** 地図移動（lastUsed更新 + flyToBounds or flyTo） */
async function _sessGoto(id){
  await touchSession(id);
  const sess = await dbGetSess(id).catch(()=>null);
  if(!sess) return;
  if(typeof map === 'undefined') return;
  if(sess.bounds){
    const b = sess.bounds;
    const sw = [b.south ?? b._southWest?.lat, b.west  ?? b._southWest?.lng];
    const ne = [b.north ?? b._northEast?.lat, b.east  ?? b._northEast?.lng];
    if(sw[0]!=null && ne[0]!=null){
      map.flyToBounds([sw, ne], {padding:[20,20], maxZoom: sess.zoom||15});
      return;
    }
  }
  // boundsがなければcenterにflyTo
  const c = sess.center || [35,136];
  map.flyTo(Array.isArray(c)?c:[c.lat,c.lng], sess.zoom||14);
}

/** インラインリネーム開始 */
function _sessRenameStart(id){
  const labelEl = document.getElementById('sl-' + id);
  if(!labelEl) return;
  const current = labelEl.textContent;
  const row = labelEl.parentElement; // .sess-label-row

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sess-label-input';
  input.value = current === '名称未設定' ? '' : current;
  input.placeholder = '名称未設定';
  input.maxLength = 30;

  row.replaceChild(input, labelEl);
  // ✏️ボタンを一時非表示
  const renameBtn = row.querySelector('.sess-rename-btn');
  if(renameBtn) renameBtn.style.display = 'none';
  input.focus();
  input.select();

  const commit = async () => {
    const newLabel = input.value.trim() || '名称未設定';
    await _renameSession(id, newLabel);
    // labelElを復元
    labelEl.textContent = newLabel;
    row.replaceChild(labelEl, input);
    if(renameBtn) renameBtn.style.display = '';
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter')  { input.blur(); }
    if(e.key === 'Escape') {
      row.replaceChild(labelEl, input);
      if(renameBtn) renameBtn.style.display = '';
    }
  });
}

/** 追加DL：カード内に追加DLパネルをインライン展開 */
async function _sessAddDl(id){
  const btn = document.querySelector(`#sc-${id} .sess-adddl-btn`);
  const card = document.getElementById('sc-' + id);
  if(!card) return;

  // 既に展開済みなら閉じる（トグル）
  const existing = document.getElementById('sess-adp-' + id);
  if(existing){ existing.remove(); if(btn) btn.textContent = '📥'; return; }

  const sess = await dbGetSess(id).catch(()=>null);
  if(!sess || !sess.bounds){
    if(typeof showToast === 'function') showToast('⚠ 範囲情報がありません', 2000);
    return;
  }

  // コンテナ生成してカードの直下に挿入
  const container = document.createElement('div');
  container.id = 'sess-adp-' + id;
  container.style.cssText = 'margin-top:8px;';
  card.after(container);

  if(btn) btn.textContent = '✕';

  if(typeof _dldRenderAddLayerPanel === 'function'){
    await _dldRenderAddLayerPanel(id, sess, container);
  } else {
    container.innerHTML = '<div style="font-size:12px;color:var(--txt-sub);padding:8px;">追加DL機能を読み込めません</div>';
  }
}