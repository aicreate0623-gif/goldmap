'use strict';
// ═══════════════════════════════════════════
//  COMMUNITY  掲示板・金相場
//  Firestore版: 手動更新・差分取得・バッチ削除
//  v2: 通報・自分投稿削除・更新クールダウン
// ═══════════════════════════════════════════

const COMM_MAX_CHARS        = 200;
const COMM_RATE_MS          = 180000;
const COMM_REFRESH_COOL     = 180000;
const COMM_REPLY_MAX_CHARS  = 200;
const COMM_REPLY_LIMIT      = 100; // 1スレッド最大返信数

const COMM_NATIONAL_DISPLAY  = 50;
const COMM_NATIONAL_TRIGGER  = 100;
const COMM_PREF_DISPLAY      = 10;
const COMM_PREF_TRIGGER      = 100;

const SK_NICKNAME      = 'comm_nickname';
const SK_LAST_POST     = 'comm_last_post';
const SK_LAST_REFRESH  = 'comm_last_refresh';
const SK_REACTIONS     = 'comm_reactions';
const SK_SCOPE         = 'comm_scope';
const SK_PREF          = 'comm_pref';
const SK_REGION        = 'comm_region';
const SK_GOLD          = 'comm_gold_cache';
const SK_CACHE_NAT     = 'comm_cache_national';
const SK_CACHE_PREF    = 'comm_cache_pref_';
const SK_HIDDEN        = 'comm_hidden';        // 非表示投稿IDリスト
const SK_HIDDEN_REPLY  = 'comm_hidden_reply';  // 非表示返信キーリスト
const SK_NG_UIDS       = 'comm_ng_uids';       // NG uid リスト

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

// 非表示モーダル用の一時状態
let _hideCtx = null; // { type:'post'|'reply', postId, replyIdx, uid }

let _commScope   = localStorage.getItem(SK_SCOPE)  || 'national';
let _commRegion  = localStorage.getItem(SK_REGION) || '北海道';
let _commPref    = localStorage.getItem(SK_PREF)   || '';
let _commInited  = false;
let _commLoading = false;
let _refreshCoolTimer = null;

function _db(){ return firebase.firestore(); }

// ── NG・非表示 ───────────────────────────────
function _loadHidden(){ try{ return JSON.parse(localStorage.getItem(SK_HIDDEN)||'[]'); }catch(e){ return []; } }
function _saveHidden(list){ localStorage.setItem(SK_HIDDEN, JSON.stringify(list)); }
function _loadHiddenReply(){ try{ return JSON.parse(localStorage.getItem(SK_HIDDEN_REPLY)||'[]'); }catch(e){ return []; } }
function _saveHiddenReply(list){ localStorage.setItem(SK_HIDDEN_REPLY, JSON.stringify(list)); }
function _loadNgUids(){ try{ return JSON.parse(localStorage.getItem(SK_NG_UIDS)||'[]'); }catch(e){ return []; } }
function _saveNgUids(list){ localStorage.setItem(SK_NG_UIDS, JSON.stringify(list)); }

// 非表示ダイアログ（投稿）
function commHidePost(postId, uid){
  _hideCtx = { type: 'post', postId, uid };
  showDlg('dlg-hide-post');
}

// 非表示ダイアログ（返信）
function commHideReply(postId, replyIdx, uid){
  _hideCtx = { type: 'reply', postId, replyIdx, uid };
  showDlg('dlg-hide-post');
}

// 非表示モーダルの確定処理（3ボタン共通）
function _commHideConfirm(action){
  if(!_hideCtx){ closeOv(); return; }
  const { type, postId, replyIdx, uid } = _hideCtx;
  _hideCtx = null;
  closeOv();
  if(action === 'single'){
    if(type === 'post'){
      const list = _loadHidden();
      if(!list.includes(postId)){ list.push(postId); _saveHidden(list); }
    } else {
      const key = `${postId}_r${replyIdx}`;
      const list = _loadHiddenReply();
      if(!list.includes(key)){ list.push(key); _saveHiddenReply(list); }
    }
  } else if(action === 'ng'){
    const uids = _loadNgUids();
    if(!uids.includes(uid)){ uids.push(uid); _saveNgUids(uids); }
  }
  _renderPostsFromCache();
}

// 非表示解除（投稿）
function commUnhidePost(postId){
  const list = _loadHidden().filter(id => id !== postId);
  _saveHidden(list);
  _renderPostsFromCache();
}

// NG解除（uidベース・投稿と返信共通）
function commUnhideNg(uid){
  const uids = _loadNgUids().filter(u => u !== uid);
  _saveNgUids(uids);
  _renderPostsFromCache();
}

// 非表示解除（返信）
function commUnhideReply(postId, replyIdx){
  const key = `${postId}_r${replyIdx}`;
  const list = _loadHiddenReply().filter(k => k !== key);
  _saveHiddenReply(list);
  _renderPostsFromCache();
}

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
  const btn      = document.getElementById('comm-refresh-btn');
  const submitBtn= document.querySelector('.comm-submit-btn');  // class統一
  const countdown= document.getElementById('comm-post-countdown');
  if(!btn) return;
  btn.disabled = true;
  if(submitBtn) submitBtn.disabled = true;
  if(countdown){ countdown.style.display = ''; }
  clearInterval(_refreshCoolTimer);
  let remaining = Math.ceil(ms / 1000);
  const _fmt = s => `🔄 更新（${s}秒）`;
  const _fmtCD = s => `あと${s}秒`;
  btn.textContent = _fmt(remaining);
  if(countdown) countdown.textContent = _fmtCD(remaining);
  _refreshCoolTimer = setInterval(()=>{
    remaining--;
    if(remaining <= 0){
      clearInterval(_refreshCoolTimer);
      btn.disabled = false;
      btn.textContent = '🔄 更新';
      const sb = document.querySelector('.comm-submit-btn');  // 再取得（DOM再描画対応）
      if(sb) sb.disabled = false;
      if(countdown){ countdown.style.display = 'none'; countdown.textContent = ''; }
    } else {
      btn.textContent = _fmt(remaining);
      if(countdown) countdown.textContent = _fmtCD(remaining);
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
    const scope  = _commScope;
    const pref   = _commPref;
    const cached = _loadCache(scope, pref);
    const limit  = scope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
    // ── クエリ構築 ──────────────────────────────────
    // 常にフル取得（orderBy + limit）でIDマージ。
    // 差分取得のtsフィルターはサーバー時刻とのズレで誤動作するため廃止。
    // クエリ本数は最大1本で現状以下。
    const fsScope = scope === 'national' ? 'national' : 'pref';
    let q = _db().collection('posts').where('scope', '==', fsScope);
    if(scope === 'regional') q = q.where('pref', '==', pref);
    q = q.orderBy('ts', 'desc').limit(limit);
    const snap = await q.get();
    const fetchedPosts = snap.docs.map(d => _normalizePost(d));
    // Firestoreを正として直接上書き（削除・更新も反映）
    _saveCache(scope, pref, fetchedPosts);
    const newCount = fetchedPosts.filter(fp => !cached.some(cp => cp.id === fp.id)).length;
    _commToast(newCount > 0 ? `${newCount}件の新着を取得しました` : '最新の状態です');
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
    // エラー時のみボタンを手動で戻す（正常時は_startRefreshCooldownが管理）
    if(btn){ btn.disabled = false; btn.textContent = '🔄 更新'; }
  } finally {
    _commLoading = false;
  }
}
function _normalizePost(doc){
  const d = doc.data();
  // replies内のtsもTimestamp→ミリ秒に変換
  const replies = Array.isArray(d.replies)
    ? d.replies.map(r => ({ ...r, ts: r.ts?.toMillis?.() ?? r.ts ?? Date.now() }))
    : [];
  return {
    id: doc.id, ...d,
    ts: d.ts?.toMillis?.() ?? d.ts,
    replies,
  };
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
  const posts       = _loadCache(_commScope, _commPref);
  const reactions   = _loadReactions();
  const uid         = firebase.auth().currentUser?.uid || null;
  const hidden      = _loadHidden();
  const hiddenReply = _loadHiddenReply();
  const ngUids      = _loadNgUids();
  if(posts.length === 0){
    container.innerHTML = '<div class="comm-empty">まだ投稿がありません。「🔄 更新」で読み込むか、最初の一言をどうぞ！</div>';
    return;
  }
  container.innerHTML = posts.map(p=>{
    const r = reactions[p.id] || {};
    // Firestore側soft delete\uff08全員非表示\uff09
    if(p.hidden === true) return null;
    // NG uid または個別非表示
    const isNg     = ngUids.includes(p.uid);
    const isHidden = hidden.includes(p.id);
    if(isNg || isHidden){
      const unhideBtn = isNg
        ? `<button class="comm-unhide-btn" onclick="commUnhideNg('${p.uid}')">NG解除</button>`
        : `<button class="comm-unhide-btn" onclick="commUnhidePost('${p.id}')">非表示解除</button>`;
      return `<div class="comm-post comm-post-hidden">
  <span>⚠️ 非表示の書き込み${isNg ? '（NG登録中）' : ''}</span>
  ${unhideBtn}
</div>`;
    }
    const likeActive = r.like ? ' active' : '';
    const timeStr    = _formatTime(p.ts);
    const isOwn      = uid && p.uid === uid;
    const replies    = Array.isArray(p.replies) ? p.replies : [];
    const hasReplies = replies.length > 0;
    // 返信なし→物理削除、返信あり→全員非表示\uff08soft delete\uff09
    const deleteBtn = isOwn
      ? hasReplies
        ? `<button class="comm-delete-btn" onclick="commSoftDeletePost('${p.id}')" title="非表示にする">🗑</button>`
        : `<button class="comm-delete-btn" onclick="commDeletePost('${p.id}')" title="削除">🗑</button>`
      : '';
    const replyLabel  = hasReplies ? `💬 ${replies.length}件の返信` : '💬 返信する';
    const repliesHtml = replies.map((rep, idx) => _buildReplyHtml(p.id, rep, idx, uid, hiddenReply, ngUids)).join('');
    // 自分の投稿には🚫ボタン不要
    const hideBtn = !isOwn
      ? `<button class="comm-hide-btn" onclick="commHidePost('${p.id}','${p.uid}')" title="非表示">🚫</button>`
      : '';
    return `<div class="comm-post" data-id="${p.id}">
  <div class="comm-post-header">
    <span class="comm-nick">${_escHtml(p.nick)}</span>
    <span class="comm-time">${timeStr}</span>
    <div class="comm-post-actions">${hideBtn}${deleteBtn}</div>
  </div>
  <div class="comm-post-body">${_escHtml(p.text)}</div>
  <div class="comm-post-footer">
    <button class="comm-react-btn like${likeActive}" onclick="commReact('${p.id}','like')">
      👍 <span id="comm-like-${p.id}">${p.like||0}</span>
    </button>
    <button class="comm-reply-toggle-btn" onclick="commToggleReply('${p.id}')">
      ${replyLabel}
    </button>
  </div>
  <div class="comm-reply-section" id="comm-reply-section-${p.id}" style="display:none">
    <div class="comm-reply-list" id="comm-reply-list-${p.id}">${repliesHtml}</div>
    <div class="comm-reply-input-row">
      <input class="comm-reply-input" id="comm-reply-input-${p.id}"
        type="text" maxlength="${COMM_REPLY_MAX_CHARS}"
        placeholder="返信を入力…（${COMM_REPLY_MAX_CHARS}文字以内）">
      <button class="comm-reply-send-btn" onclick="commSubmitReply('${p.id}')">送信</button>
    </div>
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
    _commToast(`投稿と更新から3分間は新たに投稿できません（あと${sec}秒）`); return;
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
    localStorage.setItem(SK_LAST_REFRESH, now.toString());
    textEl.value = ''; _updateCharCount();
    _renderPostsFromCache();
    _commToast('投稿しました！');
    _startRefreshCooldown(COMM_REFRESH_COOL);
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
// 返信ありの自分投稿を全員非表示（Firestoreにhidden:true）
async function commSoftDeletePost(postId){
  const user = firebase.auth().currentUser;
  if(!user) return;
  const scope = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post = cached.find(p => p.id === postId);
  if(!post || post.uid !== user.uid){ _commToast('操作できません'); return; }
  if(!confirm('この投稿を非表示にしますか？返信を含むすべてのユーザーから見えなくなります。')) return;
  try{
    await _db().collection('posts').doc(postId).update({ hidden: true });
    post.hidden = true;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    _commToast('投稿を非表示にしました');
  } catch(e){
    console.error('[comm] soft delete failed', e);
    _commToast('操作に失敗しました');
  }
}

async function commDeletePost(postId){
  const user = firebase.auth().currentUser;
  if(!user) return;
  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  // 返信がある場合は削除不可
  if(post && Array.isArray(post.replies) && post.replies.length > 0){
    _commToast('返信がついた投稿は削除できません');
    return;
  }
  if(!confirm('この投稿を削除しますか？')) return;
  try{
    await _db().collection('posts').doc(postId).delete();
    _saveCache(scope, pref, cached.filter(p => p.id !== postId));
    _renderPostsFromCache();
    _commToast('投稿を削除しました');
  } catch(e){
    console.error('[comm] delete failed', e);
    _commToast('削除に失敗しました');
  }
}

// ── likeリアクション ─────────────────────────
const _reactingSet = new Set(); // 連打防止フラグ
async function commReact(postId, type){
  const key = `${postId}_${type}`;
  if(_reactingSet.has(key)) return; // 処理中は弾く
  _reactingSet.add(key);
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
  } finally {
    _reactingSet.delete(key);
  }
}

// ── バッチ削除（古い順） ─────────────────────
async function _checkAndBatchDelete(fsScope, pref){
  const trigger = fsScope === 'national' ? COMM_NATIONAL_TRIGGER : COMM_PREF_TRIGGER;
  const display = fsScope === 'national' ? COMM_NATIONAL_DISPLAY : COMM_PREF_DISPLAY;
  let q = _db().collection('posts').where('scope', '==', fsScope);
  if(pref) q = q.where('pref', '==', pref);
  const snap = await q.orderBy('ts', 'asc').limit(trigger).get();
  if(snap.docs.length < trigger) return;
  // hidden:true を優先削除対象に並べ替え
  const hiddenDocs  = snap.docs.filter(d => d.data().hidden === true);
  const normalDocs  = snap.docs.filter(d => !d.data().hidden);
  const toDelete = [...hiddenDocs, ...normalDocs].slice(0, trigger - display);
  const batch = _db().batch();
  toDelete.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`[comm] batch deleted ${toDelete.length} posts (hidden:${hiddenDocs.length} scope:${fsScope} pref:${pref||'-'})`);
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
    `<span class="comm-gold-note">※参考値。実際の価格は業者により異なります</span>`;
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

// ── 返信HTML生成ヘルパー ─────────────────────
function _buildReplyHtml(postId, rep, idx, uid, hiddenReply, ngUids){
  const key      = `${postId}_r${idx}`;
  const isNg     = ngUids.includes(rep.uid);
  const isHidden = hiddenReply.includes(key);
  if(isNg || isHidden){
    const unhideBtn = isNg
      ? `<button class="comm-unhide-btn" onclick="commUnhideNg('${rep.uid}')">NG解除</button>`
      : `<button class="comm-unhide-btn" onclick="commUnhideReply('${postId}',${idx})">非表示解除</button>`;
    return `<div class="comm-reply-item comm-post-hidden">
  <span>⚠️ 非表示の返信${isNg ? '（NG登録中）' : ''}</span>
  ${unhideBtn}
</div>`;
  }
  const isOwn     = uid && rep.uid === uid;
  const deleteBtn = isOwn
    ? `<button class="comm-reply-delete-btn" onclick="commDeleteReply('${postId}',${idx})" title="削除">🗑</button>`
    : '';
  const hideBtn = !isOwn
    ? `<button class="comm-hide-btn" onclick="commHideReply('${postId}',${idx},'${rep.uid}')" title="非表示">🚫</button>`
    : '';
  return `<div class="comm-reply-item">
  <div class="comm-reply-header">
    <span class="comm-nick">${_escHtml(rep.nick)}</span>
    <span class="comm-time">${_formatTime(rep.ts)}</span>
    <div class="comm-post-actions">${hideBtn}${deleteBtn}</div>
  </div>
  <div class="comm-reply-body">${_escHtml(rep.text)}</div>
</div>`;
}

// ── 返信トグル ───────────────────────────────
function commToggleReply(postId){
  const sec = document.getElementById(`comm-reply-section-${postId}`);
  if(!sec) return;
  const isOpen = sec.style.display !== 'none';
  sec.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    const inp = document.getElementById(`comm-reply-input-${postId}`);
    if(inp) inp.focus();
  }
}

// ── 返信投稿 ─────────────────────────────────
async function commSubmitReply(postId){
  const user = firebase.auth().currentUser;
  if(!user){ _commToast('返信にはログインが必要です'); return; }

  // レート制限（親投稿と共有）
  const lastPost = parseInt(localStorage.getItem(SK_LAST_POST)||'0');
  const now = Date.now();
  if(now - lastPost < COMM_RATE_MS){
    const sec = Math.ceil((COMM_RATE_MS-(now-lastPost))/1000);
    _commToast(`投稿と更新から3分間は新たに投稿できません（あと${sec}秒）`); return;
  }

  const inp = document.getElementById(`comm-reply-input-${postId}`);
  if(!inp) return;
  const text = inp.value.trim();
  if(!text){ _commToast('返信を入力してください'); return; }
  if(text.length > COMM_REPLY_MAX_CHARS){ _commToast(`${COMM_REPLY_MAX_CHARS}文字以内で入力してください`); return; }

  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  if(!post){ _commToast('投稿が見つかりません'); return; }

  const replies = Array.isArray(post.replies) ? post.replies : [];
  if(replies.length >= COMM_REPLY_LIMIT){ _commToast('返信が上限に達しています'); return; }

  const nick = (localStorage.getItem(SK_NICKNAME) || '匿名さん').slice(0, 20);
  const newReply = { nick, text, uid: user.uid, ts: now, report: 0 };

  // キャッシュ即反映
  post.replies = [...replies, newReply];
  _saveCache(scope, pref, cached);
  inp.value = '';
  _renderPostsFromCache();
  // 返信欄を再度開く
  const sec = document.getElementById(`comm-reply-section-${postId}`);
  if(sec) sec.style.display = 'block';

  try{
    await _db().collection('posts').doc(postId).update({
      replies: firebase.firestore.FieldValue.arrayUnion(newReply)
    });
    // 成功時のみクールダウン記録
    localStorage.setItem(SK_LAST_POST, now.toString());
    localStorage.setItem(SK_LAST_REFRESH, now.toString());
    _startRefreshCooldown(COMM_REFRESH_COOL);
    _commToast('返信しました！');
  } catch(e){
    // ロールバック
    post.replies = replies;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    const sec2 = document.getElementById(`comm-reply-section-${postId}`);
    if(sec2) sec2.style.display = 'block';
    _commToast('返信に失敗しました');
    console.error('[comm] reply submit failed', e);
  }
}

// ── 返信削除（自分のみ）────────────────────────
async function commDeleteReply(postId, replyIdx){
  const user = firebase.auth().currentUser;
  if(!user) return;
  if(!confirm('この返信を削除しますか？')) return;

  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  if(!post || !Array.isArray(post.replies)) return;

  const target = post.replies[replyIdx];
  if(!target || target.uid !== user.uid){ _commToast('削除できません'); return; }

  const before = [...post.replies];
  post.replies = post.replies.filter((_, i) => i !== replyIdx);
  _saveCache(scope, pref, cached);
  _renderPostsFromCache();
  const sec = document.getElementById(`comm-reply-section-${postId}`);
  if(sec) sec.style.display = 'block';

  try{
    await _db().collection('posts').doc(postId).update({
      replies: firebase.firestore.FieldValue.arrayRemove(target)
    });
    _commToast('返信を削除しました');
  } catch(e){
    post.replies = before;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    const sec2 = document.getElementById(`comm-reply-section-${postId}`);
    if(sec2) sec2.style.display = 'block';
    _commToast('削除に失敗しました');
    console.error('[comm] reply delete failed', e);
  }
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
  const now = new Date();
  if(d.getFullYear() !== now.getFullYear()){
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  }
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