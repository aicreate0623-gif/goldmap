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

// ── フリープランのポイント上限 ────────────────────────
const FREE_PLAN_LIMIT = 3;

// ─────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────
async function initFirebase() {
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  await auth.signInAnonymously();
  window._fbUid = auth.currentUser.uid;
  console.log('[firebase.js] initFirebase OK uid=', window._fbUid);
}

// ─────────────────────────────────────────────────────
// 課金ユーザー判定（Phase4で実装）
// ─────────────────────────────────────────────────────
async function isPremiumUser() {
  return false; // スタブ: 常に無料ユーザー扱い
}

// ─────────────────────────────────────────────────────
// ポイント保存前の制限チェック
// ─────────────────────────────────────────────────────
async function checkPointLimit(pts) {
  return true; // スタブ: 常に保存続行
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
  return ref.id; // ← ドキュメントIDを返す
}

// ─────────────────────────────────────────────────────
// Firestoreからドキュメントを削除
//   fsId: submitCoord() が返したドキュメントID
// ─────────────────────────────────────────────────────
async function deleteCoord(fsId) {
  if(!fsId) return;
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

// ─────────────────────────────────────────────────────
// 課金誘導ダイアログ（Phase4で実装）
// ─────────────────────────────────────────────────────
function showPremiumDialog() {
  showAlert(
    'プレミアム機能',
    '無料プランではポイントを' + FREE_PLAN_LIMIT + '件まで保存できます。\n' +
    'プレミアムプランにアップグレードすると無制限に保存・\n' +
    'ヒートマップ閲覧・オフライン機能が利用できます。'
  );
}
