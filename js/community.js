'use strict';
// ═══════════════════════════════════════════
//  COMMUNITY  掲示板
//  Firestore版: 手動更新・差分取得・バッチ削除
//  v2: 通報・自分投稿削除・更新クールダウン
// ═══════════════════════════════════════════

const COMM_MAX_CHARS        = 200;
const COMM_RATE_MS          = 180000;
const COMM_REFRESH_COOL     = 180000;
const COMM_REPLY_MAX_CHARS    = 200; // 1階層目返信
const COMM_SUBREPLY_MAX_CHARS = 100; // 2・3階層目返信
const COMM_REPLY_LIMIT        = 100; // 1スレッド最大返信数

const COMM_NATIONAL_DISPLAY  = 30;
const COMM_NATIONAL_TRIGGER  = 50;
const COMM_PREF_DISPLAY      = 10;
const COMM_PREF_TRIGGER      = 20;

const SK_NICKNAME      = 'comm_nickname';
const SK_LAST_POST     = 'comm_last_post';
const SK_LAST_REFRESH  = 'comm_last_refresh';
const SK_REACTIONS     = 'comm_reactions';
const SK_SCOPE         = 'comm_scope';
const SK_PREF          = 'comm_pref';
const SK_REGION        = 'comm_region';
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
let _hideCtx = null; // { type:'post'|'reply', postId, path:[], uid }

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
function commHideReply(postId, path, uid){
  _hideCtx = { type: 'reply', postId, path, uid };
  showDlg('dlg-hide-post');
}

// 非表示モーダルの確定処理（3ボタン共通）
function _commHideConfirm(action){
  if(!_hideCtx){ closeOv(); return; }
  const { type, postId, path, uid } = _hideCtx;
  _hideCtx = null;
  closeOv();
  if(action === 'single'){
    if(type === 'post'){
      const list = _loadHidden();
      if(!list.includes(postId)){ list.push(postId); _saveHidden(list); }
    } else {
      const pathArr = Array.isArray(path) ? path : [path];
      const key = `${postId}_r${pathArr.join('_')}`;
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
function commUnhideReply(postId, path){
  const pathArr = Array.isArray(path) ? path : [path];
  const key = `${postId}_r${pathArr.join('_')}`;
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
    const replyLabel  = hasReplies ? `💬 ${replies.length}件の返信` : '💬 返信する';
    const repliesHtml = replies.map((rep, idx) => _buildReplyHtml(p.id, rep, [idx], uid, hiddenReply, ngUids, 0)).join('');
    // 自分の投稿には🚫ボタン不要
    const hideBtn = !isOwn
      ? `<button class="comm-hide-btn" onclick="commHidePost('${p.id}','${p.uid}')" title="非表示">🚫</button>`
      : '';
    return `<div class="comm-post" data-id="${p.id}">
  <div class="comm-post-header">
    <span class="comm-nick">${_escHtml(p.nick)}</span>
    <span class="comm-time">${timeStr}</span>
    <div class="comm-post-actions">${hideBtn}</div>
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

// ── ルール折りたたみ（ダイアログ化） ──────────────
function commToggleRule(){ showDlg('dlg-comm-rules'); }
// ── ツリーユーティリティ ────────────────────
function _getReplyByPath(replies, path){
  let cur = replies;
  let obj = null;
  for(const idx of path){
    if(!Array.isArray(cur) || idx >= cur.length) return null;
    obj = cur[idx];
    cur = Array.isArray(obj.replies) ? obj.replies : [];
  }
  return obj;
}
function _addReplyAtPath(replies, parentPath, newReply){
  const cloned = JSON.parse(JSON.stringify(replies));
  if(parentPath.length === 0){ cloned.push(newReply); return cloned; }
  let cur = cloned;
  for(let i = 0; i < parentPath.length; i++){
    const idx = parentPath[i];
    if(!Array.isArray(cur) || idx >= cur.length) return replies;
    if(i === parentPath.length - 1){
      if(!Array.isArray(cur[idx].replies)) cur[idx].replies = [];
      cur[idx].replies.push(newReply);
      return cloned;
    }
    cur = Array.isArray(cur[idx].replies) ? cur[idx].replies : [];
  }
  return cloned;
}
function _removeReplyAtPath(replies, path){
  const cloned = JSON.parse(JSON.stringify(replies));
  if(path.length === 1){ cloned.splice(path[0], 1); return cloned; }
  let cur = cloned;
  for(let i = 0; i < path.length - 1; i++){
    const idx = path[i];
    if(!Array.isArray(cur) || idx >= cur.length) return replies;
    if(i === path.length - 2){
      if(Array.isArray(cur[idx].replies)) cur[idx].replies.splice(path[path.length-1], 1);
      return cloned;
    }
    cur = Array.isArray(cur[idx].replies) ? cur[idx].replies : [];
  }
  return cloned;
}

// ── 返信HTML生成（3階層ツリー対応）────────────
// path: インデックス配列 [0] / [0,1] / [0,1,2]
// depth: 0=1階層 1=2階層 2=3階層
function _buildReplyHtml(postId, rep, path, uid, hiddenReply, ngUids, depth){
  depth = depth || 0;
  const pathArr  = Array.isArray(path) ? path : [path];
  const pathJson = JSON.stringify(pathArr);
  const key      = `${postId}_r${pathArr.join('_')}`;
  const isNg     = ngUids.includes(rep.uid);
  const isHidden = hiddenReply.includes(key);

  if(isNg || isHidden){
    const unhideBtn = isNg
      ? `<button class="comm-unhide-btn" onclick="commUnhideNg('${rep.uid}')">NG解除</button>`
      : `<button class="comm-unhide-btn" onclick="commUnhideReply('${postId}',${pathJson})">非表示解除</button>`;
    return `<div class="comm-reply-item comm-reply-depth-${depth} comm-post-hidden">
  <span>⚠️ 非表示の返信${isNg ? '（NG登録中）' : ''}</span>${unhideBtn}
</div>`;
  }

  const isOwn     = uid && rep.uid === uid;
  const deleteBtn = isOwn
    ? `<button class="comm-reply-delete-btn" onclick="commDeleteReply('${postId}',${pathJson})" title="削除">🗑</button>`
    : '';
  const hideBtn = !isOwn
    ? `<button class="comm-hide-btn" onclick="commHideReply('${postId}',${pathJson},'${rep.uid}')" title="非表示">🚫</button>`
    : '';

  // 子返信
  const subReplies    = Array.isArray(rep.replies) ? rep.replies : [];
  const hasSubReplies = subReplies.length > 0;
  const subSectionId  = `comm-sub-${postId}-${pathArr.join('-')}`;
  const subInputId    = `comm-sub-input-${postId}-${pathArr.join('-')}`;

  // 3階層目は返信ボタンなし
  const maxChars   = depth === 0 ? COMM_REPLY_MAX_CHARS : COMM_SUBREPLY_MAX_CHARS;
  const replyBtnHtml = depth < 2
    ? `<button class="comm-sub-reply-toggle-btn" onclick="commToggleSubReply('${postId}',${pathJson})">${hasSubReplies ? `💬 ${subReplies.length}件` : '↩ 返信'}</button>`
    : '';

  // 子返信HTML（再帰）
  const subListHtml = subReplies.map((sr, si) =>
    _buildReplyHtml(postId, sr, [...pathArr, si], uid, hiddenReply, ngUids, depth + 1)
  ).join('');

  const subSectionHtml = depth < 2 ? `
  <div class="comm-sub-reply-section" id="${subSectionId}" style="display:none">
    <div class="comm-sub-reply-list">${subListHtml}</div>
    <div class="comm-reply-input-row">
      <input class="comm-reply-input" id="${subInputId}" type="text" maxlength="${maxChars}" placeholder="返信…（${maxChars}文字以内）">
      <button class="comm-reply-send-btn" onclick="commSubmitSubReply('${postId}',${pathJson})">送信</button>
    </div>
  </div>` : (hasSubReplies ? `<div class="comm-sub-reply-section" style="display:none"><div class="comm-sub-reply-list">${subListHtml}</div></div>` : '');

  return `<div class="comm-reply-item comm-reply-depth-${depth}">
  <div class="comm-reply-header">
    <span class="comm-nick">${_escHtml(rep.nick)}</span>
    <span class="comm-time">${_formatTime(rep.ts)}</span>
    <div class="comm-post-actions">${hideBtn}</div>
  </div>
  <div class="comm-reply-body">${_escHtml(rep.text)}</div>
  <div class="comm-reply-meta">${replyBtnHtml}</div>${subSectionHtml}
</div>`;
}

// ── 返信トグル（1階層目）────────────────────
function commToggleReply(postId){
  const sec = document.getElementById(`comm-reply-section-${postId}`);
  if(!sec) return;
  const isOpen = sec.style.display !== 'none';
  sec.style.display = isOpen ? 'none' : 'block';
}

// ── サブ返信トグル（2・3階層目）──────────────
function commToggleSubReply(postId, path){
  const key = Array.isArray(path) ? path.join('-') : String(path);
  const sec = document.getElementById(`comm-sub-${postId}-${key}`);
  if(!sec) return;
  const isOpen = sec.style.display !== 'none';
  sec.style.display = isOpen ? 'none' : 'block';
}

// ── レート制限チェック共通 ──────────────────
function _checkReplyRateLimit(){
  const lastPost = parseInt(localStorage.getItem(SK_LAST_POST)||'0');
  const now = Date.now();
  if(now - lastPost < COMM_RATE_MS){
    const sec = Math.ceil((COMM_RATE_MS-(now-lastPost))/1000);
    _commToast(`投稿と更新から3分間は新たに投稿できません（あと${sec}秒）`);
    return false;
  }
  return true;
}

// ── 返信投稿（1階層目）──────────────────────
async function commSubmitReply(postId){
  const user = firebase.auth().currentUser;
  if(!user){ _commToast('返信にはログインが必要です'); return; }
  if(!_checkReplyRateLimit()) return;

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

  const now      = Date.now();
  const nick     = (localStorage.getItem(SK_NICKNAME) || '匿名さん').slice(0, 20);
  const newReply = { nick, text, uid: user.uid, ts: now, report: 0, replies: [] };
  const before   = JSON.parse(JSON.stringify(replies));

  post.replies = _addReplyAtPath(replies, [], newReply);
  _saveCache(scope, pref, cached);
  inp.value = '';
  _renderPostsFromCache();
  const sec = document.getElementById(`comm-reply-section-${postId}`);
  if(sec) sec.style.display = 'block';

  try{
    await _db().collection('posts').doc(postId).update({ replies: post.replies });
    localStorage.setItem(SK_LAST_POST, now.toString());
    localStorage.setItem(SK_LAST_REFRESH, now.toString());
    _startRefreshCooldown(COMM_REFRESH_COOL);
    _commToast('返信しました！');
  } catch(e){
    post.replies = before;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    const sec2 = document.getElementById(`comm-reply-section-${postId}`);
    if(sec2) sec2.style.display = 'block';
    _commToast('返信に失敗しました');
    console.error('[comm] reply submit failed', e);
  }
}

// ── サブ返信投稿（2・3階層目）────────────────
async function commSubmitSubReply(postId, parentPath){
  const user = firebase.auth().currentUser;
  if(!user){ _commToast('返信にはログインが必要です'); return; }
  if(!_checkReplyRateLimit()) return;

  const key = Array.isArray(parentPath) ? parentPath.join('-') : String(parentPath);
  const inp = document.getElementById(`comm-sub-input-${postId}-${key}`);
  if(!inp) return;
  const text = inp.value.trim();
  if(!text){ _commToast('返信を入力してください'); return; }
  if(text.length > COMM_SUBREPLY_MAX_CHARS){ _commToast(`${COMM_SUBREPLY_MAX_CHARS}文字以内で入力してください`); return; }

  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  if(!post){ _commToast('投稿が見つかりません'); return; }

  const replies = Array.isArray(post.replies) ? post.replies : [];
  const now     = Date.now();
  const nick    = (localStorage.getItem(SK_NICKNAME) || '匿名さん').slice(0, 20);
  const newReply = { nick, text, uid: user.uid, ts: now, report: 0 };
  const before   = JSON.parse(JSON.stringify(replies));

  const newReplies = _addReplyAtPath(replies, parentPath, newReply);
  post.replies = newReplies;
  _saveCache(scope, pref, cached);
  inp.value = '';
  _renderPostsFromCache();
  const sec = document.getElementById(`comm-sub-${postId}-${key}`);
  if(sec) sec.style.display = 'block';

  try{
    await _db().collection('posts').doc(postId).update({ replies: newReplies });
    localStorage.setItem(SK_LAST_POST, now.toString());
    localStorage.setItem(SK_LAST_REFRESH, now.toString());
    _startRefreshCooldown(COMM_REFRESH_COOL);
    _commToast('返信しました！');
  } catch(e){
    post.replies = before;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    const sec2 = document.getElementById(`comm-sub-${postId}-${key}`);
    if(sec2) sec2.style.display = 'block';
    _commToast('返信に失敗しました');
    console.error('[comm] sub reply submit failed', e);
  }
}

// ── 返信削除（全階層対応・自分のみ）────────────
async function commDeleteReply(postId, path){
  const user = firebase.auth().currentUser;
  if(!user) return;
  if(!confirm('この返信を削除しますか？')) return;

  const scope  = _commScope, pref = _commPref;
  const cached = _loadCache(scope, pref);
  const post   = cached.find(p => p.id === postId);
  if(!post || !Array.isArray(post.replies)) return;

  const pathArr = Array.isArray(path) ? path : [path];
  const target  = _getReplyByPath(post.replies, pathArr);
  if(!target || target.uid !== user.uid){ _commToast('削除できません'); return; }

  const before     = JSON.parse(JSON.stringify(post.replies));
  const newReplies = _removeReplyAtPath(post.replies, pathArr);
  post.replies     = newReplies;
  _saveCache(scope, pref, cached);
  _renderPostsFromCache();

  // 親セクションを開いたまま維持
  const parentKey = pathArr.slice(0, -1).join('-');
  const sec = pathArr.length === 1
    ? document.getElementById(`comm-reply-section-${postId}`)
    : document.getElementById(`comm-sub-${postId}-${parentKey}`);
  if(sec) sec.style.display = 'block';

  try{
    await _db().collection('posts').doc(postId).update({ replies: newReplies });
    _commToast('返信を削除しました');
  } catch(e){
    post.replies = before;
    _saveCache(scope, pref, cached);
    _renderPostsFromCache();
    if(sec) sec.style.display = 'block';
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