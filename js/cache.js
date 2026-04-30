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
    label:     opts.label     || '名称未設定',
    center:    opts.center    || [35.0, 136.0],
    zoom:      opts.zoom      || 14,
    createdAt: Date.now(),
    lastUsed:  Date.now(),
    tileKeys:  opts.tileKeys  || [],
    totalSize: opts.totalSize || 0,
    srcKeys:   opts.srcKeys   || [],
    bounds:    opts.bounds    || null,
    zmin:      opts.zmin      || 11,
    zmax:      opts.zmax      || 15,
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
        ${addDlBtn}
        <button class="sess-del-btn" onclick="deleteSessionWithConfirm('${s.id}')">🗑</button>
      </div>
    </div>
    <div class="sess-adddl-panel" id="adp-${s.id}" style="display:none">
      <div class="adp-title">追加ダウンロード — レイヤー選択</div>
      <div class="adp-layers">
        ${ALL_LAYERS.map(lk=>{
          const done = (s.srcKeys||[]).includes(lk);
          return `<label class="adp-layer${done?' adp-layer--done':''}">
            <input type="checkbox" class="adp-ck" data-sess="${s.id}" data-lk="${lk}"
              ${done?'disabled checked':''} onchange="updAddLayerEst('${s.id}')">
            <span class="adp-lk-name">${LAYER_LABEL[lk]}</span>
            <span class="adp-lk-badge">${done?'✅ 済':'未'}</span>
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

/** セッション中心にジャンプしlastUsedを更新 */
async function jumpToSession(id){
  const sess = await dbGetSess(id).catch(()=>null);
  if(!sess||!sess.center) return;
  if(typeof map !== 'undefined'){
    map.setView(sess.center, sess.zoom||14);
    if(typeof switchTab==='function') switchTab('map');
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
function openAddLayerPanel(sessId){
  document.querySelectorAll('.sess-adddl-panel').forEach(p=>p.style.display='none');
  const panel = document.getElementById('adp-'+sessId);
  if(panel) panel.style.display='block';
  updAddLayerEst(sessId);
}

function closeAddLayerPanel(sessId){
  const panel = document.getElementById('adp-'+sessId);
  if(panel) panel.style.display='none';
}

async function updAddLayerEst(sessId){
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess||!sess.bounds) return;
  const selected = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el=>el.dataset.lk);
  const estEl = document.getElementById('adp-est-'+sessId);
  const btn   = document.getElementById('adp-btn-'+sessId);
  if(!selected.length){
    if(estEl) estEl.textContent = 'レイヤーを選択してください';
    if(btn)   btn.disabled = true;
    return;
  }
  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);
  const tiles  = (typeof cntTiles==='function') ? cntTiles(bounds, sess.zmin||11, sess.zmax||15) : 0;
  const mb     = (typeof mbEstLayers==='function') ? mbEstLayers(tiles, selected) : '—';
  const overLimit = (typeof estBytesLayers==='function')
    ? estBytesLayers(tiles, selected) > DL_SESSION_MAX : false;
  if(estEl){
    estEl.textContent = `約 ${mb} MB（${selected.length}レイヤー）`;
    estEl.style.color = overLimit ? 'var(--red,#ff6b6b)' : '';
  }
  if(btn) btn.disabled = overLimit;
  if(overLimit && estEl){
    estEl.textContent += ' — 100MB超過：ズームを下げてください';
  }
}

async function startAddLayerDl(sessId){
  const sess = await dbGetSess(sessId).catch(()=>null);
  if(!sess||!sess.bounds){ showAlert('エラー','範囲情報がありません'); return; }
  const selected = [...document.querySelectorAll(`.adp-ck[data-sess="${sessId}"]:not(:disabled):checked`)]
    .map(el=>el.dataset.lk);
  if(!selected.length){ showAlert('エラー','レイヤーを選択してください'); return; }

  closeAddLayerPanel(sessId);
  const b = sess.bounds;
  const bounds = L.latLngBounds([[b.s,b.w],[b.n,b.e]]);

  // runDlを呼び出してDL（完了後にセッション更新）
  if(typeof runDl !== 'function'){ showAlert('エラー','DL機能が読み込まれていません'); return; }
  const origSave = window.saveDlSession;
  // 一時的にsaveDlSessionをフック → addLayersToSessionに差し替え
  window.saveDlSession = async (opts)=>{
    window.saveDlSession = origSave;
    if(typeof addLayersToSession==='function'){
      await addLayersToSession(sessId, selected, opts.tileKeys||[], opts.totalSize||0);
    }
    await refreshCache();
  };
  await runDl('detail', bounds, sess.zmin||11, sess.zmax||15, selected, 0);
  // フックが未発火の場合（done=0）も元に戻す
  window.saveDlSession = origSave;
  await refreshCache();
}
