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
//   Firestoreの users/{uid}.premium フラグを参照
//   取得成功時はlocalStorageにキャッシュ（起動時に即時反映）
// ─────────────────────────────────────────────────────
const _SK_PREMIUM = 'gm_premium_cache';

async function isPremiumUser() {
  if(_devPremium) return true;
  if (!window._fbUid) return _getCachedPremium();
  try {
    const doc = await firebase.firestore()
      .collection('users').doc(window._fbUid).get();
    const premium = doc.exists && doc.data().premium === true;
    // 取得成功時はキャッシュ更新
    localStorage.setItem(_SK_PREMIUM, premium ? '1' : '0');
    return premium;
  } catch (e) {
    console.warn('[firebase.js] isPremiumUser error', e);
    // Firestore失敗時はキャッシュを使う（フラグ維持）
    return _getCachedPremium();
  }
}

function _getCachedPremium(){
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
async function submitCoord(lat, lng, stars) {
  const db  = firebase.firestore();
  const ref = await db.collection('coords').add({
    lat, lng,
    stars: stars || 0,
    uid:  window._fbUid || 'anonymous',
    date: new Date().toISOString().slice(0, 10),
    ts:   firebase.firestore.FieldValue.serverTimestamp(),
  });
  console.log('[firebase.js] submitCoord OK', lat, lng, 'stars=', stars, 'fsId=', ref.id);
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
  const premium   = await isPremiumUser();
  // free tier は JS固定データのみのため fetch 不要
  if (!premium) {
    console.log('[firebase.js] fetchHeatPoints skip: free tier uses static data only');
    return;
  }
  const postCount = await getUserPostCount();
  if (postCount < 1) return;

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
