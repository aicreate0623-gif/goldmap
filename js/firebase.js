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
  const btn = document.getElementById('dev-premium-btn');
  if(_devPremium){
    btn.textContent = 'DEV: PREMIUM';
    btn.style.background = 'rgba(50,200,100,0.18)';
    btn.style.borderColor = 'rgba(80,220,120,0.5)';
    btn.style.color = '#80e8a0';
  } else {
    btn.textContent = 'DEV: FREE';
    btn.style.background = 'rgba(255,50,50,0.18)';
    btn.style.borderColor = 'rgba(255,80,80,0.5)';
    btn.style.color = '#ff8888';
  }
}

// ─────────────────────────────────────────────────────
// 課金ユーザー判定
//   Phase2: Firestoreの users/{uid}.premium フラグを参照
//   Phase1: 常に false（スタブ）、dev override あり
// ─────────────────────────────────────────────────────
async function isPremiumUser() {
  if(_devPremium) return true; // 開発用オーバーライド
  // [Phase2 UNCOMMENT] ↓
  // if (!window._fbUid) return false;
  // try {
  //   const doc = await firebase.firestore()
  //     .collection('users').doc(window._fbUid).get();
  //   return doc.exists && doc.data().premium === true;
  // } catch (e) {
  //   console.warn('[firebase.js] isPremiumUser error', e);
  //   return false;
  // }
  return false; // Phase1スタブ
}

// ─────────────────────────────────────────────────────
// 自分の投稿件数を取得
//   Phase2: Firestoreの coords を uid で絞り込み
//   Phase1: localStorage の gm_pts の fsId 付き件数で代替
// ─────────────────────────────────────────────────────
async function getUserPostCount() {
  // [Phase2 UNCOMMENT] ↓
  // if (!window._fbUid) return 0;
  // try {
  //   const snap = await firebase.firestore()
  //     .collection('coords')
  //     .where('uid', '==', window._fbUid)
  //     .get();
  //   return snap.size;
  // } catch (e) {
  //   console.warn('[firebase.js] getUserPostCount error', e);
  //   return 0;
  // }

  // Phase1スタブ: fsId 付きポイントを送信済みとして件数を返す
  try {
    const saved = JSON.parse(localStorage.getItem('gm_pts') || '[]');
    return saved.filter(p => !!p.fsId).length;
  } catch (e) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────
// 課金ゲート表示
//   type: 'point_limit' | 'offline' | 'heatmap_hd'
//   → 各typeで文言を差し替えてモーダル表示
//   → Phase2でCTAのStripeリンクを差し込むだけで完結する構造
// ─────────────────────────────────────────────────────
function showPremiumGate(type) {
  const GATE_CONTENT = {
    point_limit: {
      icon:  '📍',
      title: 'ポイント上限に達しました',
      body:  `無料プランでは最大 ${FREE_POINT_LIMIT} 件まで保存できます。\nプレミアムプランにアップグレードすると、ポイントを無制限に保存できます。`,
    },
    offline: {
      icon:  '⬇',
      title: 'オフライン機能はプレミアム',
      body:  'タイルのダウンロード・オフライン利用はプレミアムプランの機能です。\nアップグレードすると電波のない山中でも地図を使えます。',
    },
    heatmap_hd: {
      icon:  '🔥',
      title: '高解像度ヒートマップはプレミアム',
      body:  '高解像度の砂金分布ヒートマップはプレミアムプランの機能です。\nまた、自分のポイントを1件以上投稿していることが条件です。',
    },
  };

  const c = GATE_CONTENT[type] || GATE_CONTENT['point_limit'];
  document.getElementById('premium-gate-icon').textContent  = c.icon;
  document.getElementById('premium-gate-title').textContent = c.title;
  document.getElementById('premium-gate-body').textContent  = c.body;
  showDlg('dlg-premium-gate');
}

// ─────────────────────────────────────────────────────
// 課金フロー起動（Phase2: Stripe決済画面へ遷移）
// ─────────────────────────────────────────────────────
function startPurchaseFlow() {
  closeOv();
  // [Phase2 UNCOMMENT] ↓
  // window.location.href = 'https://buy.stripe.com/xxxx';
  showAlert('準備中', 'サブスクリプション機能は近日公開予定です。');
}

// ─────────────────────────────────────────────────────
// 座標を Firestore に投稿
// ─────────────────────────────────────────────────────
async function submitCoord(lat, lng) {
  const db = firebase.firestore();
  const ref = await db.collection('coords').add({
    lat, lng,
    uid: window._fbUid || 'anonymous',
    ts:  firebase.firestore.FieldValue.serverTimestamp(),
  });
  console.log('[firebase.js] submitCoord OK', lat, lng, 'fsId=', ref.id);
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
// Firestoreから投稿座標を取得してヒートマップに追加
// ─────────────────────────────────────────────────────
async function fetchHeatPoints() {
  const premium = await isPremiumUser();
  if (!premium) return;

  const db = firebase.firestore();
  const snap = await db.collection('coords').get();
  const points = snap.docs.map(d => ({
    lat: d.data().lat, lng: d.data().lng, weight: 1.0
  }));
  addHeatPoints(points);
}
