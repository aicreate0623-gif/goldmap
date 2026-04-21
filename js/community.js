'use strict';
// ═══════════════════════════════════════════
//  COMMUNITY  掲示板・金相場
// ═══════════════════════════════════════════

// ── 定数 ────────────────────────────────────
const COMM_MAX_POSTS   = 30;   // 表示件数上限
const COMM_MAX_CHARS   = 200;  // 本文文字数上限
const COMM_BAD_LIMIT   = 3;    // バッド非表示しきい値
const COMM_RATE_MS     = 60000;// 投稿間隔制限（1分）
const GOLD_CACHE_MS    = 86400000; // 金相場キャッシュ（24h）

// ── ストレージキー ───────────────────────────
const SK_NICKNAME  = 'comm_nickname';
const SK_LAST_POST = 'comm_last_post';
const SK_POSTS     = 'comm_posts';       // { national:[], regional:{} }
const SK_REACTIONS = 'comm_reactions';   // { postId: {like:bool, bad:bool} }
const SK_SCOPE     = 'comm_scope';       // 'national' | 'regional'
const SK_PREF      = 'comm_pref';        // 選択中の都道府県
const SK_REGION    = 'comm_region';      // 選択中の地方
const SK_GOLD      = 'comm_gold_cache';  // { price_usd, rate_jpy, ts }

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

// ── データ読み書き ────────────────────────────
function _loadPosts(){
  try{ return JSON.parse(localStorage.getItem(SK_POSTS))||{national:[],regional:{}}; }
  catch(e){ return {national:[],regional:{}}; }
}
function _savePosts(data){ localStorage.setItem(SK_POSTS, JSON.stringify(data)); }

function _loadReactions(){
  try{ return JSON.parse(localStorage.getItem(SK_REACTIONS))||{}; }
  catch(e){ return {}; }
}
function _saveReactions(r){ localStorage.setItem(SK_REACTIONS, JSON.stringify(r)); }

// ── 投稿ID生成 ───────────────────────────────
function _genId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

// ── コミュニティタブ初期化 ───────────────────
function initCommunity(){
  if(_commInited) return;
  _commInited = true;
  _renderScopeTab();
  _renderRegionSelector();
  _renderPosts();
  _loadNickname();
  _updateCharCount();
  _initGoldDisplay();
}

// ── スコープタブ切替 ─────────────────────────
function _renderScopeTab(){
  document.getElementById('comm-tab-national').classList.toggle('active', _commScope==='national');
  document.getElementById('comm-tab-regional').classList.toggle('active', _commScope==='regional');
  document.getElementById('comm-regional-selector').style.display = _commScope==='regional' ? 'block' : 'none';
  _renderPosts();
}

function commSwitchScope(scope){
  _commScope = scope;
  localStorage.setItem(SK_SCOPE, scope);
  _renderScopeTab();
}

// ── 地方・都道府県セレクタ ────────────────────
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
  _renderPosts();
}

function commOnRegionChange(val){
  _commRegion = val;
  localStorage.setItem(SK_REGION, val);
  _updatePrefSelector();
}

function commOnPrefChange(val){
  _commPref = val;
  localStorage.setItem(SK_PREF, val);
  _renderPosts();
}

// ── 投稿一覧レンダリング ─────────────────────
function _renderPosts(){
  const container = document.getElementById('comm-post-list');
  if(!container) return;

  const data = _loadPosts();
  const reactions = _loadReactions();

  let posts;
  if(_commScope === 'national'){
    posts = data.national || [];
  } else {
    posts = (data.regional && data.regional[_commPref]) || [];
  }

  // 新着順・最大COMM_MAX_POSTS件
  posts = posts.slice().reverse().slice(0, COMM_MAX_POSTS);

  if(posts.length === 0){
    container.innerHTML = '<div class="comm-empty">まだ投稿がありません。最初の一言をどうぞ！</div>';
    return;
  }

  container.innerHTML = posts.map(p=>{
    const r = reactions[p.id] || {};
    const hidden = (p.bad||0) >= COMM_BAD_LIMIT;
    if(hidden) return `<div class="comm-post comm-post-hidden"><span>⚠️ 複数のバッド報告により非表示</span></div>`;

    const tagHtml = p.tag ? `<span class="comm-tag">📍${_escHtml(p.tag)}</span>` : '';
    const likeActive = r.like ? ' active' : '';
    const badActive  = r.bad  ? ' active' : '';
    const timeStr = _formatTime(p.ts);

    return `<div class="comm-post" data-id="${p.id}">
  <div class="comm-post-header">
    <span class="comm-nick">${_escHtml(p.nick)}</span>
    ${tagHtml}
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

// ── 投稿送信 ─────────────────────────────────
function commSubmit(){
  const nickEl = document.getElementById('comm-nick-input');
  const textEl = document.getElementById('comm-text-input');

  const nick = (nickEl.value.trim() || '匿名さん').slice(0,20);
  const text = textEl.value.trim();
  const tag  = '';

  // バリデーション
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

  // ニックネーム記憶
  if(nickEl.value.trim()) localStorage.setItem(SK_NICKNAME, nickEl.value.trim());

  // 投稿データ作成
  const post = {
    id:   _genId(),
    nick: nick,
    text: text,
    tag:  tag,
    ts:   now,
    like: 0,
    bad:  0,
  };

  // 保存
  const data = _loadPosts();
  if(_commScope === 'national'){
    data.national = data.national || [];
    data.national.push(post);
    if(data.national.length > 200) data.national = data.national.slice(-200);
  } else {
    data.regional = data.regional || {};
    data.regional[_commPref] = data.regional[_commPref] || [];
    data.regional[_commPref].push(post);
    if(data.regional[_commPref].length > 200) data.regional[_commPref] = data.regional[_commPref].slice(-200);
  }
  _savePosts(data);
  localStorage.setItem(SK_LAST_POST, now.toString());

  // UI更新
  textEl.value = '';
  _updateCharCount();
  _renderPosts();
  _commToast('投稿しました！');
}

// ── リアクション ─────────────────────────────
function commReact(postId, type){
  const data = _loadPosts();
  const reactions = _loadReactions();
  const r = reactions[postId] || {};

  // 対象投稿を探す
  let post = null;
  const allLists = [
    data.national,
    ...Object.values(data.regional||{})
  ];
  for(const list of allLists){
    post = (list||[]).find(p=>p.id===postId);
    if(post) break;
  }
  if(!post) return;

  if(type === 'like'){
    if(r.like){ post.like = Math.max(0,(post.like||0)-1); r.like=false; }
    else { post.like = (post.like||0)+1; r.like=true; }
  } else {
    if(r.bad){ post.bad = Math.max(0,(post.bad||0)-1); r.bad=false; }
    else { post.bad = (post.bad||0)+1; r.bad=true; }
  }

  reactions[postId] = r;
  _savePosts(data);
  _saveReactions(reactions);
  _renderPosts();
}

// ── ニックネーム読み込み ─────────────────────
function _loadNickname(){
  const saved = localStorage.getItem(SK_NICKNAME);
  if(saved) document.getElementById('comm-nick-input').value = saved;
}

// ── 文字数カウント ────────────────────────────
function _updateCharCount(){
  const el = document.getElementById('comm-text-input');
  const cnt = document.getElementById('comm-char-count');
  if(!el||!cnt) return;
  const len = el.value.length;
  cnt.textContent = `${len}/${COMM_MAX_CHARS}`;
  cnt.style.color = len > COMM_MAX_CHARS ? '#ff5a47' : 'var(--txt-sub)';
}

// ── スポットタグセレクタ生成 ─────────────────
function _buildTagSelector(){ /* タグ機能削除済み */ }

// ── 金相場取得 ────────────────────────────────
async function commShowGoldPrice(){
  const btn = document.getElementById('comm-gold-btn');
  btn.disabled = true;
  btn.textContent = '取得中…';

  try {
    // 金価格(USD/oz) 取得 - gold-api.com: 無料・APIキー不要・CORS対応
    const goldRes = await fetch('https://api.gold-api.com/price/XAU');
    if(!goldRes.ok) throw new Error('gold-api ' + goldRes.status);
    const goldJson = await goldRes.json();
    // レスポンス: { price: 4799.9, symbol: "XAU", ... }
    const priceUsdOz = parseFloat(goldJson.price);
    if(!priceUsdOz || isNaN(priceUsdOz)) throw new Error('invalid price');

    // 為替レート(USD→JPY) 取得 - open.er-api.com: 無料・CORS対応・APIキー不要
    const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if(!fxRes.ok) throw new Error('er-api ' + fxRes.status);
    const fxJson = await fxRes.json();
    const rateJpy = fxJson.rates.JPY;

    // 1g換算: 1troy oz = 31.1035g
    const priceJpyG = Math.round(priceUsdOz / 31.1035 * rateJpy);

    // 基準日（今日の日付）
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    const cacheData = {
      price_usd: priceUsdOz,
      rate_jpy: rateJpy,
      price_jpy_g: priceJpyG,
      date: dateStr,
      ts: Date.now()
    };
    // ボタン押すたび上書き保存
    localStorage.setItem(SK_GOLD, JSON.stringify(cacheData));
    _renderGoldDisplay(cacheData);

  } catch(e) {
    _commToast('相場の取得に失敗しました。通信を確認してください。');
    console.warn('[GOLD]', e);
  }

  btn.disabled=false; btn.textContent='💰 金相場';
}

// 金相場をボタン下にインライン表示（記憶済みがあれば起動時にも表示）
function _renderGoldDisplay(d){
  let el = document.getElementById('comm-gold-display');
  if(!el){
    el = document.createElement('div');
    el.id = 'comm-gold-display';
    el.className = 'comm-gold-display';
    // gold-rowの直後に挿入
    const row = document.getElementById('comm-gold-row');
    if(row) row.insertAdjacentElement('afterend', el);
  }
  el.innerHTML =
    `<span class="comm-gold-price">¥${d.price_jpy_g.toLocaleString()}<small>/g</small></span>` +
    `<span class="comm-gold-date">${d.date} 取得　USD/oz $${Math.round(d.price_usd).toLocaleString()}　` +
    `USD/JPY ${d.rate_jpy.toFixed(1)}</span>` +
    `<span class="comm-gold-note">※参考値。実際の買取価格は業者により異なります</span>`;
}

// 起動時に記憶済み金相場を表示
function _initGoldDisplay(){
  try {
    const cached = JSON.parse(localStorage.getItem(SK_GOLD)||'null');
    if(cached) _renderGoldDisplay(cached);
  } catch(e){}
}

// ── ルール折りたたみ ─────────────────────────
function commToggleRule(){
  const body = document.getElementById('comm-rule-body');
  const arrow = document.getElementById('comm-rule-arrow');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arrow.textContent = open ? '▶' : '▼';
}

// ── プレミアムダイアログ ─────────────────────
function commShowPremium(){
  const body = document.getElementById('premium-gate-body');
  const title = document.getElementById('premium-gate-title');
  const icon  = document.getElementById('premium-gate-icon');
  icon.textContent  = '✨';
  title.textContent = 'GOLD MAP プレミアム';
  body.innerHTML =
    '<div style="text-align:left;font-size:12px;line-height:2;padding:4px 0;">' +
    '砂金採取をもっと本格的に。<br><br>' +
    '<b>🗺 高精度ヒートマップ</b><br>' +
    '　全国の砂金採取確率をAI解析でマップ表示<br>' +
    '<b>🐻 熊域リアルタイム警告</b><br>' +
    '　現在地周辺の熊出没エリアを地図に表示<br>' +
    '<b>📥 オフライン完全対応</b><br>' +
    '　圏外エリアでも地図・データを完全使用可能<br>' +
    '<b>🔓 広告非表示・全機能解放</b><br>' +
    '　すべてのデータレイヤーを制限なく利用<br><br>' +
    '<span style="font-size:13px;font-weight:700;color:var(--gold);">月額 ¥480 ／ 年額 ¥3,800</span>' +
    '</div>';
  showDlg('dlg-premium-gate');
}

// ── ユーティリティ ───────────────────────────
function _escHtml(s){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _formatTime(ts){
  const diff = Date.now() - ts;
  if(diff < 60000)   return 'たった今';
  if(diff < 3600000) return Math.floor(diff/60000)+'分前';
  if(diff < 86400000)return Math.floor(diff/3600000)+'時間前';
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