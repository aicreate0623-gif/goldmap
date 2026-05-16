'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// firebase.js  Firebase連携（Phase2）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDuzADkKiAvP1HRUn1YZe_jm3BZt6O-8pc",
  authDomain:        "goldmap-b531a.firebaseapp.com",
  projectId:         "goldmap-b531a",
  storageBucket:     "goldmap-b531a.firebasestorage.app",
  messagingSenderId: "876401235278",
  appId:             "1:876401235278:web:bbf7d2491ac3f49357fa1f"
};

// ── プラン制限定数 ────────────────────────────
const FREE_POINT_LIMIT = 3;   // 無料ユーザーのポイント保存上限

// ─────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────
async function initFirebase() {
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();

  await new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      unsubscribe();
      if (user) {
        window._fbUid = user.uid;
        console.log('[firebase.js] initFirebase OK uid=', window._fbUid);
        resolve();
      } else {
        reject(new Error('auth user is null'));
      }
    });
    auth.signInAnonymously().catch(reject);
  });
}

// ── 開発用: 課金状態オーバーライド ──────────────
let _devPremium = false; // デフォルト: 無料

function devTogglePremium(){
  _devPremium = !_devPremium;
  const btn   = document.getElementById('dev-premium-btn');
  if(!btn) return;
  const label = _devPremium ? 'PREMIUM ✓' : 'FREE';
  btn.textContent      = 'DEV: ' + label;
  btn.style.background = _devPremium ? 'rgba(50,200,100,0.18)' : 'rgba(255,50,50,0.18)';
  btn.style.borderColor= _devPremium ? 'rgba(80,220,120,0.5)'  : 'rgba(255,80,80,0.5)';
  btn.style.color      = _devPremium ? '#80e8a0' : '#ff8888';
}

// ─────────────────────────────────────────────────────
// 課金ユーザー判定
//   起動時に1回だけFirestoreリード → セッション中はメモリキャッシュを返す
//   Firestore失敗時はlocalStorageキャッシュにフォールバック
// ─────────────────────────────────────────────────────
const _SK_PREMIUM = 'gm_premium_cache';
let _premiumCache = null;  // null=未取得、true/false=取得済み

async function isPremiumUser() {
  if (_devPremium) return true;
  // セッションキャッシュがあれば即返す（Firestoreリードなし）
  if (_premiumCache !== null) return _premiumCache;
  if (!window._fbUid) return _getCachedPremium();
  try {
    const doc = await firebase.firestore()
      .collection('users').doc(window._fbUid).get();
    _premiumCache = doc.exists && doc.data().premium === true;
    // localStorageにも保存（次回起動時の即時反映用）
    localStorage.setItem(_SK_PREMIUM, _premiumCache ? '1' : '0');
    console.log('[firebase.js] isPremiumUser fetched =', _premiumCache);
    return _premiumCache;
  } catch (e) {
    console.warn('[firebase.js] isPremiumUser error', e);
    // Firestore失敗時はlocalStorageキャッシュを使う
    _premiumCache = _getCachedPremium();
    return _premiumCache;
  }
}

function _getCachedPremium() {
  return localStorage.getItem(_SK_PREMIUM) === '1';
}

// ─────────────────────────────────────────────────────
// 自分の投稿件数を取得
//
//   【移行フォールバック戦略 (Option B)】
//   Firestoreの実件数が0でも、localStorageにポイントが
//   存在すれば1以上を返す。Phase1時代に contrib ON で
//   使っていたユーザーがヒートマップを閲覧できなくなる
//   問題を防ぐ。Firestoreへの実投稿が進めば自然に
//   Firestore件数が優先される。
// ─────────────────────────────────────────────────────
async function getUserPostCount() {
  if (!window._fbUid) return _localPostCountFallback();
  try {
    const snap = await firebase.firestore()
      .collection('coords')
      .where('uid', '==', window._fbUid)
      .get();
    // Firestore 0件かつ localStorage にポイントがあれば
    // 移行期間中の互換性としてローカル件数を返す
    if (snap.size === 0) return _localPostCountFallback();
    return snap.size;
  } catch (e) {
    console.warn('[firebase.js] getUserPostCount error', e);
    return _localPostCountFallback();
  }
}

// localStorage のポイント件数（fsId 問わず全件）
function _localPostCountFallback() {
  try {
    const saved = JSON.parse(localStorage.getItem('gm_pts') || '[]');
    return saved.length;
  } catch (e) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────
// 課金ゲート表示
//   type: 'point_limit' | 'offline' | 'mymap' | 'bear_layer' | 'water_level' | 'heatmap_pro'
// ─────────────────────────────────────────────────────
function showPremiumGate(type) {
  // プレミアム機能一覧（共通フッター用）
  const PREMIUM_LIST =
    '<div class="gate-premium-list">' +
    '<div>🗺 高精度ヒートマップPro</div>' +
    '<div>⬇ オフライン地図ダウンロード</div>' +
    '<div>📂 マイMAP作成</div>' +
    '<div>🐻 熊生息ヒートマップ</div>' +
    '<div>💧 水位・河川警戒情報</div>' +
    '<div>📍 ポイント記録 無制限</div>' +
    '</div>' +
    '<div class="gate-price">月額 ¥480 ／ 年額 ¥3,800</div>';

  const GATE_CONTENT = {
    point_limit: {
      icon:  '📍',
      title: 'ポイント上限に達しました',
      body:  `<p>無料プランでは最大 <b>${FREE_POINT_LIMIT} 件</b>まで保存できます。</p>` +
             `<p>プレミアムにアップグレードするとポイントを<b>無制限</b>に保存できます。</p>` +
             PREMIUM_LIST,
    },
    offline: {
      icon:  '⬇',
      title: 'オフライン地図はプレミアム機能です',
      body:  '<p>地図タイルのダウンロードはプレミアム機能です。<br>' +
             '電波のない山中でも地図・データを完全に利用できます。</p>' +
             PREMIUM_LIST,
    },
    mymap: {
      icon:  '📂',
      title: 'マイMAPはプレミアム機能です',
      body:  '<p>GeoJSON・CSVをインポートして地図上に表示する<b>マイMAP</b>はプレミアム機能です。<br>' +
             '最大10セットのデータを端末内に保存・管理できます。</p>' +
             PREMIUM_LIST,
    },
    bear_layer: {
      icon:  '🐻',
      title: '熊生息ヒートマップはプレミアム機能です',
      body:  '<p>全国の熊出没データを集計した<b>生息域ヒートマップ</b>と' +
             '直近90日の出没ピンはプレミアム機能です。</p>' +
             PREMIUM_LIST,
    },
    water_level: {
      icon:  '💧',
      title: '水位・河川警戒情報はプレミアム機能です',
      body:  '<p>国土交通省の河川水位データをリアルタイム取得し、' +
             '警戒レベルを地図上に表示する機能はプレミアム機能です。</p>' +
             PREMIUM_LIST,
    },
    heatmap_pro_no_post: {
      icon:  '📍',
      title: 'ポイント投稿が必要です',
      body:  '<p>ヒートマップProを利用するには、採取ポイントを<b>1件以上投稿</b>している必要があります。</p>' +
             '<p>地図上でポイントを登録し、「ヒートマップに協力」をONにして投稿してください。</p>',
    },
    heatmap_pro_revoked: {
      icon:  '⚠️',
      title: 'ヒートマップProを停止しました',
      body:  '<p>投稿済みのポイントが0件になったため、ヒートマップProを停止しました。</p>' +
             '<p>ポイントを1件以上投稿すると再度ご利用いただけます。</p>',
    },
    heatmap_pro: {
      icon:  '',
      title: '✨ ヒートマップPro（月額480円）',
      body:  '<div class="gate-catchcopy">「この町のどこか」から「この川のどこか」へ</div>' +
             '<div class="gate-section">' +
             '🗺 フリー版の<b>約10倍の解像度</b>で表示。場所選定の精度を高めます。<br>' +
             '🔥 ユーザー投稿を匿名集計・毎日3時更新。位置はランダムにずらして使用します。' +
             '</div>' +
             '<div class="gate-note">' +
             '<span class="gate-note-alert">※ ポイント投稿が1件以上必要です。</span><br>' +
             '※ 採取を保証するものではありません。解約はいつでも可能です。' +
             '</div>',
    },
  };

  const c = GATE_CONTENT[type] || GATE_CONTENT['point_limit'];
  const iconEl = document.getElementById('premium-gate-icon');
  iconEl.textContent   = c.icon;
  iconEl.style.display = c.icon ? '' : 'none';
  document.getElementById('premium-gate-title').textContent = c.title;
  document.getElementById('premium-gate-body').innerHTML    = c.body;
  showDlg('dlg-premium-gate');
}

// ─────────────────────────────────────────────────────
// 課金フロー起動（Phase2: Stripe決済画面へ遷移）
// ─────────────────────────────────────────────────────
function startPurchaseFlow() {
  closeOv();
  // [Phase3 UNCOMMENT] ↓ Stripe決済URL確定後に有効化
  // window.location.href = 'https://buy.stripe.com/xxxx';
  showAlert('準備中', 'サブスクリプション機能は近日公開予定です。');
}

// ─────────────────────────────────────────────────────
// 座標を Firestore に投稿
// ─────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────
// 禁止ワード管理
//   Firestoreの banned_words コレクションから取得
//   { word: string, matchType: 'exact'|'contains' }
//   取得結果は localStorage に1時間キャッシュ
// ─────────────────────────────────────────────────────
const _SK_BANNED      = 'gm_banned_words';
const _SK_BANNED_TS   = 'gm_banned_words_ts';
const _BANNED_TTL     = 60 * 60 * 1000; // 1時間

let _bannedWords = null; // メモリキャッシュ

async function _loadBannedWords() {
  // メモリキャッシュあり
  if (_bannedWords !== null) return _bannedWords;

  // localStorageキャッシュが有効期限内
  const cachedTs = parseInt(localStorage.getItem(_SK_BANNED_TS) || '0', 10);
  if (Date.now() - cachedTs < _BANNED_TTL) {
    try {
      _bannedWords = JSON.parse(localStorage.getItem(_SK_BANNED) || '[]');
      return _bannedWords;
    } catch(e) {}
  }

  // Firestoreから取得
  try {
    const snap = await firebase.firestore().collection('banned_words').get();
    _bannedWords = snap.docs.map(d => ({
      word:      (d.data().word || '').toLowerCase(),
      matchType: d.data().matchType || 'contains',
    })).filter(b => b.word.length > 0);
    localStorage.setItem(_SK_BANNED, JSON.stringify(_bannedWords));
    localStorage.setItem(_SK_BANNED_TS, String(Date.now()));
    console.log('[firebase.js] banned_words loaded:', _bannedWords.length, '件');
  } catch(e) {
    console.warn('[firebase.js] banned_words 取得失敗', e);
    _bannedWords = [];
  }
  return _bannedWords;
}

function _hasBannedWord(name, memo) {
  if (!_bannedWords || _bannedWords.length === 0) return false;
  const text = ((name || '') + ' ' + (memo || '')).toLowerCase();
  return _bannedWords.some(b => {
    if (b.matchType === 'exact') return text.split(/\s+/).includes(b.word);
    return text.includes(b.word); // contains（部分一致）
  });
}

// ─────────────────────────────────────────────────────
// 投稿フィルター
//   戻り値: { ok: true } or { ok: false, msg: string, silent: boolean }
// ─────────────────────────────────────────────────────
const _SK_LAST_SUBMIT    = 'gm_last_submit';    // { ts, lat, lng }
const SUBMIT_INTERVAL_MS = 60 * 1000;           // 60秒
const SUBMIT_MIN_DIST_M  = 100;                 // 100m

// 2点間の距離(m) ハバーサイン簡易版
function _distanceM(lat1, lng1, lat2, lng2) {
  const R   = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a   = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function _checkSubmitFilter(lat, lng, name, memo) {
  // ① 日本国内座標チェック
  if (lat < 20 || lat > 46 || lng < 122 || lng > 154) {
    return { ok: false, msg: '📍 この座標は対応エリア外です（日本国内のみ）', silent: false };
  }

  // ② 短時間連投チェック
  try {
    const last = JSON.parse(localStorage.getItem(_SK_LAST_SUBMIT) || 'null');
    if (last && (Date.now() - last.ts) < SUBMIT_INTERVAL_MS) {
      const remain = Math.ceil((SUBMIT_INTERVAL_MS - (Date.now() - last.ts)) / 1000);
      return { ok: false, msg: `⏱ 連続投稿はしばらくお待ちください（あと約${remain}秒）`, silent: false };
    }
  } catch(e) {}

  // ③ 同一座標連投チェック
  try {
    const last = JSON.parse(localStorage.getItem(_SK_LAST_SUBMIT) || 'null');
    if (last && _distanceM(lat, lng, last.lat, last.lng) < SUBMIT_MIN_DIST_M) {
      return { ok: false, msg: '📍 近くに既に投稿があります（100m以内）', silent: false };
    }
  } catch(e) {}

  // ④ 禁止ワードチェック
  await _loadBannedWords();
  if (_hasBannedWord(name, memo)) {
    console.warn('[firebase.js] banned_word hit → silent drop');
    return { ok: false, msg: '', silent: true }; // 静かに無視
  }

  return { ok: true };
}

// ── 金関連キーワード判定 ──────────────────────────────
const GOLD_KEYWORDS = [
  '金', 'GOLD', 'gold', '砂金', 'ナゲット', '草根引き', 'パンニング',
  'グレイン', 'スルース', 'ドレッジ', '寄せ場', 'さきん', 'きん',
  'なげっと', 'くさねびき', 'ぱんにんぐ', 'ぐれいん', 'よせば', 'どれっじ',
  '草ねびき', '草根びき',
];
function _isGoldKeyword(name, memo) {
  const text = (name || '') + ' ' + (memo || '');
  return GOLD_KEYWORDS.some(kw => text.includes(kw));
}

// ── 品質スコア判定（3段階）────────────────────────
function _calcQuality(stars, name, memo) {
  if ((stars || 0) >= 2 && (memo || '').trim().length > 0) return 'HIGH';
  if ((stars || 0) >= 1 || ((name || '').trim().length > 0 && name !== 'ポイント')) return 'MID';
  return 'LOW';
}

async function submitCoord(lat, lng, stars, name, memo) {
  // ── 投稿フィルター ──────────────────────────────────
  const check = await _checkSubmitFilter(lat, lng, name, memo);
  if (!check.ok) {
    if (!check.silent && check.msg) {
      if (typeof showToast === 'function') showToast(check.msg, 3000, 'error');
    }
    // silentの場合は成功に見せるためfsIdの代わりにnullを返す
    return check.silent ? null : Promise.reject(new Error(check.msg));
  }

  const db  = firebase.firestore();
  const ref = await db.collection('coords').add({
    lat, lng,
    stars:   stars || 0,
    isGold:  _isGoldKeyword(name, memo),
    quality: _calcQuality(stars, name, memo),
    uid:     window._fbUid || 'anonymous',
    date:    new Date().toISOString().slice(0, 10),
    ts:      firebase.firestore.FieldValue.serverTimestamp(),
  });

  // 最終投稿記録を更新
  try {
    localStorage.setItem(_SK_LAST_SUBMIT, JSON.stringify({ ts: Date.now(), lat, lng }));
  } catch(e) {}

  console.log('[firebase.js] submitCoord OK', lat, lng, 'stars=', stars,
              'isGold=', _isGoldKeyword(name, memo), 'fsId=', ref.id);
  return ref.id;
}

// ─────────────────────────────────────────────────────
// Firestoreからドキュメントを削除
// ─────────────────────────────────────────────────────
async function deleteCoord(fsId) {
  if (!fsId) return;
  const db = firebase.firestore();
  await db.collection('coords').doc(fsId).delete();
  console.log('[firebase.js] deleteCoord OK fsId=', fsId);
}

// ─────────────────────────────────────────────────────
// heatmap.json を fetch してヒートマップに反映
//   Pro版  → paid（クラスタ条件済みデータ）
//   free版 → free（全件グリッドデータ）
// ─────────────────────────────────────────────────────
async function fetchHeatPoints() {
  // PRO起動済みのプレミアムユーザーのみ呼ばれる想定
  // （openHeatProGate()の④から呼ばれる）

  let json;
  try {
    const res = await fetch('./data/heatmap.json?_=' + Date.now());
    if (!res.ok) {
      console.warn('[firebase.js] heatmap.json fetch失敗', res.status);
      return;
    }
    json = await res.json();
  } catch (e) {
    console.warn('[firebase.js] heatmap.json fetch error', e);
    return;
  }

  const tier = 'paid';
  const fc   = json[tier];
  if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) {
    console.log('[firebase.js] heatmap.json: データなし tier=', tier);
    return;
  }

  const points = fc.features.map(f => ({
    lat:    f.geometry.coordinates[1],
    lng:    f.geometry.coordinates[0],
    weight: f.properties.weight ?? 1.0,
  }));
  addHeatPoints(points);
  console.log('[firebase.js] fetchHeatPoints OK tier=', tier, 'points=', points.length,
              'generated_at=', json.generated_at);
}
// ── 初期化 ──────────────────────────────────
(async () => {
  try {
    await initFirebase();
    await fetchHeatPoints();
  } catch (e) {
    console.warn('[firebase.js] Firebase init / fetchHeatPoints 失敗', e);
  }
})();
