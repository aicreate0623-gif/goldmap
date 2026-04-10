'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// firebase.js  Firebase連携（Phase2スタブ）
//
// 【現在の状態】
//   全関数はスタブとして定義済み。
//   中身は空 or 即時 resolve のため既存動作に影響なし。
//
// 【Phase2で実装する内容】
//   1. Firebase初期化（firebaseConfig を環境変数から注入）
//   2. Anonymous Auth によるユーザーID取得
//   3. Firestore への座標投稿（submitCoord）
//   4. 課金フラグ確認（isPremiumUser）
//   5. ポイント3件制限チェック（checkPointLimit）
//      → 4件目保存時に確認ダイアログを表示
//   6. ヒートマップ用投稿座標の取得（fetchHeatPoints）
//      → addHeatPoints() に渡す
//
// 【Phase4: Play Billing 拡張ポイント】
//   isPremiumUser() の実装を Google Play Billing API
//   (Capacitor plugin) の購読確認に差し替え。
//   課金確認ダイアログは showPremiumDialog() で表示。
//
// 依存: ui.js (showAlert, switchTab), map.js (addHeatPoints)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Firebase設定（Phase2で実際の値を入れる）──────────
// const FIREBASE_CONFIG = {
//   apiKey:            "YOUR_API_KEY",
//   authDomain:        "YOUR_PROJECT.firebaseapp.com",
//   projectId:         "YOUR_PROJECT_ID",
//   storageBucket:     "YOUR_PROJECT.appspot.com",
//   messagingSenderId: "XXXXXXXXXX",
//   appId:             "1:XXXXXXXXXX:web:XXXXXXXXXX",
// };

// ── 課金プロダクトID（Phase4: Play Billing）──────────
// const PREMIUM_PRODUCT_ID = 'gold_map_premium_monthly';

// ── フリープランのポイント上限 ────────────────────────
const FREE_PLAN_LIMIT = 3;

// ─────────────────────────────────────────────────────
// 初期化（Phase2: firebase/app と firebase/auth を import）
// ─────────────────────────────────────────────────────
async function initFirebase() {
  // [PHASE2] firebase SDK を CDN から読み込み済みの前提で
  // initializeApp(FIREBASE_CONFIG) を呼ぶ
  // const app  = firebase.initializeApp(FIREBASE_CONFIG);
  // const auth = firebase.auth();
  // await auth.signInAnonymously();
  // window._fbUid = auth.currentUser.uid;
  console.log('[firebase.js] stub: initFirebase called (no-op)');
}

// ─────────────────────────────────────────────────────
// 課金ユーザー判定
//   戻り値: Promise<boolean>
// ─────────────────────────────────────────────────────
async function isPremiumUser() {
  // [PHASE2] Firestore の users/{uid}.premium フラグを確認
  // [PHASE4] Google Play Billing の購読ステータスを確認
  return false; // スタブ: 常に無料ユーザー扱い
}

// ─────────────────────────────────────────────────────
// ポイント保存前の制限チェック
//   pts: 現在のポイント配列（points.js の pts）
//   戻り値: Promise<boolean>  true=保存続行 / false=キャンセル
// ─────────────────────────────────────────────────────
async function checkPointLimit(pts) {
  // [PHASE2] FREE_PLAN_LIMIT を超えた 4件目の保存時に
  // 課金確認ダイアログを表示する。
  // 例:
  //   if (pts.length >= FREE_PLAN_LIMIT) {
  //     const premium = await isPremiumUser();
  //     if (!premium) {
  //       showPremiumDialog();
  //       return false;
  //     }
  //   }
  return true; // スタブ: 常に保存続行
}

// ─────────────────────────────────────────────────────
// 座標を Firestore に投稿（匿名ユーザー）
//   lat, lng: 数値
// ─────────────────────────────────────────────────────
async function submitCoord(lat, lng) {
  // [PHASE2] Firestore の coords コレクションに追記
  // await db.collection('coords').add({
  //   lat, lng,
  //   uid: window._fbUid || 'anonymous',
  //   ts:  firebase.firestore.FieldValue.serverTimestamp(),
  // });
  console.log(`[firebase.js] stub: submitCoord(${lat.toFixed(5)}, ${lng.toFixed(5)}) (no-op)`);
}

// ─────────────────────────────────────────────────────
// Firestoreから投稿座標を取得してヒートマップに追加
//   課金ユーザーのみ呼び出す
// ─────────────────────────────────────────────────────
async function fetchHeatPoints() {
  // [PHASE2] Firestore の coords コレクションを取得し
  // addHeatPoints([{lat, lng, weight: 1.0}, ...]) を呼ぶ
  //
  // isPremiumUser() が false の場合は早期 return する。
  const premium = await isPremiumUser();
  if (!premium) return;

  // const snap = await db.collection('coords').get();
  // const points = snap.docs.map(d => ({
  //   lat: d.data().lat, lng: d.data().lng, weight: 1.0
  // }));
  // addHeatPoints(points);
  console.log('[firebase.js] stub: fetchHeatPoints called (no-op)');
}

// ─────────────────────────────────────────────────────
// 課金誘導ダイアログ表示
//   [PHASE4] Play Billing の購入フローを呼び出す
// ─────────────────────────────────────────────────────
function showPremiumDialog() {
  // [PHASE2] showAlert() でシンプルな案内を表示
  // [PHASE4] Capacitor Play Billing plugin の purchase() を呼ぶ
  //   window.AppBilling?.purchase(PREMIUM_PRODUCT_ID);
  showAlert(
    'プレミアム機能',
    '無料プランではポイントを' + FREE_PLAN_LIMIT + '件まで保存できます。\n' +
    'プレミアムプランにアップグレードすると無制限に保存・\n' +
    'ヒートマップ閲覧・オフライン機能が利用できます。'
  );
}
