// =============================================================================
// 熊出没レイヤー (bears layer) v2 - 県フィルタ対応版
// map.js の末尾に追記する。
// 依存: map (L.Map インスタンス) が既に存在すること。
// =============================================================================

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const BEARS_JSON_URL = "data/bears.json";

const BEAR_COLOR_FRESH  = "#e53935"; // 30日以内  → 赤
const BEAR_COLOR_RECENT = "#fb8c00"; // 90日以内  → オレンジ
const BEAR_COLOR_OLD    = "#757575"; // それ以降  → グレー

/**
 * KML 対応県マスタ。
 * kml: true  → データあり（選択可能）
 * kml: false → データなし（グレーアウト）
 *
 * 「島根県・鳥取県」は 1 KML ソースから生成されるため
 * bears.json の r.pref が "島根県・鳥取県" になる。
 * UI では「島根県」「鳥取県」をグレーアウトし
 * 「島根県・鳥取県（合算）」を KML 対応として表示する。
 */
const BEAR_PREF_LIST = [
  { pref: "北海道",         kml: false },
  { pref: "青森県",         kml: true  },
  { pref: "岩手県",         kml: false },
  { pref: "宮城県",         kml: true  },
  { pref: "秋田県",         kml: false },
  { pref: "山形県",         kml: true  },
  { pref: "福島県",         kml: false },
  { pref: "茨城県",         kml: false },
  { pref: "栃木県",         kml: true  },
  { pref: "群馬県",         kml: false },
  { pref: "埼玉県",         kml: false },
  { pref: "千葉県",         kml: false },
  { pref: "東京都",         kml: false },
  { pref: "神奈川県",       kml: false },
  { pref: "新潟県",         kml: false },
  { pref: "富山県",         kml: true  },
  { pref: "石川県",         kml: true  },
  { pref: "福井県",         kml: false },
  { pref: "山梨県",         kml: false },
  { pref: "長野県",         kml: false },
  { pref: "岐阜県",         kml: false },
  { pref: "静岡県",         kml: true  },
  { pref: "愛知県",         kml: false },
  { pref: "三重県",         kml: false },
  { pref: "滋賀県",         kml: true  },
  { pref: "京都府",         kml: false },
  { pref: "大阪府",         kml: false },
  { pref: "兵庫県",         kml: false },
  { pref: "奈良県",         kml: true  },
  { pref: "和歌山県",       kml: false },
  { pref: "島根県・鳥取県", kml: true  }, // bears.json の実際の pref 値
  { pref: "岡山県",         kml: false },
  { pref: "広島県",         kml: false },
  { pref: "山口県",         kml: false },
  { pref: "徳島県",         kml: false },
  { pref: "香川県",         kml: false },
  { pref: "愛媛県",         kml: false },
  { pref: "高知県",         kml: false },
  { pref: "福岡県",         kml: false },
  { pref: "佐賀県",         kml: false },
  { pref: "長崎県",         kml: false },
  { pref: "熊本県",         kml: false },
  { pref: "大分県",         kml: false },
  { pref: "宮崎県",         kml: false },
  { pref: "鹿児島県",       kml: false },
  { pref: "沖縄県",         kml: false },
];

// 「全 KML 対応県を表示」を示す特殊値
const BEAR_PREF_ALL_VALUE = "__all__";

// ---------------------------------------------------------------------------
// モジュールスコープ変数
// ---------------------------------------------------------------------------

let bearLayer        = L.layerGroup();       // デフォルト非表示
let bearData         = [];                   // 全レコードキャッシュ
let bearFilteredPref = BEAR_PREF_ALL_VALUE;  // 現在の県フィルタ

// ---------------------------------------------------------------------------
// ユーティリティ（プライベート）
// ---------------------------------------------------------------------------

function _bearDaysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d)) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function _bearColor(daysAgo) {
  if (daysAgo <= 30) return BEAR_COLOR_FRESH;
  if (daysAgo <= 90) return BEAR_COLOR_RECENT;
  return BEAR_COLOR_OLD;
}

function _bearIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div class="bear-pin" style="--bear-color:${color}"><span class="bear-pin__emoji">🐻</span></div>`,
    iconSize:    [32, 32],
    iconAnchor:  [16, 32],
    popupAnchor: [0, -34],
  });
}

function _bearPopupHtml(r) {
  const dateLabel  = r.date  || "日時不明";
  const placeLabel = r.place || "場所不明";
  const detailHtml = r.detail
    ? `<p class="bear-popup__detail">${_escHtml(r.detail)}</p>` : "";
  const sourceHtml = r.source_url
    ? `<a class="bear-popup__link" href="${_escHtml(r.source_url)}"
         target="_blank" rel="noopener">出典</a>` : "";

  return `
    <div class="bear-popup">
      <div class="bear-popup__header">
        <span class="bear-popup__emoji">🐻</span>
        <span class="bear-popup__pref">${_escHtml(r.pref)}</span>
        <span class="bear-popup__kml-badge">✅ KMLデータ</span>
      </div>
      <div class="bear-popup__date">${_escHtml(dateLabel)}</div>
      <div class="bear-popup__place">${_escHtml(placeLabel)}</div>
      ${detailHtml}
      ${sourceHtml}
    </div>`;
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// フィルタ処理
// ---------------------------------------------------------------------------

/** KML 対応県の pref 値セットを返す */
function _kmlPrefSet() {
  return new Set(BEAR_PREF_LIST.filter(p => p.kml).map(p => p.pref));
}

/**
 * 現在のフィルタ値に応じて表示対象レコードを返す。
 * BEAR_PREF_ALL_VALUE → 全 KML 対応県
 * 県名               → その県のみ
 */
function _filteredBearData(prefValue) {
  if (prefValue === BEAR_PREF_ALL_VALUE) {
    const kmlSet = _kmlPrefSet();
    return bearData.filter(r => kmlSet.has(r.pref));
  }
  return bearData.filter(r => r.pref === prefValue);
}

// ---------------------------------------------------------------------------
// レイヤー描画
// ---------------------------------------------------------------------------

function _renderBearMarkers() {
  bearLayer.clearLayers();

  const records = _filteredBearData(bearFilteredPref);

  records.forEach(r => {
    const daysAgo = _bearDaysAgo(r.date);
    const color   = _bearColor(daysAgo);
    const icon    = _bearIcon(color);

    L.marker([r.lat, r.lng], { icon })
      .bindPopup(_bearPopupHtml(r), {
        maxWidth:  280,
        className: "bear-popup-wrapper",
      })
      .addTo(bearLayer);
  });

  // UI カウンターバッジを更新（存在する場合）
  const counter = document.getElementById("bear-count-badge");
  if (counter) counter.textContent = `${records.length}件`;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** bears.json を fetch してレイヤーを初期化する（ページロード時に 1 回だけ呼ぶ） */
async function initBearLayer() {
  try {
    const resp = await fetch(BEARS_JSON_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    bearData = await resp.json();
    _renderBearMarkers();
    console.log(`[bears] ${bearData.length} 件ロード完了`);
  } catch (err) {
    console.warn("[bears] データ取得失敗:", err);
    bearData = [];
  }
}

/** 熊レイヤーの表示/非表示を切り替える */
function setBearLayerVisible(visible) {
  if (visible) {
    if (!map.hasLayer(bearLayer)) bearLayer.addTo(map);
  } else {
    if (map.hasLayer(bearLayer)) map.removeLayer(bearLayer);
  }
}

/** 現在の熊レイヤーの表示状態を返す */
function isBearLayerVisible() {
  return map.hasLayer(bearLayer);
}

/**
 * 県フィルタを変更してレイヤーを再描画する
 * @param {string} prefValue - 県名 or BEAR_PREF_ALL_VALUE
 */
function setBearPrefFilter(prefValue) {
  bearFilteredPref = prefValue;
  _renderBearMarkers();
}

/** 現在の県フィルタ値を返す */
function getBearPrefFilter() {
  return bearFilteredPref;
}

/** KML 対応県リストを返す（UI 構築用） */
function getBearPrefList() {
  return BEAR_PREF_LIST;
}
