'use strict';
// ═══════════════════════════════════════════
//  COMMUNITY  掲示板・金相場
//  Firestore版: 手動更新・差分取得・バッチ削除
// ═══════════════════════════════════════════

// ── 定数 ────────────────────────────────────
const COMM_MAX_CHARS   = 200;   // 本文文字数上限
const COMM_BAD_LIMIT   = 3;     // バッド非表示しきい値
const COMM_RATE_MS     = 60000; // 投稿間隔制限（1分）
const GOLD_CACHE_MS    = 86400000; // 金相場キャッシュ（24h）

// Firestore保持上限・バッチ削除トリガー
const COMM_NATIONAL_DISPLAY  = 50;  // 全国：表示件数
const COMM_NATIONAL_TRIGGER  = 101; // 全国：この件数超えたら削除
const COMM_PREF_DISPLAY      = 10;  // 都道府県：表示件数
const COMM_PREF_TRIGGER      = 41;  // 都道府県：この件数超えたら削除

// ── ストレージキー ───────────────────────────
const SK_NICKNAME   = 'comm_nickname';
const SK_LAST_POST  = 'comm_last_post';
const SK_REACTIONS  = 'comm_reactions';   // { postId: {like:bool, bad:bool} }
const SK_SCOPE      = 'comm_scope';       // 'national' | 'regional'
const SK_PREF       = 'comm_pref';
const SK_REGION     = 'comm_region';
const SK_GOLD       = 'comm_gold_cache';
// 差分取得用キャッシュ
const SK_CACHE_NAT  = 'comm_cache_national';   // [{id,nick,text,ts,like,bad,uid,scope}]
const SK_CACHE_PREF = 'comm_cache_pref_';      // + 都道府県名

// ── 地方・都道府県マスタ ─────────────────────
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

// ── 状態 ────────────────────────────────────
let _commScope   = localStorage.getItem(SK_SCOPE)  || 'national';
let _commRegion  = localStorage.getItem(SK_REGION) || '北海道';
let _commPref    = localStorage.getItem(SK_PREF)   || '';
let _commInited  = false;
let _commLoading = false; // 二重リクエスト防止

// ── Firestore参照（firebase.jsで初期化済み前提）────
function _db(){ return firebase.firestore(); }

// ═══════════════════════════════════════════
//  キャッシュ読み書き
// ═══════════════════════════════════════════
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

// ── リアクション読み書き ──────────────────────
function _loadReactions(){
  try{ return JSON.parse(localStorage.getItem(SK_REACTIONS)) || {}; }
  catch(e){ return {}; }
}
function _saveReactions(r){ localStorage.setItem(SK_REACTIONS, JSON.stringify(r)); }

// ═══════════════════════════════════════════
//  コミュニティタブ初期化
// ═══════════════════════════════════════════
function initCommunity(){
  if(_commInited) return;
  _commInited = true;
  _renderScopeTab();
  _renderRegionSelector();
  _loadNickname();
  _updateCharCount();
  _initGoldDisplay();
  // キャッシュがあれば即表示
  _renderPostsFromCache();
}

// ═══════════════════════════════════════════
//  スコープ・地方・都道府県
// ═══════════════════════════════════════════
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
function commOnRegionChange(val){
  _commRegion = val;
  localStorage.setItem(SK_REGION, val);
  _updatePrefSelector();
}
function commOnPrefChange(val){
  _commPref = val;
  localStorage.setItem(SK_PREF, val);
  _renderPostsFromCache();
}

// ═══════════════════════════════════════════
//  Firestore取得（手動更新ボタン）
// ═══════════════════════════════════════════
async function commRefresh(){
  if(_commLoading) return;
  _commLoading = true;
  _setRefreshBtnState(true);

  try{
    const scope  = _commScope;
    const pref   = _commPref;
    const cached = _loadCache(scope, pref);
    const latestTs = _getLatestTs(cached);

    // Firestoreクエリ構築
    let q = _db().collection('posts')
      .where('scope', '==', scope === 'national' ? 'national' : 'pref');
    if(scope === 'regional') q = q.where('pref', '==', pref);

    // 差分取得：キャッシュがあれば最新ts以降のみ
    if(latestTs > 0){
      q = q.where('ts', '>', new Date(latestTs));
    }

    // 新着順・表示上限件数分
    const limit = scope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
    q = q.orderBy('ts', 'desc').limit(limit);

    const snap = await q.get();
    const newPosts = snap.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().ts?.toMillis?.() ?? d.data().ts }));

    if(newPosts.length === 0){
      _commToast('最新の状態です');
      _renderPostsFromCache();
      return;
    }

    // キャッシュにマージ（重複排除・新着順ソート）
    const merged = _mergePosts(cached, newPosts, limit);
    _saveCache(scope, pref, merged);
    _renderPostsFromCache();
    _commToast(`${newPosts.length}件の新着を取得しました`);

  } catch(e){
    console.error('[comm] refresh failed', e);
    _commToast('取得に失敗しました。通信を確認してください。');
  } finally {
    _commLoading = false;
    _setRefreshBtnState(false);
  }
}

function _mergePosts(cached, newPosts, limit){
  const map = {};
  [...cached, ...newPosts].forEach(p => { map[p.id] = p; });
  return Object.values(map)
    .sort((a,b) => (b.ts||0) - (a.ts||0))
    .slice(0, limit);
}

function _setRefreshBtnState(loading){
  const btn = document.getElementById('comm-refresh-btn');
  if(!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '取得中…' : '🔄 更新';
}

// ═══════════════════════════════════════════
//  投稿一覧レンダリング（キャッシュから）
// ═══════════════════════════════════════════
function _renderPostsFromCache(){
  const container = document.getElementById('comm-post-list');
  if(!container) return;

  const posts = _loadCache(_commScope, _commPref);
  const reactions = _loadReactions();

  if(posts.length === 0){
    container.innerHTML = '<div class="comm-empty">まだ投稿がありません。「🔄 更新」で読み込むか、最初の一言をどうぞ！</div>';
    return;
  }

  container.innerHTML = posts.map(p=>{
    const r = reactions[p.id] || {};
    const hidden = (p.bad||0) >= COMM_BAD_LIMIT;
    if(hidden) return `<div class="comm-post comm-post-hidden"><span>⚠️ 複数のバッド報告により非表示</span></div>`;

    const likeActive = r.like ? ' active' : '';
    const badActive  = r.bad  ? ' active' : '';
    const timeStr    = _formatTime(p.ts);

    return `<div class="comm-post" data-id="${p.id}">
  <div class="comm-post-header">
    <span class="comm-nick">${_escHtml(p.nick)}</span>
    <span class="comm-time">${timeStr}</span>
  </div>
  <div class="comm-post-body">${_escHtml(p.text)}</div>
  <div class="comm-post-footer">
    <button class="comm-react-btn like${likeActive}" onclick="commReact('${p.id}','like')">
      👍 <span id="comm-like-${p.id}">${p.like||0}</span>
    </button>
    <button class="comm-react-btn bad${badActive}" onclick="commReact('${p.id}','bad')">
      👎 <span id="comm-bad-${p.id}">${p.bad||0}</span>
    </button>
  </div>
</div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  投稿送信
// ═══════════════════════════════════════════
async function commSubmit(){
  const nickEl = document.getElementById('comm-nick-input');
  const textEl = document.getElementById('comm-text-input');

  const nick = (nickEl.value.trim() || '匿名さん').slice(0,20);
  const text = textEl.value.trim();

  if(!text){ _commToast('本文を入力してください'); return; }
  if(text.length > COMM_MAX_CHARS){ _commToast(`${COMM_MAX_CHARS}文字以内で入力してください`); return; }

  // レート制限
  const lastPost = parseInt(localStorage.getItem(SK_LAST_POST)||'0');
  const now = Date.now();
  if(now - lastPost < COMM_RATE_MS){
    const sec = Math.ceil((COMM_RATE_MS-(now-lastPost))/1000);
    _commToast(`投稿は1分間に1回までです（あと${sec}秒）`);
    return;
  }

  // 認証確認
  const user = firebase.auth().currentUser;
  if(!user){ _commToast('投稿にはログインが必要です'); return; }

  // ニックネーム記憶
  if(nickEl.value.trim()) localStorage.setItem(SK_NICKNAME, nickEl.value.trim());

  const submitBtn = document.querySelector('.comm-submit-btn');
  if(submitBtn) submitBtn.disabled = true;

  try{
    const scope = _commScope === 'national' ? 'national' : 'pref';
    const postData = {
      scope: scope,
      nick:  nick,
      text:  text,
      ts:    firebase.firestore.FieldValue.serverTimestamp(),
      like:  0,
      bad:   0,
      uid:   user.uid,
    };
    if(scope === 'pref') postData.pref = _commPref;

    // Firestoreに書き込み
    const ref = await _db().collection('posts').add(postData);

    // ローカルキャッシュに楽観的追加
    const localPost = { ...postData, id: ref.id, ts: now, scope };
    const cached = _loadCache(_commScope, _commPref);
    const limit  = _commScope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
    const merged = [localPost, ...cached].slice(0, limit);
    _saveCache(_commScope, _commPref, merged);

    localStorage.setItem(SK_LAST_POST, now.toString());
    textEl.value = '';
    _updateCharCount();
    _renderPostsFromCache();
    _commToast('投稿しました！');

    // バッチ削除チェック（非同期・バックグラウンド）
    _checkAndBatchDelete(scope, scope === 'pref' ? _commPref : null).catch(e=>console.warn('[comm] batch delete failed', e));

  } catch(e){
    console.error('[comm] submit failed', e);
    _commToast('投稿に失敗しました。通信を確認してください。');
  } finally {
    if(submitBtn) submitBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════
//  バッチ削除（トリガー件数超過時に古い分を一括削除）
// ═══════════════════════════════════════════
async function _checkAndBatchDelete(scope, pref){
  const trigger = scope === 'national' ? COMM_NATIONAL_TRIGGER : COMM_PREF_TRIGGER;
  const display = scope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;

  let q = _db().collection('posts').where('scope', '==', scope);
  if(pref) q = q.where('pref', '==', pref);

  // 全件数確認（orderByなし・countは無料枠外のためlimit+1で判定）
  const snap = await q.orderBy('ts', 'asc').limit(trigger).get();
  if(snap.docs.length < trigger) return; // トリガー未達

  // 古い順に（trigger - display）件削除
  const deleteCount = trigger - display;
  const toDelete = snap.docs.slice(0, deleteCount);

  const batch = _db().batch();
  toDelete.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`[comm] batch deleted ${deleteCount} old posts (scope:${scope} pref:${pref||'-'})`);
}

// ═══════════════════════════════════════════
//  リアクション（like/bad）
// ═══════════════════════════════════════════
async function commReact(postId, type){
  const reactions = _loadReactions();
  const r = reactions[postId] || {};

  // トグル判定
  const isOn = !!r[type];
  const delta = isOn ? -1 : 1;
  r[type] = !isOn;
  reactions[postId] = r;
  _saveReactions(reactions);

  // キャッシュを楽観的更新
  const scope = _commScope;
  const pref  = _commPref;
  const cached = _loadCache(scope, pref);
  const post = cached.find(p => p.id === postId);
  if(post){
    post[type] = Math.max(0, (post[type]||0) + delta);
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
  }

  // Firestore更新（increment）
  try{
    await _db().collection('posts').doc(postId).update({
      [type]: firebase.firestore.FieldValue.increment(delta)
    });
  } catch(e){
    // 失敗時はキャッシュを戻す
    console.warn('[comm] react failed', e);
    r[type] = isOn;
    reactions[postId] = r;
    _saveReactions(reactions);
    if(post){
      post[type] = Math.max(0, (post[type]||0) - delta);
      _saveCache(scope, pref, cached);
      _renderPostsFromCache();
    }
    _commToast('操作に失敗しました');
  }
}

// ═══════════════════════════════════════════
//  ニックネーム・文字数カウント
// ═══════════════════════════════════════════
function _loadNickname(){
  const saved = localStorage.getItem(SK_NICKNAME);
  if(saved) document.getElementById('comm-nick-input').value = saved;
}
function _updateCharCount(){
  const el  = document.getElementById('comm-text-input');
  const cnt = document.getElementById('comm-char-count');
  if(!el||!cnt) return;
  const len = el.value.length;
  cnt.textContent = `${len}/${COMM_MAX_CHARS}`;
  cnt.style.color = len > COMM_MAX_CHARS ? '#ff5a47' : 'var(--txt-sub)';
}

// ── スポットタグセレクタ（削除済み）────────────
function _buildTagSelector(){ /* タグ機能削除済み */ }

// ═══════════════════════════════════════════
//  金相場
// ═══════════════════════════════════════════
async function commShowGoldPrice(){
  const btn = document.getElementById('comm-gold-btn');
  btn.disabled = true;
  btn.textContent = '取得中…';
  try{
    const goldRes  = await fetch('https://api.gold-api.com/price/XAU');
    if(!goldRes.ok) throw new Error('gold-api ' + goldRes.status);
    const goldJson = await goldRes.json();
    const priceUsdOz = parseFloat(goldJson.price);
    if(!priceUsdOz || isNaN(priceUsdOz)) throw new Error('invalid price');

    const fxRes  = await fetch('https://open.er-api.com/v6/latest/USD');
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
  btn.disabled=false; btn.textContent='💰 金相場';
}
function _renderGoldDisplay(d){
  let el = document.getElementById('comm-gold-display');
  if(!el){
    el = document.createElement('div');
    el.id = 'comm-gold-display';
    el.className = 'comm-gold-display';
    const row = document.getElementById('comm-gold-row');
    if(row) row.insertAdjacentElement('afterend', el);
  }
  el.innerHTML =
    `<span class="comm-gold-price">¥${d.price_jpy_g.toLocaleString()}<small>/g</small></span>` +
    `<span class="comm-gold-date">${d.date} 取得　USD/oz $${Math.round(d.price_usd).toLocaleString()}　USD/JPY ${d.rate_jpy.toFixed(1)}</span>` +
    `<span class="comm-gold-note">※参考値。実際の買取価格は業者により異なります</span>`;
}
function _initGoldDisplay(){
  try{
    const cached = JSON.parse(localStorage.getItem(SK_GOLD)||'null');
    if(cached) _renderGoldDisplay(cached);
  } catch(e){}
}

// ═══════════════════════════════════════════
//  ルール折りたたみ・プレミアムダイアログ
// ═══════════════════════════════════════════
function commToggleRule(){
  const body  = document.getElementById('comm-rule-body');
  const arrow = document.getElementById('comm-rule-arrow');
  const open  = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arrow.textContent  = open ? '▶' : '▼';
}
function commShowPremium(){
  const body  = document.getElementById('premium-gate-body');
  const title = document.getElementById('premium-gate-title');
  const icon  = document.getElementById('premium-gate-icon');
  icon.textContent  = '✨';
  title.textContent = 'GOLD MAP プレミアム';
  body.innerHTML =
    '<div style="text-align:left;font-size:12px;line-height:2;padding:4px 0;">' +
    '砂金採取をもっと本格的に。<br><br>' +
    '<b>🗺 高精度ヒートマップ</b><br>　全国の砂金採取確率をAI解析でマップ表示<br>' +
    '<b>🐻 熊域リアルタイム警告</b><br>　現在地周辺の熊出没エリアを地図に表示<br>' +
    '<b>📥 オフライン完全対応</b><br>　圏外エリアでも地図・データを完全使用可能<br>' +
    '<b>🔓 広告非表示・全機能解放</b><br>　すべてのデータレイヤーを制限なく利用<br><br>' +
    '<span style="font-size:13px;font-weight:700;color:var(--gold);">月額 ¥480 ／ 年額 ¥3,800</span>' +
    '</div>';
  showDlg('dlg-premium-gate');
}

// ═══════════════════════════════════════════
//  ユーティリティ
// ═══════════════════════════════════════════
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
    el = document.createElement('div');
    el.id = 'comm-toast';
    el.style.cssText = 'position:fixed;bottom:calc(var(--tab-h)+60px);left:50%;transform:translateX(-50%);' +
      'background:rgba(30,20,10,0.92);border:1px solid var(--gold);color:var(--txt);' +
      'padding:8px 18px;border-radius:20px;font-size:12px;z-index:2000;pointer-events:none;' +
      'white-space:nowrap;backdrop-filter:blur(8px);opacity:0;transition:opacity 0.2s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{ el.style.opacity='0'; }, 2500);
}
