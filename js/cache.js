'use strict';

// ═══════════════════════════════════════════
//  定数
// ═══════════════════════════════════════════
const CACHE_MAX_DEFAULT  = 500 * 1024 * 1024;  // 500MB
const CACHE_MAX_HARD     = 2048 * 1024 * 1024; // 2GB（スライダー上限）
const DL_SESSION_MAX     = 200 * 1024 * 1024;  // 1回DL上限 200MB（固定）
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
  std:        {url:'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',                        ext:'png',  attr:'地理院タイル',           maxNative:18},
  photo:      {url:'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',              ext:'jpg',  attr:'地理院写真',             maxNative:18},
  topo:       {url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',                                    ext:'png',  attr:'OpenTopoMap',           maxNative:17},
  pale:       {url:'https://maps.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png',                               ext:'png',  attr:'地理院白地図',           maxNative:14, autoCache:true},
  hill:       {url:'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png',               ext:'png',  attr:'地理院陰影',             maxNative:16},
  relief:     {url:'https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png',                     ext:'png',  attr:'地理院色別標高',         maxNative:15},
  // ── 自動蓄積専用レイヤー（DL機能なし・閲覧時にステルスキャッシュ）──
  geo:        {url:'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png',                 ext:'png',  attr:'産総研シームレス地質図', maxNative:13, autoCache:true},
  chisui:     {url:'https://cyberjapandata.gsi.go.jp/xyz/lcmfc2/{z}/{x}/{y}.png',                    ext:'png',  attr:'地理院治水地形分類図',   maxNative:16, autoCache:true},
  geo50k_1:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K01/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_2:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K02/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_3:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K03/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_4:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K04/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_5:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K05/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_6:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K06/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
  geo50k_7:   {url:'https://tiles.gsj.jp/tiles/geomap/MR_500K07/{z}/{x}/{y}.webp',                   ext:'webp', attr:'産総研鉱物資源図',       maxNative:12, directImg:true},
};
function tileURL(key,z,x,y){
  return SRCS[key].url.replace('{z}',z).replace('{x}',x).replace('{y}',y);
}
function tileKey(key,z,x,y){ return key+'/'+z+'/'+x+'/'+y; }

// ── キャッシュサイズ メモリキャッシュ（地図操作中は走査しない）──
let _cachedSize   = 0;  // 最後に計測したサイズ（バイト）
let _cachedSizeAt = 0;  // 計測時刻（0=未計測）

/** tilesストアをカーソル走査して正確なサイズを返しメモリキャッシュを更新 */
async function calcTotalCacheSizeReal(){
  return new Promise((res) => {
    if(!db){ res(_cachedSize); return; }
    const tx  = db.transaction(ST, 'readonly');
    const req = tx.objectStore(ST).openCursor();
    let total = 0;
    req.onsuccess = e => {
      const cursor = e.target.result;
      if(cursor){ total += cursor.value?.byteLength || 0; cursor.continue(); }
      else       { _cachedSize = total; _cachedSizeAt = Date.now(); res(total); }
    };
    req.onerror = () => res(_cachedSize);
  });
}

/** 通常呼び出し用：メモリキャッシュを返すだけ（走査しない）*/
async function calcTotalCacheSize(){
  return _cachedSize;
}

// ── タブ離脱時にバックグラウンド集計 ──
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){
    calcTotalCacheSizeReal().catch(()=>{});
  }
});

// ── 自動蓄積：80%未満のときのみ書き込み（メモリキャッシュ値で判定）──
async function _autoCachePut(key, buf){
  try {
    const cacheMax = getCacheMax();
    if(_cachedSize / cacheMax >= CACHE_MAX_WARN_RATIO) return; // 80%超えはスキップ
    await dbPut(key, buf);
    _cachedSize += buf.byteLength || 0; // 書き込んだ分だけ加算
  } catch(e){}
}

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

/** 全セッションを走査してレイヤーごとの最大zmaxをlocalStorageに書き込む（baseモードのみ対象） */
async function updateMaxCachedZooms(){
  const sessions = await dbGetAllSess();
  LAYERS_ALL.forEach(lk => {
    const max = sessions
      .filter(s => s.mode === 'base' && (s.srcKeys||[]).includes(lk))
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
let _onlineToastTimer = null;
let _onlineToastDelay = null;
function _showOnlineToast(){
  if(_onlineToastTimer || _onlineToastDelay) return;
  _onlineToastDelay = setTimeout(()=>{
    _onlineToastDelay = null;
    if(typeof showToast === 'function') showToast('⚠ 通信状態を確認してください', 2500);
    _onlineToastTimer = setTimeout(()=>{ _onlineToastTimer = null; }, 4000);
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
      const ext = (SRCS[this._sk] && SRCS[this._sk].ext) || 'png';
      const type = ext==='jpg' ? 'image/jpeg' : ext==='webp' ? 'image/webp' : 'image/png';
      const isOnline = navigator.onLine;
      const tileTimeout = isOnline ? 8000 : 3000;
      const ctrl=new AbortController();
      const tid=setTimeout(()=>ctrl.abort(), tileTimeout);
      fetch(net,{signal:ctrl.signal})
        .then(r=>{ clearTimeout(tid); if(!r.ok) throw new Error('http '+r.status); return r.arrayBuffer(); })
        .then(buf=>{
          img.src=URL.createObjectURL(new Blob([buf],{type}));
          img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
          // ── 自動蓄積：autoCache指定レイヤーはDBにステルス保存 ──
          if(SRCS[this._sk] && SRCS[this._sk].autoCache){
            _autoCachePut(key, buf);
          }
        })
        .catch(async ()=>{
          // ネット失敗 → キャッシュ確認
          const cached = await dbGet(key).catch(()=>null);
          if(cached){
            img.src=URL.createObjectURL(new Blob([cached],{type}));
            img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
          } else {
            if(SRCS[this._sk]?.directImg){
              // directImgレイヤーはCORSなし直接読み込み（トースト不要）
              img.crossOrigin = '';
              img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
            } else {
              if(isOnline){ _showOnlineToast(); } else { _showOfflineToast(); }
              img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
            }
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



/**
 * キャッシュ使用量を確認し、上限に近づいていたらトーストで警告する。
 * 自動削除は行わない。削除はユーザーが手動で行う。
 */
async function checkCacheWarn(){
  try {
    const cacheMax = getCacheMax();
    const total    = await calcTotalCacheSize();
    const ratio    = total / cacheMax;
    if(ratio >= 1.0){
      if(typeof showToast === 'function')
        showToast('⚠️ キャッシュが上限に達しています。不要なセッションを削除してください。', 4000);
    } else if(ratio >= CACHE_MAX_WARN_RATIO){
      const pct = Math.round(ratio * 100);
      if(typeof showToast === 'function')
        showToast(`💾 キャッシュ使用量が ${pct}% です。空き容量にご注意ください。`, 3000);
    }
  } catch(e){}
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
  deleteBaseDlProgress();
  if(typeof refreshBaseDlStatus === 'function') refreshBaseDlStatus();
}
// SVGサムネイル・リネーム関連は offline.js に集約

// ═══════════════════════════════════════════
//  DB初期化（起動時に必ず一度実行）
//  ここで開いておかないと dbGet/dbPut 系が全滅する
// ═══════════════════════════════════════════
openDB().catch(e => console.warn('[cache] DB初期化失敗', e));