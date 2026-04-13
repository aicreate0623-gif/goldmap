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
let _devVip     = false; // デフォルト: VIPなし

function devTogglePremium(){
  _devPremium = !_devPremium;
  // 左下フロートボタン
  const btn = document.getElementById('dev-premium-btn');
  // 設定タブ内インラインボタン（heat-ctrl-panel内）
  const btnInline = document.getElementById('dev-premium-inline');
  const label = _devPremium ? 'PREMIUM ✓' : 'FREE';
  const bg    = _devPremium ? 'rgba(50,200,100,0.18)' : 'rgba(255,50,50,0.18)';
  const bc    = _devPremium ? 'rgba(80,220,120,0.5)'  : 'rgba(255,80,80,0.5)';
  const col   = _devPremium ? '#80e8a0' : '#ff8888';
  [btn, btnInline].forEach(b => {
    if(!b) return;
    b.textContent   = (b === btn ? 'DEV: ' : '') + label;
    b.style.background   = bg;
    b.style.borderColor  = bc;
    b.style.color        = col;
  });
}

function devToggleVip(){
  _devVip = !_devVip;
  const btn = document.getElementById('dev-vip-btn');
  if(!btn) return;
  if(_devVip){
    btn.textContent      = 'VIP: ON ✓';
    btn.style.background = 'rgba(160,80,255,0.22)';
    btn.style.borderColor= 'rgba(180,100,255,0.6)';
    btn.style.color      = '#c880ff';
    // VIP ON時はPremiumボタンも連動して見た目を更新
    const btnP = document.getElementById('dev-premium-btn');
    const btnI = document.getElementById('dev-premium-inline');
    [btnP, btnI].forEach(b => {
      if(!b) return;
      b.textContent      = (b === btnP ? 'DEV: ' : '') + 'PREMIUM ✓';
      b.style.background = 'rgba(50,200,100,0.18)';
      b.style.borderColor= 'rgba(80,220,120,0.5)';
      b.style.color      = '#80e8a0';
    });
  } else {
    btn.textContent      = 'VIP: OFF';
    btn.style.background = 'rgba(255,50,50,0.18)';
    btn.style.borderColor= 'rgba(255,80,80,0.5)';
    btn.style.color      = '#ff8888';
    // VIP OFFにしてもPremiumフラグが独立してONなら見た目はそのまま
    // Premiumが独立してOFFならPremiumボタンもFREEに戻す
    if(!_devPremium){
      const btnP = document.getElementById('dev-premium-btn');
      const btnI = document.getElementById('dev-premium-inline');
      [btnP, btnI].forEach(b => {
        if(!b) return;
        b.textContent      = (b === btnP ? 'DEV: ' : '') + 'FREE';
        b.style.background = 'rgba(255,50,50,0.18)';
        b.style.borderColor= 'rgba(255,80,80,0.5)';
        b.style.color      = '#ff8888';
      });
    }
  }
}

// ─────────────────────────────────────────────────────
// 課金ユーザー判定
//   Phase2: Firestoreの users/{uid}.premium フラグを参照
//   Phase1: 常に false（スタブ）、dev override あり
// ─────────────────────────────────────────────────────
async function isPremiumUser() {
  if(_devVip)     return true; // VIP ON はPremiumも全解放
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
// VIPユーザー判定
//   Phase2: Firestoreの users/{uid}.vip フラグを参照
//   Phase1: _devVip のみ
// ─────────────────────────────────────────────────────
async function isVipUser() {
  if(_devVip) return true; // 開発用オーバーライド
  // [Phase2 UNCOMMENT] ↓
  // if (!window._fbUid) return false;
  // try {
  //   const doc = await firebase.firestore()
  //     .collection('users').doc(window._fbUid).get();
  //   return doc.exists && doc.data().vip === true;
  // } catch (e) {
  //   console.warn('[firebase.js] isVipUser error', e);
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
      title: '高解像度ヒートマップ（HD）',
      body:  '📍 フリー版との違い:\n・約10km単位 → 約1.5km単位の精度に向上\n・zoom9以上に拡大して集落レベルで確認可能\n・採取報告データをより細かく反映\n\nプレミアムプラン + 自分のポイント投稿1件以上で利用できます。',
    },
    heatmap_vip: {
      icon:  '⭐',
      title: '超高解像度ヒートマップ（VIP）',
      body:  '🗺 HDとの違い:\n・約1.5km → 約100m単位の超高精度\n・zoom13以上に拡大して川筋・淵レベルで確認可能\n・VIPプラン限定の詳細採取データを反映\n\nVIPプランは近日公開予定です。',
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
async function submitCoord(lat, lng, stars) {
  const db = firebase.firestore();
  const ref = await db.collection('coords').add({
    lat, lng,
    stars: stars || 0,
    uid: window._fbUid || 'anonymous',
    ts:  firebase.firestore.FieldValue.serverTimestamp(),
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
