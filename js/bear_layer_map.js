// =============================================================================
// 熊出没レイヤー (bears layer) v4 - ヒートマップ + 直近ピン構成
// 依存: map (L.Map インスタンス)、L.heatLayer (leaflet.heat) が存在すること。
// =============================================================================

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const BEARS_HEAT_URL = "data/bears_heat.json"; // 全件・座標のみ [[lat,lng],...]
const BEARS_PINS_URL = "data/bears_pins.json";  // 直近90日・全フィールド

const BEAR_COLOR_FRESH  = "#e53935"; // 30日以内  → 赤
const BEAR_COLOR_RECENT = "#fb8c00"; // 90日以内  → オレンジ

// ヒートマップ設定
const BEAR_HEAT_OPTIONS = {
  radius:     22,
  blur:       12,
  maxZoom:    13,
  max:        0.05,
  minOpacity: 0.5,
  pane:       'paneBearHeat',
  gradient:   { 0.2: "#9c27b0", 0.5: "#e91e8c", 0.8: "#f44336", 1.0: "#8b0000" },
};

// 都道府県マスタ（表示順・地方グループ用）
// ※ kmlフラグ廃止 → データ有無は bearPinsData ロード後に動的判定
const BEAR_PREF_LIST = [
  { pref: "北海道" },
  { pref: "青森県" },
  { pref: "岩手県" },
  { pref: "宮城県" },
  { pref: "秋田県" },
  { pref: "山形県" },
  { pref: "福島県" },
  { pref: "茨城県" },
  { pref: "栃木県" },
  { pref: "群馬県" },
  { pref: "埼玉県" },
  { pref: "千葉県" },
  { pref: "東京都" },
  { pref: "神奈川県" },
  { pref: "新潟県" },
  { pref: "富山県" },
  { pref: "石川県" },
  { pref: "福井県" },
  { pref: "山梨県" },
  { pref: "長野県" },
  { pref: "岐阜県" },
  { pref: "静岡県" },
  { pref: "愛知県" },
  { pref: "三重県" },
  { pref: "滋賀県" },
  { pref: "京都府" },
  { pref: "大阪府" },
  { pref: "兵庫県" },
  { pref: "奈良県" },
  { pref: "和歌山県" },
  { pref: "島根県・鳥取県" },
  { pref: "岡山県" },
  { pref: "広島県" },
  { pref: "山口県" },
  { pref: "徳島県" },
  { pref: "香川県" },
  { pref: "愛媛県" },
  { pref: "高知県" },
  { pref: "福岡県" },
  { pref: "佐賀県" },
  { pref: "長崎県" },
  { pref: "熊本県" },
  { pref: "大分県" },
  { pref: "宮崎県" },
  { pref: "鹿児島県" },
  { pref: "沖縄県" },
];

const BEAR_PREF_ALL_VALUE = "__all__";

// ---------------------------------------------------------------------------
// モジュールスコープ変数
// ---------------------------------------------------------------------------

let bearHeatLayer     = null;                    // L.heatLayer インスタンス
let bearPinLayer      = null;                    // L.markerClusterGroup
let bearHeatData      = [];                      // [[lat,lng], ...] 全件
let bearPinsData      = [];                      // 直近90日・全フィールド
let _bearAvailPrefs   = new Set();               // pinsデータに実在するprefのSet（動的生成）
let bearFilteredPrefs = [BEAR_PREF_ALL_VALUE];   // 選択中の県配列
let bearVisible       = false;

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
  return BEAR_COLOR_RECENT;
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
  return `
    <div class="bear-popup">
      <div class="bear-popup__header">
        <span class="bear-popup__emoji">🐻</span>
        <span class="bear-popup__pref">${_escHtml(r.pref)}</span>
      </div>
      <div class="bear-popup__date">${_escHtml(dateLabel)}</div>
      <div class="bear-popup__place">${_escHtml(placeLabel)}</div>
      ${detailHtml}
    </div>`;
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** pinsデータに実在するprefのSetを返す（動的生成済み） */
function _availablePrefSet() {
  return _bearAvailPrefs;
}

// ---------------------------------------------------------------------------
// レイヤー描画
// ---------------------------------------------------------------------------

/** ヒートマップを再描画する */
function _renderBearHeat() {
  if (bearHeatLayer) {
    map.removeLayer(bearHeatLayer);
    bearHeatLayer = null;
  }
  if (!bearVisible) return;

  const isAll = bearFilteredPrefs.includes(BEAR_PREF_ALL_VALUE);

  let filteredLatLngs;
  if (isAll) {
    // 全データ対応県：全件表示
    filteredLatLngs = bearHeatData;
  } else {
    // 選択県のpinsデータから座標を取得してheatに使う
    const prefSet = new Set(bearFilteredPrefs);
    const filtered = bearPinsData.filter(r => prefSet.has(r.pref));
    filteredLatLngs = filtered.map(r => [r.lat, r.lng]);
    // 選択県にpinsデータがない場合は全件にフォールバック
    if (filteredLatLngs.length === 0) filteredLatLngs = bearHeatData;
  }

  const points = filteredLatLngs.map(([lat, lng]) => [lat, lng, 1]);
  if (points.length === 0) return;

  bearHeatLayer = L.heatLayer(points, BEAR_HEAT_OPTIONS).addTo(map);
}

/** ピンレイヤーを再描画する */
function _renderBearPins() {
  bearPinLayer.clearLayers();
  if (!bearVisible) return;

  const isAll = bearFilteredPrefs.includes(BEAR_PREF_ALL_VALUE);
  let records = bearPinsData;

  if (isAll) {
    // __all__ の場合はpinsに実在する全県を表示
    records = records.filter(r => _bearAvailPrefs.has(r.pref));
  } else {
    // 選択県のみ表示（複数可）
    const prefSet = new Set(bearFilteredPrefs);
    records = records.filter(r => prefSet.has(r.pref));
  }

  records.forEach(r => {
    const daysAgo = _bearDaysAgo(r.date);
    const color   = _bearColor(daysAgo);
    const icon    = _bearIcon(color);
    L.marker([r.lat, r.lng], { icon })
      .bindPopup(_bearPopupHtml(r), { maxWidth: 280, className: "bear-popup-wrapper" })
      .addTo(bearPinLayer);
  });

  // カウンターバッジ更新
  const counter = document.getElementById("bear-count-badge");
  if (counter) counter.textContent = `直近${records.length}件`;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** bears_heat.json と bears_pins.json を並行fetchして初期化する */
async function initBearLayer() {
  // markerClusterGroup を初期化
  bearPinLayer = L.markerClusterGroup({
    maxClusterRadius: 60,
    disableClusteringAtZoom: 14,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      const size  = count < 10 ? 32 : count < 50 ? 40 : 48;
      return L.divIcon({
        html: `<div class="bear-cluster"><span>🐻</span><b>${count}</b></div>`,
        className: "",
        iconSize: [size, size],
      });
    },
  });

  try {
    const [heatResp, pinsResp] = await Promise.all([
      fetch(BEARS_HEAT_URL),
      fetch(BEARS_PINS_URL),
    ]);
    if (heatResp.ok) bearHeatData = await heatResp.json();
    if (pinsResp.ok) bearPinsData = await pinsResp.json();

    // pinsデータから実在するprefを動的生成
    _bearAvailPrefs = new Set(bearPinsData.map(r => r.pref).filter(Boolean));

    console.log(
      `[bears] heat:${bearHeatData.length}件 pins:${bearPinsData.length}件`,
      `利用可能県:${_bearAvailPrefs.size}件 ロード完了`
    );
  } catch (err) {
    console.warn("[bears] データ取得失敗:", err);
  }
}

/** 熊レイヤー（ヒートマップ＋ピン）の表示/非表示を切り替える */
function setBearLayerVisible(visible) {
  bearVisible = visible;
  _renderBearHeat();

  if (visible) {
    if (!map.hasLayer(bearPinLayer)) bearPinLayer.addTo(map);
  } else {
    if (map.hasLayer(bearPinLayer)) map.removeLayer(bearPinLayer);
  }
  _renderBearPins();

  // フロートボタンの active クラスを同期
  const btn = document.getElementById("btn-bear");
  if (btn) btn.classList.toggle("active", visible);
  // 設定タブのチェックボックスも同期
  const chk = document.getElementById("bear-layer-toggle");
  if (chk) chk.checked = visible;
}

/** 熊レイヤーのON/OFFをトグルする（フロートボタン用） */
function toggleBearLayer() {
  if (bearVisible) { setBearLayerVisible(false); return; }
  isPremiumUser().then(premium => {
    if (!premium) { showPremiumGate('bear_layer'); return; }
    setBearLayerVisible(true);
  });
}

/** 現在の表示状態を返す */
function isBearLayerVisible() {
  return bearVisible;
}

/** 県フィルタを変更してピン・ヒートマップを再描画する
 *  prefValues: 文字列配列 or "__all__" 文字列
 */
function setBearPrefFilter(prefValues) {
  if (typeof prefValues === 'string') {
    bearFilteredPrefs = [prefValues];
  } else {
    bearFilteredPrefs = prefValues.length > 0 ? prefValues : [BEAR_PREF_ALL_VALUE];
  }

  const isAll = bearFilteredPrefs.includes(BEAR_PREF_ALL_VALUE);
  let records = bearPinsData;

  if (isAll) {
    records = records.filter(r => _bearAvailPrefs.has(r.pref));
  } else {
    const prefSet = new Set(bearFilteredPrefs);
    records = records.filter(r => prefSet.has(r.pref));
  }

  const counter = document.getElementById('bear-count-badge');
  if (counter) counter.textContent = `直近${records.length}件`;

  if (bearVisible) {
    _renderBearHeat();
    _renderBearPins();
  }
}

/** 現在の県フィルタを返す */
function getBearPrefFilter() { return bearFilteredPrefs; }

/** 都道府県マスタを返す（UI構築用） */
function getBearPrefList()   { return BEAR_PREF_LIST; }

/** pinsデータに実在するprefのSetを返す（UI側でdisabled判定に使用） */
function getBearAvailPrefs() { return _bearAvailPrefs; }

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------
initBearLayer().then(() => {
  if (typeof initBearToggle === 'function') {
    initBearToggle();
  }
});
