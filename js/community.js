'use strict';
// ═══════════════════════════════════════════
//  COMMUNITY  掲示板・金相場
//  Firestore版: 手動更新・差分取得・バッチ削除
//  v2: 通報・自分投稿削除・更新クールダウン
// ═══════════════════════════════════════════

const COMM_MAX_CHARS     = 200;
const COMM_REPORT_LIMIT  = 3;
const COMM_RATE_MS       = 60000;
const COMM_REFRESH_COOL  = 180000;

const COMM_NATIONAL_DISPLAY  = 50;
const COMM_NATIONAL_TRIGGER  = 100;
const COMM_PREF_DISPLAY      = 10;
const COMM_PREF_TRIGGER      = 100;

const SK_NICKNAME     = 'comm_nickname';
const SK_LAST_POST    = 'comm_last_post';
const SK_LAST_REFRESH = 'comm_last_refresh';
const SK_REACTIONS    = 'comm_reactions';
const SK_SCOPE        = 'comm_scope';
const SK_PREF         = 'comm_pref';
const SK_REGION       = 'comm_region';
const SK_GOLD         = 'comm_gold_cache';
const SK_CACHE_NAT    = 'comm_cache_national';
const SK_CACHE_PREF   = 'comm_cache_pref_';

const REGION_MAP = {
  '北海道': ['北海道'],
  '東北':   ['青森県','岩手県','宮城県','秋田県','山形県','福島県'],
  '関東':   ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'],
  '中部':   ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県'],
  '近畿':   ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'],
  '中国':   ['鳥取県','島根県','岡山県','広島県','山口県'],
  '四国':   ['徳島県','香川県','愛媛県','高知県'],
  '九州・沖縄': ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'],
};

let _commScope   = localStorage.getItem(SK_SCOPE)  || 'national';
let _commRegion  = localStorage.getItem(SK_REGION) || '北海道';
let _commPref    = localStorage.getItem(SK_PREF)   || '';
let _commInited  = false;
let _commLoading = false;
let _refreshCoolTimer = null;

function _db(){ return firebase.firestore(); }

// ── キャッシュ ──────────────────────────────
function _loadCache(scope, pref){
  const key = scope === 'national' ? SK_CACHE_NAT : SK_CACHE_PREF + pref;
  try{ return JSON.parse(localStorage.getItem(key)) || []; }
  catch(e){ return []; }
}
function _saveCache(scope, pref, posts){
  const key = scope === 'national' ? SK_CACHE_NAT : SK_CACHE_PREF + pref;
  try{ localStorage.setItem(key, JSON.stringify(posts)); }
  catch(e){ console.warn('[comm] cache save failed', e); }
}
function _getLatestTs(posts){
  if(!posts.length) return 0;
  return Math.max(...posts.map(p => p.ts || 0));
}
function _loadReactions(){
  try{ return JSON.parse(localStorage.getItem(SK_REACTIONS)) || {}; }
  catch(e){ return {}; }
}
function _saveReactions(r){ localStorage.setItem(SK_REACTIONS, JSON.stringify(r)); }

// ── 初期化 ──────────────────────────────────
function initCommunity(){
  if(_commInited) return;
  _commInited = true;
  _renderScopeTab();
  _renderRegionSelector();
  _loadNickname();
  _updateCharCount();
  _initGoldDisplay();
  _renderPostsFromCache();
  _initRefreshCooldown();
}

// ── スコープ・地方・都道府県 ─────────────────
function _renderScopeTab(){
  document.getElementById('comm-tab-national').classList.toggle('active', _commScope==='national');
  document.getElementById('comm-tab-regional').classList.toggle('active', _commScope==='regional');
  document.getElementById('comm-regional-selector').style.display = _commScope==='regional' ? 'block' : 'none';
  _renderPostsFromCache();
}
function commSwitchScope(scope){
  _commScope = scope;
  localStorage.setItem(SK_SCOPE, scope);
  _renderScopeTab();
}
function _renderRegionSelector(){
  const regionSel = document.getElementById('comm-region-sel');
  regionSel.innerHTML = '';
  Object.keys(REGION_MAP).forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    if(r === _commRegion) opt.selected = true;
    regionSel.appendChild(opt);
  });
  _updatePrefSelector();
}
function _updatePrefSelector(){
  const prefSel = document.getElementById('comm-pref-sel');
  const prefs = REGION_MAP[_commRegion] || [];
  prefSel.innerHTML = '';
  prefs.forEach(p=>{
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    if(p === _commPref) opt.selected = true;
    prefSel.appendChild(opt);
  });
  if(!prefs.includes(_commPref)){
    _commPref = prefs[0] || '';
    localStorage.setItem(SK_PREF, _commPref);
    if(prefSel.options[0]) prefSel.options[0].selected = true;
  }
  _renderPostsFromCache();
}
function commOnRegionChange(val){ _commRegion=val; localStorage.setItem(SK_REGION,val); _updatePrefSelector(); }
function commOnPrefChange(val){   _commPref=val;   localStorage.setItem(SK_PREF,val);   _renderPostsFromCache(); }

// ── 更新クールダウン（3分） ──────────────────
function _initRefreshCooldown(){
  const last = parseInt(localStorage.getItem(SK_LAST_REFRESH) || '0');
  const remaining = COMM_REFRESH_COOL - (Date.now() - last);
  if(remaining > 0) _startRefreshCooldown(remaining);
}
function _startRefreshCooldown(ms){
  const btn = document.getElementById('comm-refresh-btn');
  if(!btn) return;
  btn.disabled = true;
  clearInterval(_refreshCoolTimer);
  let remaining = Math.ceil(ms / 1000);
  btn.textContent = `🔄 更新（${remaining}秒）`;
  _refreshCoolTimer = setInterval(()=>{
    remaining--;
    if(remaining <= 0){
      clearInterval(_refreshCoolTimer);
      btn.disabled = false;
      btn.textContent = '🔄 更新';
    } else {
      btn.textContent = `🔄 更新（${remaining}秒）`;
    }
  }, 1000);
}

// ── Firestore取得（手動更新） ─────────────────
async function commRefresh(){
  if(_commLoading) return;
  const lastRefresh = parseInt(localStorage.getItem(SK_LAST_REFRESH) || '0');
  const elapsed = Date.now() - lastRefresh;
  if(elapsed < COMM_REFRESH_COOL){
    const remaining = Math.ceil((COMM_REFRESH_COOL - elapsed) / 1000);
    _commToast(`更新は3分に1回です（あと${remaining}秒）`);
    return;
  }
  _commLoading = true;
  const btn = document.getElementById('comm-refresh-btn');
  if(btn){ btn.disabled = true; btn.textContent = '取得中…'; }
  try{
    const scope    = _commScope;
    const pref     = _commPref;
    const cached   = _loadCache(scope, pref);
    const latestTs = _getLatestTs(cached);
    const limit    = scope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
    // ── クエリ構築 ──────────────────────────────────
    // Firestoreの複合インデックス要件：
    //   national: (scope ASC, ts DESC)
    //   pref    : (scope ASC, pref ASC, ts DESC)
    // 差分取得時は where('ts','>') を追加するが、
    // orderBy('ts') は必ず最後に置き単一フィールドで完結させる。
    const fsScope = scope === 'national' ? 'national' : 'pref';
    let q = _db().collection('posts').where('scope', '==', fsScope);
    if(scope === 'regional') q = q.where('pref', '==', pref);
    // 差分取得：キャッシュがある場合のみ ts フィルターを追加
    // ※ latestTs-1ms で境界値漏れを防ぐ
    if(latestTs > 0){
      q = q.orderBy('ts', 'desc').where('ts', '>', new Date(latestTs - 1)).limit(limit);
    } else {
      q = q.orderBy('ts', 'desc').limit(limit);
    }
    const snap = await q.get();
    const newPosts = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      ts: d.data().ts?.toMillis?.() ?? d.data().ts
    }));
    if(newPosts.length === 0){
      _commToast('最新の状態です');
    } else {
      const merged = _mergePosts(cached, newPosts, limit);
      _saveCache(scope, pref, merged);
      _commToast(`${newPosts.length}件の新着を取得しました`);
    }
    _renderPostsFromCache();
    localStorage.setItem(SK_LAST_REFRESH, Date.now().toString());
    _startRefreshCooldown(COMM_REFRESH_COOL);
  } catch(e){
    console.error('[comm] refresh failed', e);
    if(e?.code === 'resource-exhausted' || e?.message?.includes('RESOURCE_EXHAUSTED')){
      _commToast('⚠️ アクセスが集中しています。しばらくお待ちください。');
    } else {
      _commToast('取得に失敗しました。通信を確認してください。');
    }
    if(btn){ btn.disabled = false; btn.textContent = '🔄 更新'; }
  } finally {
    _commLoading = false;
  }
}
function _mergePosts(cached, newPosts, limit){
  const map = {};
  [...cached, ...newPosts].forEach(p => { map[p.id] = p; });
  return Object.values(map).sort((a,b) => (b.ts||0)-(a.ts||0)).slice(0, limit);
}

// ── 投稿一覧レンダリング ─────────────────────
function _renderPostsFromCache(){
  const container = document.getElementById('comm-post-list');
  if(!container) return;
  const posts     = _loadCache(_commScope, _commPref);
  const reactions = _loadReactions();
  const uid       = firebase.auth().currentUser?.uid || null;
  if(posts.length === 0){
    container.innerHTML = '<div class="comm-empty">まだ投稿がありません。「🔄 更新」で読み込むか、最初の一言をどうぞ！</div>';
    return;
  }
  container.innerHTML = posts.map(p=>{
    const r = reactions[p.id] || {};
    if((p.report||0) >= COMM_REPORT_LIMIT){
      return `<div class="comm-post comm-post-hidden"><span>⚠️ 複数の通報により非表示</span></div>`;
    }
    const likeActive   = r.like   ? ' active' : '';
    const reportActive = r.report ? ' active' : '';
    const timeStr      = _formatTime(p.ts);
    const isOwn        = uid && p.uid === uid;
    const deleteBtn    = isOwn
      ? `<button class="comm-delete-btn" onclick="commDeletePost('${p.id}')" title="削除">🗑</button>`
      : '';
    return `<div class="comm-post" data-id="${p.id}">
  <div class="comm-post-header">
    <span class="comm-nick">${_escHtml(p.nick)}</span>
    <span class="comm-time">${timeStr}</span>
    ${deleteBtn}
  </div>
  <div class="comm-post-body">${_escHtml(p.text)}</div>
  <div class="comm-post-footer">
    <button class="comm-react-btn like${likeActive}" onclick="commReact('${p.id}','like')">
      👍 <span id="comm-like-${p.id}">${p.like||0}</span>
    </button>
    <button class="comm-react-btn report${reportActive}" onclick="commReport('${p.id}')" title="既定回数の通報で非表示になります">
      ⚠️ 通報<span class="comm-report-note">（既定回数で非表示）</span>
    </button>
  </div>
</div>`;
  }).join('');
}

// ── 投稿送信 ─────────────────────────────────
async function commSubmit(){
  const nickEl = document.getElementById('comm-nick-input');
  const textEl = document.getElementById('comm-text-input');
  const nick = (nickEl.value.trim() || '匿名さん').slice(0,20);
  const text = textEl.value.trim();
  if(!text){ _commToast('本文を入力してください'); return; }
  if(text.length > COMM_MAX_CHARS){ _commToast(`${COMM_MAX_CHARS}文字以内で入力してください`); return; }
  const lastPost = parseInt(localStorage.getItem(SK_LAST_POST)||'0');
  const now = Date.now();
  if(now - lastPost < COMM_RATE_MS){
    const sec = Math.ceil((COMM_RATE_MS-(now-lastPost))/1000);
    _commToast(`投稿は1分間に1回までです（あと${sec}秒）`); return;
  }
  const user = firebase.auth().currentUser;
  if(!user){ _commToast('投稿にはログインが必要です'); return; }
  if(nickEl.value.trim()) localStorage.setItem(SK_NICKNAME, nickEl.value.trim());
  const submitBtn = document.querySelector('.comm-submit-btn');
  if(submitBtn) submitBtn.disabled = true;
  try{
    const fsScope = _commScope === 'national' ? 'national' : 'pref';
    const postData = {
      scope: fsScope, nick, text,
      ts:    firebase.firestore.FieldValue.serverTimestamp(),
      like:  0, report: 0, uid: user.uid,
    };
    if(fsScope === 'pref') postData.pref = _commPref;
    const ref = await _db().collection('posts').add(postData);
    const localPost = { ...postData, id: ref.id, ts: now };
    const limit  = _commScope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
    const cached = _loadCache(_commScope, _commPref);
    _saveCache(_commScope, _commPref, [localPost, ...cached].slice(0, limit));
    localStorage.setItem(SK_LAST_POST, now.toString());
    textEl.value = ''; _updateCharCount();
    _renderPostsFromCache();
    _commToast('投稿しました！');
    _checkAndBatchDelete(fsScope, fsScope === 'pref' ? _commPref : null)
      .catch(e => console.warn('[comm] batch delete failed', e));
  } catch(e){
    console.error('[comm] submit failed', e);
    _commToast('投稿に失敗しました。通信を確認してください。');
  } finally {
    if(submitBtn) submitBtn.disabled = false;
  }
}

// ── 自分の投稿削除 ───────────────────────────
async function commDeletePost(postId){
  const user = firebase.auth().currentUser;
  if(!user) return;
  if(!confirm('この投稿を削除しますか？')) return;
  try{
    await _db().collection('posts').doc(postId).delete();
    const scope  = _commScope, pref = _commPref;
    const cached = _loadCache(scope, pref).filter(p => p.id !== postId);
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    _commToast('投稿を削除しました');
  } catch(e){
    console.error('[comm] delete failed', e);
    _commToast('削除に失敗しました');
  }
}

// ── 通報 ─────────────────────────────────────
async function commReport(postId){
  const reactions = _loadReactions();
  const r = reactions[postId] || {};
  if(r.report){ _commToast('すでに通報済みです'); return; }
  if(!confirm('この投稿を通報しますか？\n通報が3件集まると非表示になります。')) return;
  r.report = true;
  reactions[postId] = r;
  _saveReactions(reactions);
  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  if(post){ post.report = (post.report||0)+1; _saveCache(scope,pref,cached); _renderPostsFromCache(); }
  try{
    await _db().collection('posts').doc(postId).update({
      report: firebase.firestore.FieldValue.increment(1)
    });
    _commToast('通報しました');
  } catch(e){
    r.report = false; reactions[postId] = r; _saveReactions(reactions);
    if(post){ post.report = Math.max(0,(post.report||1)-1); _saveCache(scope,pref,cached); _renderPostsFromCache(); }
    _commToast('通報に失敗しました');
    console.warn('[comm] report failed', e);
  }
}

// ── likeリアクション ─────────────────────────
async function commReact(postId, type){
  const reactions = _loadReactions();
  const r = reactions[postId] || {};
  const isOn = !!r[type]; const delta = isOn ? -1 : 1;
  r[type] = !isOn; reactions[postId] = r; _saveReactions(reactions);
  const scope = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post = cached.find(p => p.id === postId);
  if(post){ post[type] = Math.max(0,(post[type]||0)+delta); _saveCache(scope,pref,cached); _renderPostsFromCache(); }
  try{
    await _db().collection('posts').doc(postId).update({
      [type]: firebase.firestore.FieldValue.increment(delta)
    });
  } catch(e){
    r[type] = isOn; reactions[postId] = r; _saveReactions(reactions);
    if(post){ post[type] = Math.max(0,(post[type]||0)-delta); _saveCache(scope,pref,cached); _renderPostsFromCache(); }
    _commToast('操作に失敗しました');
    console.warn('[comm] react failed', e);
  }
}

// ── バッチ削除（通報済み優先） ───────────────
async function _checkAndBatchDelete(fsScope, pref){
  const trigger = fsScope === 'national' ? COMM_NATIONAL_TRIGGER : COMM_PREF_TRIGGER;
  const display = fsScope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
  let q = _db().collection('posts').where('scope', '==', fsScope);
  if(pref) q = q.where('pref', '==', pref);
  const snap = await q.orderBy('ts', 'asc').limit(trigger).get();
  if(snap.docs.length < trigger) return;
  const deleteCount = trigger - display;
  const all      = snap.docs;
  const reported = all.filter(d => (d.data().report||0) >= COMM_REPORT_LIMIT);
  const normal   = all.filter(d => (d.data().report||0) <  COMM_REPORT_LIMIT);
  const toDelete = [...reported, ...normal].slice(0, deleteCount);
  const batch = _db().batch();
  toDelete.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`[comm] batch deleted ${toDelete.length} posts (scope:${fsScope} pref:${pref||'-'})`);
}

// ── ニックネーム・文字数 ─────────────────────
function _loadNickname(){
  const saved = localStorage.getItem(SK_NICKNAME);
  if(saved) document.getElementById('comm-nick-input').value = saved;
}
function _updateCharCount(){
  const el = document.getElementById('comm-text-input');
  const cnt = document.getElementById('comm-char-count');
  if(!el||!cnt) return;
  const len = el.value.length;
  cnt.textContent = `${len}/${COMM_MAX_CHARS}`;
  cnt.style.color = len > COMM_MAX_CHARS ? '#ff5a47' : 'var(--txt-sub)';
}
function _buildTagSelector(){ /* タグ機能削除済み */ }

// ── 金相場 ───────────────────────────────────
async function commShowGoldPrice(){
  const btn = document.getElementById('comm-gold-btn');
  btn.disabled = true; btn.textContent = '取得中…';
  try{
    const goldRes = await fetch('https://api.gold-api.com/price/XAU');
    if(!goldRes.ok) throw new Error('gold-api ' + goldRes.status);
    const goldJson = await goldRes.json();
    const priceUsdOz = parseFloat(goldJson.price);
    if(!priceUsdOz || isNaN(priceUsdOz)) throw new Error('invalid price');
    const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if(!fxRes.ok) throw new Error('er-api ' + fxRes.status);
    const fxJson = await fxRes.json();
    const rateJpy = fxJson.rates.JPY;
    const priceJpyG = Math.round(priceUsdOz / 31.1035 * rateJpy);
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;
    const cacheData = { price_usd: priceUsdOz, rate_jpy: rateJpy, price_jpy_g: priceJpyG, date: dateStr, ts: Date.now() };
    localStorage.setItem(SK_GOLD, JSON.stringify(cacheData));
    _renderGoldDisplay(cacheData);
  } catch(e){
    _commToast('相場の取得に失敗しました。通信を確認してください。');
    console.warn('[GOLD]', e);
  }
  btn.disabled = false; btn.textContent = '💰 金相場';
}
function _renderGoldDisplay(d){
  let el = document.getElementById('comm-gold-display');
  if(!el){
    el = document.createElement('div'); el.id = 'comm-gold-display'; el.className = 'comm-gold-display';
    const row = document.getElementById('comm-gold-row');
    if(row) row.insertAdjacentElement('afterend', el);
  }
  el.innerHTML =
    `<span class="comm-gold-price">¥${d.price_jpy_g.toLocaleString()}<small>/g</small></span>` +
    `<span class="comm-gold-date">${d.date} 取得　USD/oz $${Math.round(d.price_usd).toLocaleString()}　USD/JPY ${d.rate_jpy.toFixed(1)}</span>` +
    `<span class="comm-gold-note">※参考値。実際の買取価格は業者により異なります</span>`;
}
function _initGoldDisplay(){
  try{ const c = JSON.parse(localStorage.getItem(SK_GOLD)||'null'); if(c) _renderGoldDisplay(c); }catch(e){}
}

// ── ルール折りたたみ・プレミアム ─────────────
function commToggleRule(){
  const body = document.getElementById('comm-rule-body');
  const arrow = document.getElementById('comm-rule-arrow');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arrow.textContent  = open ? '▶' : '▼';
}
function commShowPremium(){
  const body = document.getElementById('premium-gate-body');
  const title = document.getElementById('premium-gate-title');
  const icon  = document.getElementById('premium-gate-icon');
  icon.textContent = '✨'; title.textContent = 'GOLD MAP プレミアム';
  body.innerHTML =
    '<div style="text-align:left;font-size:12px;line-height:2;padding:4px 0;">' +
    '砂金採取をもっと本格的に。<br><br>' +
    '<b>🗺 高精度ヒートマップ</b><br>　全国の砂金採取確率をAI解析でマップ表示<br>' +
    '<b>🐻 熊域リアルタイム警告</b><br>　現在地周辺の熊出没エリアを地図に表示<br>' +
    '<b>📥 オフライン完全対応</b><br>　圏外エリアでも地図・データを完全使用可能<br>' +
    '<b>🔓 広告非表示・全機能解放</b><br>　すべてのデータレイヤーを制限なく利用<br><br>' +
    '<span style="font-size:13px;font-weight:700;color:var(--gold);">月額 ¥480 ／ 年額 ¥3,800</span></div>';
  showDlg('dlg-premium-gate');
}

// ── ユーティリティ ───────────────────────────
function _escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _formatTime(ts){
  const diff = Date.now() - ts;
  if(diff < 60000)    return 'たった今';
  if(diff < 3600000)  return Math.floor(diff/60000)+'分前';
  if(diff < 86400000) return Math.floor(diff/3600000)+'時間前';
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()}`;
}
let _toastTimer = null;
function _commToast(msg){
  let el = document.getElementById('comm-toast');
  if(!el){
    el = document.createElement('div'); el.id = 'comm-toast';
    el.style.cssText =
      'position:fixed;bottom:calc(var(--tab-h)+60px);left:50%;transform:translateX(-50%);' +
      'background:rgba(30,20,10,0.92);border:1px solid var(--gold);color:var(--txt);' +
      'padding:8px 18px;border-radius:20px;font-size:12px;z-index:2000;pointer-events:none;' +
      'white-space:nowrap;backdrop-filter:blur(8px);opacity:0;transition:opacity 0.2s;';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{ el.style.opacity='0'; }, 2500);
}
